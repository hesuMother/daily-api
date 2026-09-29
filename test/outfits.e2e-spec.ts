import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { TokenService } from '../src/auth/service/token.service';
import { SessionRepository } from '../src/auth/repository/session.repository';
import { createTestDatabase } from './database-fixture';

interface OutfitResponse {
  id: string;
  authorId: string;
  status: string;
  imageUrl: string;
  items: { name: string; productId: string | null }[];
}

describe('Outfit submission, product picker and moderation', () => {
  let app: NestFastifyApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let directory: string;
  let image: Buffer;
  let owner: { id: string; token: string };
  let stranger: { id: string; token: string };
  let admin: { id: string; token: string };
  let productId: string;
  let offerId: string;
  let otherOfferId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    await mkdir(resolve('.tmp'), { recursive: true });
    directory = await mkdtemp(resolve('.tmp/outfit-test-'));
    db.config.set('app.outfitUploadDir', directory);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(db.config)
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    async function actor(role: 'USER' | 'ADMIN') {
      const id = randomUUID();
      await db.prisma.user.create({
        data: {
          id,
          username: id,
          email: id + '@example.test',
          password: 'not-used',
          role,
        },
      });
      const deviceId = randomUUID();
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + 3600000);
      const tokens = await app
        .get(TokenService)
        .issue(id, deviceId, sessionId, expiresAt);
      await app.get(SessionRepository).create({
        userId: id,
        deviceId,
        sessionId,
        expiresAt,
        tokenId: tokens.refreshId,
      });
      return { id, token: tokens.accessToken };
    }
    owner = await actor('USER');
    stranger = await actor('USER');
    admin = await actor('ADMIN');
    const seller = await db.prisma.seller.create({
      data: { name: 'Shop', slug: 'test-shop' },
    });
    const product = await db.prisma.product.create({
      data: { name: 'Test shirt' },
      select: { id: true },
    });
    const other = await db.prisma.product.create({
      data: { name: 'Test shoes' },
      select: { id: true },
    });
    productId = product.id;
    offerId = (
      await db.prisma.productOffer.create({
        data: {
          sellerId: seller.id,
          productId,
          price: 1000,
          purchaseUrl: 'https://example.com/shirt',
        },
      })
    ).id;
    otherOfferId = (
      await db.prisma.productOffer.create({
        data: { sellerId: seller.id, productId: other.id, price: 2000 },
      })
    ).id;
    image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await app?.close();
    await db?.cleanup();
    if (directory && resolve(directory).startsWith(resolve('.tmp') + sep))
      await rm(directory, { recursive: true });
  });

  function request(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    token?: string,
    payload?: object,
  ) {
    return app.inject({
      method,
      url: '/v1/' + url,
      payload,
      headers: token ? { authorization: 'Bearer ' + token } : {},
    });
  }
  function data() {
    return {
      name: 'Weekend outfit',
      description: 'Comfortable fit',
      height: 175,
      weight: 70,
      items: [
        { type: 'TOP', productId, offerId },
        { type: 'BOTTOM', name: 'My jeans', link: 'https://example.com/jeans' },
      ],
    };
  }
  function upload(
    metadata: object = data(),
    bytes = image,
    token = owner.token,
  ) {
    const boundary = 'outfit-' + randomUUID();
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      bytes,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}--\r\n`,
      ),
    ]);
    return app.inject({
      method: 'POST',
      url: '/v1/outfits',
      remoteAddress: '192.0.2.' + (Math.floor(Math.random() * 200) + 1),
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'multipart/form-data; boundary=' + boundary,
      },
      payload,
    });
  }

  it('creates a pending outfit with authenticated ownership, snapshots and private photo', async () => {
    const response = await upload();
    expect(response.statusCode).toBe(201);
    const outfit = response.json<OutfitResponse>();
    expect(outfit).toMatchObject({
      authorId: owner.id,
      status: 'PENDING',
      name: 'Weekend outfit',
      height: 175,
      weight: 70,
    });
    expect(outfit.items.map((item) => item.name)).toEqual([
      'Test shirt',
      'My jeans',
    ]);
    expect(JSON.stringify(outfit)).not.toContain('password');
    expect((await request('GET', 'outfits/' + outfit.id)).statusCode).toBe(404);
    expect(
      (await request('GET', 'outfits/' + outfit.id, stranger.token)).statusCode,
    ).toBe(404);
    expect(
      (await request('GET', 'outfits/' + outfit.id, owner.token)).statusCode,
    ).toBe(200);
    expect(
      (await request('GET', 'outfits/' + outfit.id + '/image')).statusCode,
    ).toBe(404);
    const photo = await request(
      'GET',
      'outfits/' + outfit.id + '/image',
      owner.token,
    );
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/webp');
    expect((await sharp(photo.rawPayload).metadata()).exif).toBeUndefined();
    expect(
      (await request('GET', 'outfits')).json<{ items: unknown[] }>().items,
    ).toEqual([]);
  });

  it('lets only admins review, atomically handles competing decisions, and publishes approved photos', async () => {
    const outfit = (await upload()).json<OutfitResponse>();
    expect(
      (await request('GET', 'admin/outfits', owner.token)).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          'POST',
          `admin/outfits/${outfit.id}/review`,
          owner.token,
          { status: 'APPROVED' },
        )
      ).statusCode,
    ).toBe(403);
    const results = await Promise.all(
      [0, 1].map(() =>
        request('POST', `admin/outfits/${outfit.id}/review`, admin.token, {
          status: 'APPROVED',
        }),
      ),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect((await request('GET', `outfits/${outfit.id}`)).statusCode).toBe(200);
    expect(
      (await request('GET', `outfits/${outfit.id}/image`)).statusCode,
    ).toBe(200);
    expect(
      await db.prisma.auditLog.count({
        where: { targetId: outfit.id, action: 'APPROVE' },
      }),
    ).toBe(1);
  });

  it('requires rejection reasons and keeps rejected submissions private', async () => {
    const outfit = (await upload()).json<OutfitResponse>();
    expect(
      (
        await request(
          'POST',
          `admin/outfits/${outfit.id}/review`,
          admin.token,
          { status: 'REJECTED' },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          'POST',
          `admin/outfits/${outfit.id}/review`,
          admin.token,
          { status: 'REJECTED', reason: '사진을 확인해주세요.' },
        )
      ).statusCode,
    ).toBe(201);
    expect((await request('GET', `outfits/${outfit.id}`)).statusCode).toBe(404);
    expect(
      (await request('GET', `outfits/${outfit.id}`, owner.token)).json(),
    ).toMatchObject({
      status: 'REJECTED',
      rejectionLog: [{ reason: '사진을 확인해주세요.' }],
    });
  });

  it('validates metadata, rejects mismatched products, and cleans up files after a failed transaction', async () => {
    const before = await readdir(directory);
    expect((await upload({ ...data(), status: 'APPROVED' })).statusCode).toBe(
      400,
    );
    expect(
      (await upload({ ...data(), authorId: stranger.id })).statusCode,
    ).toBe(400);
    expect((await upload({ ...data(), height: 0 })).statusCode).toBe(400);
    expect((await upload({ ...data(), items: [] })).statusCode).toBe(400);
    expect(
      (
        await upload({
          ...data(),
          items: [{ type: 'TOP', productId, offerId: otherOfferId }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await upload({
          ...data(),
          items: [{ type: 'SHOES', name: 'Fake', link: 'javascript:alert(1)' }],
        })
      ).statusCode,
    ).toBe(400);
    expect(await readdir(directory)).toEqual(before);
  });

  it('rejects fake images, SVG and oversized uploads despite their claimed MIME type', async () => {
    expect((await upload(data(), Buffer.from('not a photo'))).statusCode).toBe(
      400,
    );
    expect(
      (
        await upload(
          data(),
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
          ),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await upload(data(), Buffer.alloc(8 * 1024 * 1024 + 1))).statusCode,
    ).toBe(413);
  });

  it('accepts valid photos larger than the default JSON body limit', async () => {
    const large = await sharp(randomBytes(700 * 700 * 3), {
      raw: { width: 700, height: 700, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(large.length).toBeGreaterThan(1024 * 1024);
    expect((await upload(data(), large)).statusCode).toBe(201);
  });

  it('searches the catalog and isolates the users bookmarks/history', async () => {
    const all = await request('GET', 'outfits/products?q=shirt', owner.token);
    expect(all.statusCode).toBe(200);
    expect(
      all.json<{ items: { productId: string }[] }>().items[0].productId,
    ).toBe(productId);
    await request(
      'POST',
      `outfits/products/${productId}/bookmark`,
      owner.token,
    );
    await request(
      'POST',
      `outfits/products/${productId}/bookmark`,
      owner.token,
    );
    expect(
      await db.prisma.productBookmark.count({
        where: { userId: owner.id, productId },
      }),
    ).toBe(1);
    expect(
      (
        await request(
          'GET',
          'outfits/products?source=bookmarks',
          stranger.token,
        )
      ).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect(
      (
        await request('GET', 'outfits/products?source=bookmarks', owner.token)
      ).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    await request('POST', `outfits/products/${productId}/view`, owner.token);
    expect(
      (
        await request('GET', 'outfits/products?source=history', owner.token)
      ).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    expect(
      (
        await request('GET', 'outfits/products?source=history', stranger.token)
      ).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    await request(
      'DELETE',
      `outfits/products/${productId}/bookmark`,
      owner.token,
    );
    expect(
      (
        await request('GET', 'outfits/products?source=bookmarks', owner.token)
      ).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect(
      (await request('GET', 'outfits/products?limit=1000', owner.token))
        .statusCode,
    ).toBe(400);
  });

  it('keeps legacy link-based bookmarks available as manual selections', async () => {
    await db.prisma.productBookmark.create({
      data: {
        userId: owner.id,
        legacyProductName: 'Old jacket',
        legacyProductLink: 'https://example.com/old',
      },
    });
    const response = await request(
      'GET',
      'outfits/products?source=bookmarks&q=Old',
      owner.token,
    );
    expect(response.json()).toMatchObject({
      items: [
        {
          productId: null,
          manual: { name: 'Old jacket', link: 'https://example.com/old' },
        },
      ],
    });
  });
});

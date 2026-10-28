import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { TokenService } from '../src/auth/service/token.service';
import { SessionRepository } from '../src/auth/repository/session.repository';
import {
  PRODUCT_PROVIDERS,
  type ProductProvider,
} from '../src/crawler/providers/product-provider.interface';
import { createTestDatabase } from './database-fixture';

describe('Product collection admin HTTP boundary', () => {
  let app: NestFastifyApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let adminToken: string;
  let userToken: string;
  let requestId = 0;
  const searches: string[] = [];
  const provider: ProductProvider = {
    id: 'api-fixture',
    name: 'API fixture',
    search: (keyword) => {
      searches.push(keyword);
      return Promise.resolve({
        products:
          keyword === 'empty'
            ? []
            : [
                {
                  provider: 'api-fixture',
                  name: 'API shirt',
                  price: null,
                  productUrl: 'https://shop.test/products/shirt',
                  sku: 'SKU-HTTP',
                  fetchedAt: new Date(),
                },
              ],
        failures: [],
      });
    },
    getProduct: () => Promise.resolve({ products: [], failures: [] }),
  };
  beforeAll(async () => {
    db = await createTestDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(db.config)
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .overrideProvider(PRODUCT_PROVIDERS)
      .useValue([provider])
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    async function token(role: 'USER' | 'ADMIN') {
      const id = randomUUID(),
        deviceId = randomUUID(),
        sessionId = randomUUID();
      await db.prisma.user.create({
        data: {
          id,
          username: id,
          email: id + '@example.test',
          password: 'not-used',
          role,
        },
      });
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
      return tokens.accessToken;
    }
    adminToken = await token('ADMIN');
    userToken = await token('USER');
  });
  afterAll(async () => {
    await app?.close();
    await db?.cleanup();
  });
  function request(
    method: 'GET' | 'POST',
    path: string,
    token?: string,
    payload?: object,
    remoteAddress?: string,
  ) {
    return app.inject({
      method,
      url: '/v1/admin/products/' + path,
      payload,
      remoteAddress: remoteAddress ?? '127.0.1.' + ++requestId,
      headers: token ? { authorization: 'Bearer ' + token } : {},
    });
  }

  it('requires authentication and ADMIN for every collection route', async () => {
    expect((await request('GET', 'providers')).statusCode).toBe(401);
    expect((await request('GET', 'providers', userToken)).statusCode).toBe(403);
    for (const path of [
      'providers/api-fixture/search',
      'providers/api-fixture/refresh',
      'offers/' + randomUUID() + '/refresh',
    ]) {
      expect((await request('POST', path, userToken, {})).statusCode).toBe(403);
    }
    expect(searches).toEqual([]);
  });
  it('lists providers and saves normalized products through the authorized HTTP route', async () => {
    const listed = await request('GET', 'providers', adminToken);
    expect(listed.statusCode).toBe(200);
    expect(listed.json<unknown>()).toEqual([
      { id: provider.id, name: provider.name },
    ]);
    const response = await request(
      'POST',
      'providers/api-fixture/search',
      adminToken,
      { keyword: ' shirt ' },
    );
    expect(response.statusCode).toBe(201);
    expect(response.json<unknown>()).toMatchObject({
      saved: { created: 1 },
      failures: [],
    });
    expect(searches).toEqual(['shirt']);
    expect(await db.prisma.productOffer.findFirst()).toMatchObject({
      price: null,
      isSoldOut: null,
      sku: 'SKU-HTTP',
    });
  });
  it('validates input and rejects unknown providers without collecting', async () => {
    expect(
      (
        await request('POST', 'providers/api-fixture/search', adminToken, {
          keyword: ' ',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', 'providers/api-fixture/refresh', adminToken, {
          url: 'file:///private',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', 'providers/missing/search', adminToken, {
          keyword: 'shirt',
        })
      ).statusCode,
    ).toBe(404);
    expect(searches).toEqual(['shirt']);
  });
  it('limits collection requests to three per minute on the route', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await request(
        'POST',
        'providers/api-fixture/search',
        adminToken,
        { keyword: 'empty' },
        '127.0.2.1',
      );
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
    expect(searches.filter((keyword) => keyword === 'empty')).toHaveLength(3);
  });
});

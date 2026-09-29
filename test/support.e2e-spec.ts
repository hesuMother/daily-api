import { jest } from '@jest/globals';
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
import { DiscordClient } from '../src/notifications/discord.client';
import { DiscordWorker } from '../src/notifications/discord.worker';
import { createTestDatabase } from './database-fixture';

describe('Reports, contacts and durable Discord delivery', () => {
  let app: NestFastifyApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let owner: { id: string; token: string };
  let other: { id: string; token: string };
  let admin: { id: string; token: string };
  let moderator: { id: string; token: string };
  let reportCategory: string;
  let contactCategory: string;
  let productId: string;
  let outfitId: string;
  let sequence = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(db.config)
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    async function actor(role: 'USER' | 'ADMIN' | 'MODERATOR') {
      const id = randomUUID();
      await db.prisma.user.create({
        data: {
          id,
          username: id,
          email: id + '@example.test',
          password: 'secret-not-returned',
          role,
        },
      });
      const deviceId = randomUUID(),
        sessionId = randomUUID(),
        expiresAt = new Date(Date.now() + 3600000);
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
    other = await actor('USER');
    admin = await actor('ADMIN');
    moderator = await actor('MODERATOR');
    reportCategory = (await db.prisma.reportCategory.findFirstOrThrow()).id;
    contactCategory = (await db.prisma.contactCategory.findFirstOrThrow()).id;
    productId = (
      await db.prisma.product.create({
        data: { name: 'Reported product' },
        select: { id: true },
      })
    ).id;
    outfitId = (
      await db.prisma.outfit.create({
        data: {
          name: 'Reported outfit',
          authorId: owner.id,
          height: 175,
          weight: 70,
          imageUrl: '/test',
          status: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
    await db?.cleanup();
  });
  afterEach(() => jest.restoreAllMocks());
  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    token?: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: '/v1/' + path,
      payload,
      remoteAddress: '192.0.2.' + ++sequence,
      headers: token ? { authorization: 'Bearer ' + token } : {},
    });
  const report = (extra: object = {}) => ({
    categoryId: reportCategory,
    reason: 'Please review',
    description: 'Details',
    targetType: 'PRODUCT',
    targetId: productId,
    ...extra,
  });
  const contact = (extra: object = {}) => ({
    categoryId: contactCategory,
    reason: 'Upload question',
    feature: 'outfit-upload',
    description: 'Please email me',
    ...extra,
  });

  it('creates reports and outbox atomically, isolates users and exposes private fields only to admins', async () => {
    expect(
      (await request('POST', 'reports', undefined, report())).statusCode,
    ).toBe(401);
    expect(
      (await request('GET', 'reports/categories', owner.token)).json<
        unknown[]
      >(),
    ).toHaveLength(3);
    const response = await request('POST', 'reports', owner.token, report());
    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string }>();
    expect(response.json()).toMatchObject({ status: 'PENDING' });
    expect(
      await db.prisma.discordNotification.count({
        where: {
          kind: 'REPORT',
          targetId: body.id,
          status: 'PENDING',
          attempts: 0,
        },
      }),
    ).toBe(1);
    expect(
      (await request('GET', 'reports/' + body.id, other.token)).statusCode,
    ).toBe(404);
    expect(
      (await request('GET', 'reports/mine', other.token)).json(),
    ).toMatchObject({ items: [] });
    const detail = await request(
      'GET',
      'admin/reports/' + body.id,
      admin.token,
    );
    expect(detail.json()).toMatchObject({
      reporter: { id: owner.id, email: owner.id + '@example.test' },
      notification: { status: 'PENDING' },
    });
    expect(detail.body).not.toContain('password');
    expect(detail.headers['cache-control']).toContain('no-store');
  });

  it('validates targets and blocks forged status/ownership, inaccessible outfits and private bookmarks', async () => {
    const pending = await db.prisma.outfit.create({
      data: {
        name: 'Private',
        authorId: other.id,
        imageUrl: '/test',
        height: 175,
        weight: 70,
      },
      select: { id: true },
    });
    const bookmark = await db.prisma.productBookmark.create({
      data: { userId: other.id, productId },
    });
    const before = await db.prisma.discordNotification.count();
    for (const [extra, status] of [
      [{ status: 'RESOLVED' }, 400],
      [{ reporterId: other.id }, 400],
      [{ categoryId: randomUUID() }, 400],
      [{ targetId: randomUUID() }, 404],
      [{ targetType: 'INVALID' }, 400],
      [{ targetType: 'OUTFIT', targetId: pending.id }, 404],
      [{ targetType: 'PRODUCT_BOOKMARK', targetId: bookmark.id }, 404],
    ] as const)
      expect(
        (await request('POST', 'reports', owner.token, report(extra)))
          .statusCode,
      ).toBe(status);
    expect(await db.prisma.discordNotification.count()).toBe(before);
    expect(
      (
        await request(
          'POST',
          'reports',
          owner.token,
          report({ targetType: 'USER', targetId: other.id }),
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await request(
          'POST',
          'reports',
          other.token,
          report({ targetType: 'PRODUCT_BOOKMARK', targetId: bookmark.id }),
        )
      ).statusCode,
    ).toBe(201);
  });

  it('restricts status changes to ADMIN and handles simultaneous resolution once with target moderation', async () => {
    const { id } = (
      await request(
        'POST',
        'reports',
        other.token,
        report({ targetType: 'OUTFIT', targetId: outfitId }),
      )
    ).json<{ id: string }>();
    const decision = {
      expectedStatus: 'PENDING',
      status: 'RESOLVED',
      note: 'Internal moderation note',
      action: 'HIDE_OUTFIT',
    };
    for (const token of [owner.token, other.token, moderator.token]) {
      expect((await request('GET', 'admin/reports', token)).statusCode).toBe(
        403,
      );
      expect(
        (await request('PATCH', `admin/reports/${id}/status`, token, decision))
          .statusCode,
      ).toBe(403);
    }
    const outcomes = await Promise.all(
      [0, 1].map(() =>
        request('PATCH', `admin/reports/${id}/status`, admin.token, decision),
      ),
    );
    expect(outcomes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      await db.prisma.outfit.findUnique({
        where: { id: outfitId },
        select: { status: true },
      }),
    ).toEqual({ status: 'REJECTED' });
    expect(
      await db.prisma.auditLog.count({
        where: { targetId: id, action: 'RESOLVE' },
      }),
    ).toBe(1);
    const personal = await request('GET', `reports/${id}`, other.token);
    expect(personal.body).not.toContain('Internal moderation note');
    expect(personal.json()).toMatchObject({ status: 'RESOLVED' });
    expect((await request('GET', `outfits/${outfitId}`)).statusCode).toBe(404);
  });

  it('records reviewing/rejection, rolls back invalid target actions and supports product removal', async () => {
    const { id } = (
      await request('POST', 'reports', owner.token, report())
    ).json<{ id: string }>();
    expect(
      (
        await request('PATCH', `admin/reports/${id}/status`, admin.token, {
          expectedStatus: 'PENDING',
          status: 'RESOLVED',
          note: 'wrong action',
          action: 'HIDE_OUTFIT',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await db.prisma.report.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('PENDING');
    expect(
      (
        await request('PATCH', `admin/reports/${id}/status`, admin.token, {
          expectedStatus: 'PENDING',
          status: 'REVIEWING',
          note: 'Investigating',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request('PATCH', `admin/reports/${id}/status`, admin.token, {
          expectedStatus: 'REVIEWING',
          status: 'REJECTED',
          note: 'No violation',
        })
      ).statusCode,
    ).toBe(200);
    const product = await db.prisma.product.create({
      data: { name: 'Remove me' },
      select: { id: true },
    });
    const removal = (
      await request(
        'POST',
        'reports',
        owner.token,
        report({ targetId: product.id }),
      )
    ).json<{ id: string }>();
    expect(
      (
        await request(
          'PATCH',
          `admin/reports/${removal.id}/status`,
          admin.token,
          {
            expectedStatus: 'PENDING',
            status: 'RESOLVED',
            note: 'Removed',
            action: 'HIDE_PRODUCT',
          },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await db.prisma.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { isDeleted: true },
        })
      ).isDeleted,
    ).toBe(true);
  });

  it('accepts feature/target inquiries, limits visibility, and marks read once without a resolution workflow', async () => {
    expect(
      (await request('GET', 'contacts/categories', owner.token)).json<
        unknown[]
      >(),
    ).toHaveLength(5);
    const response = await request(
      'POST',
      'contacts',
      owner.token,
      contact({ targetType: 'PRODUCT', targetId: productId }),
    );
    expect(response.statusCode).toBe(201);
    const { id } = response.json<{ id: string }>();
    expect(response.json()).toMatchObject({
      readAt: null,
      feature: 'outfit-upload',
    });
    expect(
      await db.prisma.discordNotification.count({
        where: { kind: 'CONTACT', targetId: id },
      }),
    ).toBe(1);
    expect(
      (await request('GET', `contacts/${id}`, other.token)).statusCode,
    ).toBe(404);
    expect(
      (await request('PATCH', `admin/contacts/${id}/read`, owner.token))
        .statusCode,
    ).toBe(403);
    expect(
      (await request('GET', 'admin/contacts?view=unread', admin.token)).json(),
    ).toMatchObject({ items: [{ id }] });
    const details = (
      await request('GET', `admin/contacts/${id}`, admin.token)
    ).json<{ readAt: null; user: { email: string } }>();
    expect(details.readAt).toBeNull();
    expect(details.user.email).toBe(owner.id + '@example.test');
    const reads = await Promise.all(
      [0, 1].map(() =>
        request('PATCH', `admin/contacts/${id}/read`, admin.token),
      ),
    );
    expect(reads.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(
      await db.prisma.auditLog.count({
        where: { targetType: 'contact', targetId: id, action: 'UPDATE' },
      }),
    ).toBe(1);
    expect(
      (await request('GET', 'admin/contacts?view=unread', admin.token)).json(),
    ).toMatchObject({ items: [] });
    expect(
      (
        await request('PATCH', `admin/contacts/${id}/status`, admin.token, {
          status: 'RESOLVED',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('rejects invalid inquiry references and injected read/status/email fields', async () => {
    for (const extra of [
      { targetType: 'USER' },
      { targetId: other.id },
      { readAt: new Date().toISOString() },
      { status: 'RESOLVED' },
      { contactUserId: other.id },
      { email: 'attacker@example.test' },
    ])
      expect(
        (await request('POST', 'contacts', owner.token, contact(extra)))
          .statusCode,
      ).toBe(400);
    expect(
      (await request('POST', 'contacts', owner.token, contact())).statusCode,
    ).toBe(201);
    expect(
      (await request('GET', 'contacts/mine?limit=1000', owner.token))
        .statusCode,
    ).toBe(400);
  });

  function worker(client: DiscordClient) {
    return new DiscordWorker(
      new ConfigService({
        app: {
          discord: {
            enabled: true,
            reportWebhookUrl: 'https://discord.com/api/webhooks/123/fake',
            contactWebhookUrl: 'https://discord.com/api/webhooks/456/fake',
          },
        },
      }),
      db.prisma,
      client,
    );
  }

  it('delivers queued alerts exactly once in competing workers without exposing private text', async () => {
    const client = new DiscordClient();
    const send = jest
      .spyOn(client, 'send')
      .mockResolvedValue({ status: 'sent' });
    const count = await db.prisma.discordNotification.count({
      where: { status: 'PENDING' },
    });
    const first = worker(client),
      second = worker(client);
    await Promise.all([first.tick(), second.tick()]);
    await first.tick();
    expect(send).toHaveBeenCalledTimes(count);
    expect(
      await db.prisma.discordNotification.count({ where: { status: 'SENT' } }),
    ).toBe(count);
    for (const call of send.mock.calls) {
      expect(call[1]).not.toContain('@example.test');
      expect(call[1]).not.toContain('Please');
    }
    await first.onModuleDestroy();
    await second.onModuleDestroy();
  });

  it('persists webhook failures and rate limits, recovers expired leases and allows only admins to retry', async () => {
    const job = await db.prisma.discordNotification.create({
      data: { kind: 'REPORT', targetId: randomUUID() },
    });
    const client = new DiscordClient();
    const send = jest.spyOn(client, 'send').mockResolvedValue({
      status: 'retry',
      error: 'HTTP_429',
      delayMs: 120000,
    });
    const runner = worker(client);
    await runner.tick();
    const deferred = await db.prisma.discordNotification.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(deferred.status).toBe('PENDING');
    expect(deferred.availableAt.getTime()).toBeGreaterThan(Date.now() + 110000);
    await db.prisma.discordNotification.create({
      data: { kind: 'REPORT', targetId: randomUUID() },
    });
    await runner.tick();
    expect(send).toHaveBeenCalledTimes(1);
    await db.prisma.discordNotification.update({
      where: { id: job.id },
      data: {
        availableAt: new Date(0),
        status: 'PROCESSING',
        lockedUntil: new Date(0),
        lockToken: randomUUID(),
      },
    });
    send.mockResolvedValue({ status: 'failed', error: 'HTTP_404' });
    await runner.tick();
    expect(
      (
        await db.prisma.discordNotification.findUniqueOrThrow({
          where: { id: job.id },
        })
      ).status,
    ).toBe('FAILED');
    expect(
      (
        await request(
          'POST',
          `admin/notifications/${job.id}/retry`,
          owner.token,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          'POST',
          `admin/notifications/${job.id}/retry`,
          admin.token,
        )
      ).statusCode,
    ).toBe(201);
    send.mockResolvedValue({ status: 'sent' });
    await runner.tick();
    expect(
      (
        await db.prisma.discordNotification.findUniqueOrThrow({
          where: { id: job.id },
        })
      ).status,
    ).toBe('SENT');
    await runner.onModuleDestroy();
  });
});

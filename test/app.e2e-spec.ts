import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { VersioningType } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AuthService } from '../src/auth/service/auth.service';
import { JwtAccessGuard } from '../src/auth/guard/jwt-access.guard';

describe('App health HTTP', () => {
  let app: NestFastifyApplication;
  const ping = jest.fn<() => Promise<void>>();
  const authenticate = jest.fn();
  beforeEach(async () => {
    ping.mockReset().mockResolvedValue();
    authenticate.mockReset();
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { ping } },
        { provide: RedisService, useValue: { ping: () => Promise.resolve() } },
        { provide: AuthService, useValue: { authenticate } },
        { provide: APP_GUARD, useClass: JwtAccessGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(async () => {
    await app.close();
  });
  it('exposes unversioned public probes with caching disabled', async () => {
    for (const url of ['/health', '/health/ready']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ status: 'ok' });
    }
    expect(authenticate).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(
      404,
    );
  });
  it('returns 503 for an unavailable dependency and keeps the process live', async () => {
    ping.mockRejectedValue(new Error('private DB error'));
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private DB error');
    expect(
      (await app.inject({ method: 'GET', url: '/health' })).statusCode,
    ).toBe(200);
  });
});

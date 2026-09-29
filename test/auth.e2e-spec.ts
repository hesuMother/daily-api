import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../src/redis/redis.service';
import { SessionRepository } from '../src/auth/repository/session.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { UserRole } from '../src/generated/prisma/client';
import type { OpenAPIObject } from '@nestjs/swagger';
import { verify } from 'argon2';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import type { AppSettings } from '../src/config/environment';
import { Roles } from '../src/auth/decorators/auth.decorators';
import { REFRESH_COOKIE_NAME, type TokenClaims } from '../src/auth/auth.types';
import type { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import {
  USER_REGISTERED_EVENT,
  type UserRegisteredEvent,
} from '../src/auth/events/user-registered.event';
import { createTestDatabase } from './database-fixture';

@Controller('role-test')
class RoleTestController {
  @Get()
  @Roles(UserRole.ADMIN)
  admin(): string {
    return 'admin';
  }
}

describe('Auth with PostgreSQL, Argon2 and JWT', () => {
  let app: NestFastifyApplication;
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let document: OpenAPIObject;
  let sequence = 0;
  const password = 'My-long-password!2026';

  beforeAll(async () => {
    database = await createTestDatabase();
    try {
      const module = await Test.createTestingModule({
        imports: [AppModule],
        controllers: [RoleTestController],
      })
        .overrideProvider(ConfigService)
        .useValue(database.config)
        .overrideProvider(PrismaService)
        .useValue(database.prisma)
        .compile();
      app = module.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
        { logger: false },
      );
      document = await configureApp(app);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    } catch (error) {
      await app?.close();
      await database.cleanup();
      throw error;
    }
  });

  afterAll(async () => {
    await app?.close();
    if (app) await database.cleanup();
  });

  function post(
    path: string,
    payload?: object,
    cookie?: string,
    overrides: Record<string, string> = {},
    ip?: string,
  ) {
    return app.inject({
      method: 'POST',
      url: '/v1/auth/' + path,
      payload:
        (path === 'login' || path === 'register') && payload
          ? { deviceId: randomUUID(), ...payload }
          : payload,
      remoteAddress: ip ?? '192.0.2.' + ((++sequence % 200) + 1),
      headers: {
        'x-auth-request': '1',
        origin: 'https://web.example.test',
        ...(cookie ? { cookie } : {}),
        ...overrides,
      },
    });
  }

  function cookieOf(response: Awaited<ReturnType<typeof post>>): string {
    const cookie = response.headers['set-cookie'];
    if (typeof cookie !== 'string')
      throw new Error('Expected one refresh cookie');
    return cookie.split(';')[0];
  }

  async function register() {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const input = {
      deviceId: randomUUID(),
      username: 'user_' + suffix,
      email: suffix + '@example.com',
      password,
    };
    const response = await post('register', input);
    expect(response.statusCode).toBe(201);
    return {
      input,
      body: response.json<AuthResponseDto>(),
      cookie: cookieOf(response),
      response,
    };
  }

  function me(accessToken: string) {
    return app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: 'Bearer ' + accessToken },
    });
  }

  it('reports readiness against the real PostgreSQL and Redis connections', async () => {
    const result = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('replaces a login on the same device and protects the new session from old logout', async () => {
    const user = await register();
    const login = await post('login', {
      email: user.input.email,
      password,
      deviceId: user.input.deviceId,
    });
    expect(login.statusCode).toBe(200);
    const next = login.json<AuthResponseDto>();
    expect((await me(user.body.accessToken)).statusCode).toBe(401);
    await post('logout', undefined, user.cookie);
    expect((await me(next.accessToken)).statusCode).toBe(200);
    expect((await post('refresh', undefined, cookieOf(login))).statusCode).toBe(
      200,
    );
  });

  it('registers an Argon2 user, publishes userId, returns only access JWT and a protected cookie', async () => {
    const received: UserRegisteredEvent[] = [];
    const listener = (event: UserRegisteredEvent) => {
      received.push(event);
    };
    const emitter = app.get(EventEmitter2);
    emitter.on(USER_REGISTERED_EVENT, listener);
    const result = await register();
    emitter.off(USER_REGISTERED_EVENT, listener);
    const stored = await database.prisma.user.findUniqueOrThrow({
      where: { id: result.body.user.id },
    });
    expect(stored.password).toMatch(/^\$argon2id\$/);
    expect(await verify(stored.password, password)).toBe(true);
    expect(result.body.user.role).toBe('USER');
    expect(result.body.user.isVerified).toBe(false);
    expect(result.body).not.toHaveProperty('refreshToken');
    expect(result.body).not.toHaveProperty('refreshCookie');
    expect(result.body.user).not.toHaveProperty('password');
    expect(result.response.headers['cache-control']).toBe('no-store');
    const setCookie = String(result.response.headers['set-cookie']);
    expect(setCookie).toContain(REFRESH_COOKIE_NAME + '=');
    expect(setCookie).toMatch(/; HttpOnly/i);
    expect(setCookie).toMatch(/; Secure/i);
    expect(setCookie).toMatch(/; Path=\//i);
    expect(setCookie).toMatch(/; SameSite=Lax/i);
    expect(setCookie).not.toMatch(/; Domain=/i);
    expect(result.response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(received).toHaveLength(1);
    expect(received[0].userId).toBe(result.body.user.id);
    const log = await database.prisma.auditLog.findFirstOrThrow({
      where: { actorId: result.body.user.id },
    });
    expect(log.targetId).toBe(result.body.user.id);
    expect(log.metadata).toMatchObject({
      event: USER_REGISTERED_EVENT,
      requestId: result.response.headers['x-request-id'],
    });
    const claims = app
      .get(JwtService)
      .decode<TokenClaims>(result.cookie.split('=')[1]);
    const key = app.get(SessionRepository).tokenKey(claims.sub, claims.jti);
    const storedToken = await app
      .get(RedisService)
      .execute((client) => client.get(key));
    expect(storedToken).toBe(claims.did + ':' + claims.sid);
    expect(storedToken).not.toBe(result.cookie.split('=')[1]);
    expect((await me(result.body.accessToken)).statusCode).toBe(200);
  });

  it('validates DTOs, rejects privilege injection and reports duplicate accounts', async () => {
    expect(
      (
        await post('register', {
          username: 'x',
          email: 'invalid',
          password: 'short',
        })
      ).statusCode,
    ).toBe(400);
    const user = await register();
    expect(
      (await post('register', { ...user.input, role: 'ADMIN' })).statusCode,
    ).toBe(400);
    expect((await post('register', user.input)).statusCode).toBe(409);
    expect(
      (
        await post('register', {
          ...user.input,
          email: 'new-' + user.input.email,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post('register', {
          ...user.input,
          email: user.input.email.toUpperCase(),
        })
      ).statusCode,
    ).toBe(409);
  });

  it('logs in with a normalized email and gives the same failure for wrong password or missing user', async () => {
    const user = await register();
    const loggedIn = await post('login', {
      email: ' ' + user.input.email.toUpperCase() + ' ',
      password,
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.json<AuthResponseDto>().user.id).toBe(user.body.user.id);
    const wrong = await post('login', {
      email: user.input.email,
      password: 'a-wrong-password-2026',
    });
    const missing = await post('login', {
      email: 'missing@example.com',
      password,
    });
    expect(wrong.statusCode).toBe(401);
    expect(missing.json()).toEqual(wrong.json());
  });

  it('rotates exactly once and revokes the token family when a used token is replayed', async () => {
    const user = await register();
    const rotated = await post('refresh', undefined, user.cookie);
    expect(rotated.statusCode).toBe(200);
    const nextCookie = cookieOf(rotated);
    expect(nextCookie).not.toBe(user.cookie);
    const next = rotated.json<AuthResponseDto>();
    expect(next.accessToken).not.toBe(user.body.accessToken);
    expect((await me(next.accessToken)).statusCode).toBe(200);
    const replay = await post('refresh', undefined, user.cookie);
    expect(replay.statusCode).toBe(401);
    expect(String(replay.headers['set-cookie'])).toContain(
      REFRESH_COOKIE_NAME + '=;',
    );
    expect((await post('refresh', undefined, nextCookie)).statusCode).toBe(401);
    expect((await me(next.accessToken)).statusCode).toBe(401);
    expect((await me(user.body.accessToken)).statusCode).toBe(401);
  });

  it('serializes concurrent refresh attempts and persists replay revocation after the transaction', async () => {
    const user = await register();
    const results = await Promise.all([
      post('refresh', undefined, user.cookie),
      post('refresh', undefined, user.cookie),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 401,
    ]);
    const winner = results.find((result) => result.statusCode === 200)!;
    expect(
      (await me(winner.json<AuthResponseDto>().accessToken)).statusCode,
    ).toBe(401);
    const claims = app
      .get(JwtService)
      .decode<TokenClaims>(user.body.accessToken);
    expect(
      await app
        .get(SessionRepository)
        .findActive(claims.sub, claims.did, claims.sid),
    ).toBeNull();
  });

  it('logs out the current session, deletes its cookie and leaves other logins active', async () => {
    const user = await register();
    const other = await post('login', { email: user.input.email, password });
    const logout = await post('logout', undefined, user.cookie);
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers['set-cookie'])).toContain(
      REFRESH_COOKIE_NAME + '=;',
    );
    expect((await me(user.body.accessToken)).statusCode).toBe(401);
    expect((await post('refresh', undefined, user.cookie)).statusCode).toBe(
      401,
    );
    expect(
      (await me(other.json<AuthResponseDto>().accessToken)).statusCode,
    ).toBe(200);
    expect((await post('logout')).statusCode).toBe(200);
  });

  it('rejects missing/tampered tokens and access/refresh token substitution', async () => {
    const user = await register();
    expect(
      (await app.inject({ method: 'GET', url: '/v1/auth/me' })).statusCode,
    ).toBe(401);
    expect((await me(user.body.accessToken + 'broken')).statusCode).toBe(401);
    expect((await me(user.cookie.split('=')[1])).statusCode).toBe(401);
    expect(
      (
        await post(
          'refresh',
          undefined,
          REFRESH_COOKIE_NAME + '=' + user.body.accessToken,
        )
      ).statusCode,
    ).toBe(401);
    expect((await post('refresh')).statusCode).toBe(401);
  });

  it('enforces expiration, issuer, audience, algorithm and required claims', async () => {
    const user = await register();
    const jwt = app.get(JwtService);
    const settings = database.config.getOrThrow<AppSettings>('app').jwt;
    const original = jwt.decode<TokenClaims>(user.body.accessToken);
    const base = {
      sub: original.sub,
      sid: original.sid,
      did: original.did,
      jti: randomUUID(),
      tokenType: 'access',
    };
    for (const variant of [
      { issuer: 'other', audience: settings.audience, expiresIn: 900 },
      { issuer: settings.issuer, audience: 'other', expiresIn: 900 },
      { issuer: settings.issuer, audience: settings.audience, expiresIn: -1 },
    ]) {
      const token = await jwt.signAsync(base, {
        ...variant,
        secret: settings.accessSecret,
        algorithm: 'HS256',
      });
      expect((await me(token)).statusCode).toBe(401);
    }
    const wrongAlgorithm = await jwt.signAsync(base, {
      secret: settings.accessSecret,
      algorithm: 'HS384',
      issuer: settings.issuer,
      audience: settings.audience,
      expiresIn: 900,
    });
    expect((await me(wrongAlgorithm)).statusCode).toBe(401);
    const noExpiry = await jwt.signAsync(base, {
      secret: settings.accessSecret,
      issuer: settings.issuer,
      audience: settings.audience,
    });
    expect((await me(noExpiry)).statusCode).toBe(401);
  });

  it('does not extend the original session expiry during rotation', async () => {
    const user = await register();
    const claims = app
      .get(JwtService)
      .decode<TokenClaims>(user.body.accessToken);
    const sessions = app.get(SessionRepository);
    const before = await sessions.findActive(
      claims.sub,
      claims.did,
      claims.sid,
    );
    const rotated = await post('refresh', undefined, user.cookie);
    expect(rotated.statusCode).toBe(200);
    const after = await sessions.findActive(claims.sub, claims.did, claims.sid);
    expect(before).not.toBeNull();
    expect(after?.expiresAt).toEqual(before?.expiresAt);
    await app
      .get(RedisService)
      .execute((client) =>
        client.hset(
          sessions.sessionKey(claims.sub, claims.did),
          'exp',
          String(Date.now() - 1000),
        ),
      );
    expect(
      (await post('refresh', undefined, cookieOf(rotated))).statusCode,
    ).toBe(401);
    expect(
      (await me(rotated.json<AuthResponseDto>().accessToken)).statusCode,
    ).toBe(401);
  });

  it('checks roles against current DB state using the global role guard', async () => {
    const user = await register();
    const request = () =>
      app.inject({
        method: 'GET',
        url: '/v1/role-test',
        headers: { authorization: 'Bearer ' + user.body.accessToken },
      });
    expect((await request()).statusCode).toBe(403);
    await database.prisma.user.update({
      where: { id: user.body.user.id },
      data: { role: 'ADMIN' },
    });
    expect((await request()).statusCode).toBe(200);
    await database.prisma.user.update({
      where: { id: user.body.user.id },
      data: { role: 'USER' },
    });
    expect((await request()).statusCode).toBe(403);
  });

  it('rejects CSRF requests and supports credentialed CORS for the configured frontend', async () => {
    expect(
      (
        await post(
          'login',
          { email: 'test@example.com', password },
          undefined,
          { 'x-auth-request': '' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post('refresh', undefined, undefined, {
          origin: 'https://evil.example',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post('logout', undefined, undefined, { origin: 'null' }))
        .statusCode,
    ).toBe(403);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/refresh',
      headers: {
        origin: 'https://web.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-auth-request,content-type',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://web.example.test',
    );
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    const blocked = await app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/refresh',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('limits repeated login attempts', async () => {
    for (let index = 0; index < 10; index++) {
      expect(
        (
          await post(
            'login',
            { email: 'rate@example.com', password },
            undefined,
            {},
            '198.51.100.10',
          )
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await post(
          'login',
          { email: 'rate@example.com', password },
          undefined,
          {},
          '198.51.100.10',
        )
      ).statusCode,
    ).toBe(429);
  });

  it('documents request/response DTOs, JWT bearer auth and the refresh cookie in Swagger', async () => {
    for (const route of ['register', 'login', 'refresh', 'logout', 'me']) {
      expect(document.paths['/v1/auth/' + route]).toBeDefined();
    }
    const registrationSchema = document.components?.schemas?.RegisterDto;
    if (!registrationSchema || !('required' in registrationSchema)) {
      throw new Error('RegisterDto required fields are missing from Swagger');
    }
    expect(registrationSchema.required).toEqual(
      expect.arrayContaining(['email', 'password', 'username']),
    );
    expect(document.components?.schemas?.AuthResponseDto).toBeDefined();
    expect(document.components?.securitySchemes?.accessToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.components?.securitySchemes?.refreshToken).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: REFRESH_COOKIE_NAME,
    });
    expect((await app.inject({ method: 'GET', url: '/docs' })).statusCode).toBe(
      200,
    );
  });
});

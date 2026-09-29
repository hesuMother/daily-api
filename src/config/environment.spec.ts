import { validateEnvironment } from './environment';

function validEnvironment() {
  return {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
  };
}

describe('Environment validation', () => {
  it('requires a Redis URL and rejects unsafe key prefixes', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment(), REDIS_URL: '' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        REDIS_URL: 'https://example.com',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        REDIS_KEY_PREFIX: 'auth:{shared}',
      }),
    ).toThrow();
  });
  it('rejects missing, short and shared signing keys', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment(), JWT_ACCESS_SECRET: '' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        JWT_REFRESH_SECRET: 'short',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        JWT_REFRESH_SECRET: 'a'.repeat(48),
      }),
    ).toThrow();
  });

  it('requires trusted proxy addresses when proxy support is enabled', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment(), USE_REVERSE_PROXY: 'true' }),
    ).toThrow();
    const settings = validateEnvironment({
      ...validEnvironment(),
      USE_REVERSE_PROXY: 'true',
      TRUSTED_PROXIES: '127.0.0.1, ::1',
    }).app;
    expect(settings.trustProxy).toEqual(['127.0.0.1', '::1']);
  });

  it('rejects invalid ports, TTLs and cookie options', () => {
    for (const input of [
      { PORT: 0 },
      { PORT: 65536 },
      { JWT_ACCESS_TTL_SECONDS: 3601 },
      { JWT_REFRESH_TTL_SECONDS: 30 },
      { REFRESH_COOKIE_SAME_SITE: 'invalid' },
    ]) {
      expect(() =>
        validateEnvironment({ ...validEnvironment(), ...input }),
      ).toThrow();
    }
  });

  it('requires HTTPS origins in production and rejects wildcard/path origins', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment(), NODE_ENV: 'production' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ ...validEnvironment(), CORS_ORIGINS: '*' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...validEnvironment(),
        CORS_ORIGINS: 'https://example.com/path',
      }),
    ).toThrow();
    expect(
      validateEnvironment({
        ...validEnvironment(),
        NODE_ENV: 'production',
        API_ORIGIN: 'https://api.example.com',
        CORS_ORIGINS: 'https://app.example.com',
      }).app.isProduction,
    ).toBe(true);
  });
});

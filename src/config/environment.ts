import {
  productSyncSettings,
  type ProductSyncSettings,
} from './product-sync.config';

import { discordSettings, type DiscordSettings } from './discord.config';

export interface AppSettings {
  discord: DiscordSettings;
  outfitUploadDir: string;
  productSync: ProductSyncSettings;
  port: number;
  isProduction: boolean;
  trustProxy: false | string[];
  apiOrigin: string;
  corsOrigins: string[];
  swaggerServers: { url: string; description: string }[];
  databaseUrl: string;
  redis: { url: string; keyPrefix: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  refreshCookieSameSite: 'lax' | 'strict' | 'none';
}

function list(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function required(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(key + ' 환경변수를 지정해야 합니다.');
  }
  return value;
}

function integer(value: unknown, fallback: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(
      '포트와 토큰 만료 시간은 허용 범위의 양의 정수여야 합니다.',
    );
  }
  return parsed;
}

function httpUrl(value: string): URL {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      '서버 주소는 자격 증명이 없는 HTTP/HTTPS URL이어야 합니다.',
    );
  }
  return url;
}

function origin(value: string): string {
  const url = httpUrl(value);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Origin에는 경로, 쿼리, 해시를 포함할 수 없습니다.');
  }
  return url.origin;
}

export function validateEnvironment(raw: Record<string, unknown>): {
  app: AppSettings;
} {
  const port = integer(raw.PORT, 3000, 65535);
  const isProduction = raw.NODE_ENV === 'production';
  if (
    raw.USE_REVERSE_PROXY !== undefined &&
    raw.USE_REVERSE_PROXY !== 'true' &&
    raw.USE_REVERSE_PROXY !== 'false'
  ) {
    throw new Error('USE_REVERSE_PROXY는 true 또는 false여야 합니다.');
  }
  const proxies = list(raw.TRUSTED_PROXIES);
  if (raw.USE_REVERSE_PROXY === 'true' && proxies.length === 0) {
    throw new Error(
      '프록시를 사용하면 TRUSTED_PROXIES에 IP/CIDR을 지정해야 합니다.',
    );
  }
  const accessSecret = required(raw, 'JWT_ACCESS_SECRET');
  const refreshSecret = required(raw, 'JWT_REFRESH_SECRET');
  if (
    Buffer.byteLength(accessSecret) < 32 ||
    Buffer.byteLength(refreshSecret) < 32 ||
    accessSecret === refreshSecret
  ) {
    throw new Error('JWT 비밀키는 각각 32바이트 이상이며 서로 달라야 합니다.');
  }
  const databaseUrl = required(raw, 'DATABASE_URL');
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('DATABASE_URL은 PostgreSQL 연결 문자열이어야 합니다.');
  }
  const sameSite = raw.REFRESH_COOKIE_SAME_SITE ?? 'lax';
  const redisUrl = required(raw, 'REDIS_URL');
  if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol)) {
    throw new Error(
      'REDIS_URL은 redis:// 또는 rediss:// 연결 문자열이어야 합니다.',
    );
  }
  const redisPrefix = raw.REDIS_KEY_PREFIX ?? 'daily:auth';
  if (
    typeof redisPrefix !== 'string' ||
    !/^[a-zA-Z0-9:_-]{1,64}$/.test(redisPrefix)
  ) {
    throw new Error(
      'REDIS_KEY_PREFIX는 영문, 숫자, :, _, -로 구성된 1~64자여야 합니다.',
    );
  }
  if (sameSite !== 'lax' && sameSite !== 'strict' && sameSite !== 'none') {
    throw new Error(
      'REFRESH_COOKIE_SAME_SITE는 lax, strict, none 중 하나여야 합니다.',
    );
  }
  const apiOrigin = origin(
    typeof raw.API_ORIGIN === 'string'
      ? raw.API_ORIGIN
      : 'http://localhost:' + port,
  );
  const corsOrigins = list(raw.CORS_ORIGINS).map(origin);
  if (
    isProduction &&
    [apiOrigin, ...corsOrigins].some((value) => !value.startsWith('https://'))
  ) {
    throw new Error(
      '운영 환경의 API_ORIGIN과 CORS_ORIGINS에는 HTTPS 주소가 필요합니다.',
    );
  }
  const accessTtlSeconds = integer(raw.JWT_ACCESS_TTL_SECONDS, 900, 3600);
  const refreshTtlSeconds = integer(
    raw.JWT_REFRESH_TTL_SECONDS,
    604800,
    2592000,
  );
  if (refreshTtlSeconds <= accessTtlSeconds) {
    throw new Error('갱신 토큰 만료 시간은 액세스 토큰보다 길어야 합니다.');
  }
  return {
    app: {
      discord: discordSettings(raw),
      outfitUploadDir:
        typeof raw.OUTFIT_UPLOAD_DIR === 'string' &&
        raw.OUTFIT_UPLOAD_DIR.trim()
          ? raw.OUTFIT_UPLOAD_DIR.trim()
          : '.data/outfits',
      productSync: productSyncSettings(raw),
      port,
      isProduction,
      trustProxy: raw.USE_REVERSE_PROXY === 'true' ? proxies : false,
      apiOrigin,
      corsOrigins,
      databaseUrl,
      redis: { url: redisUrl, keyPrefix: redisPrefix },
      refreshCookieSameSite: sameSite,
      swaggerServers: [
        { url: apiOrigin, description: '현재 API 서버' },
        ...list(raw.SWAGGER_EXTRA_SERVERS).map((value) => {
          const url = httpUrl(value);
          return { url: url.href.replace(/\/$/, ''), description: url.host };
        }),
      ],
      jwt: {
        accessSecret,
        refreshSecret,
        accessTtlSeconds,
        refreshTtlSeconds,
        issuer:
          typeof raw.JWT_ISSUER === 'string' && raw.JWT_ISSUER.trim()
            ? raw.JWT_ISSUER
            : 'daily-api',
        audience:
          typeof raw.JWT_AUDIENCE === 'string' && raw.JWT_AUDIENCE.trim()
            ? raw.JWT_AUDIENCE
            : 'daily-web',
      },
    },
  };
}

import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PrismaService } from '../src/database/prisma.service';
import { validateEnvironment } from '../src/config/environment';
import { Redis } from 'ioredis';

export async function createTestDatabase(
  beforeMigration?: (client: Client, name: string) => Promise<void>,
) {
  const environment = new ConfigService();
  const connectionString = environment.getOrThrow<string>('DATABASE_URL');
  const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await admin.connect();
  await admin.query('CREATE SCHEMA "' + schema + '"');
  let prisma: PrismaService | undefined;
  const redisPrefix = 'daily:test:' + schema.slice('auth_test_'.length);
  const redis = new Redis(environment.getOrThrow<string>('REDIS_URL'), {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await prisma?.$disconnect();
    // 여기서 만든 테스트 스키마만 제거합니다.
    if (!/^auth_test_[a-f0-9]{32}$/.test(schema))
      throw new Error('Invalid test schema');
    try {
      if (
        redis.status === 'ready' &&
        /^daily:test:[a-f0-9]{32}$/.test(redisPrefix)
      ) {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(
            cursor,
            'MATCH',
            redisPrefix + ':*',
            'COUNT',
            100,
          );
          cursor = next;
          if (keys.length) await redis.unlink(...keys);
        } while (cursor !== '0');
      }
      await admin.query('ROLLBACK');
      await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    } finally {
      redis.disconnect();
      await admin.end();
    }
  };
  try {
    await redis.connect();
    await admin.query('SET search_path TO "' + schema + '"');
    const migrations = (
      await readdir('prisma/migrations', { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of migrations) {
      await beforeMigration?.(admin, name);
      await admin.query(
        await readFile('prisma/migrations/' + name + '/migration.sql', 'utf8'),
      );
    }
    const url = new URL(connectionString);
    url.searchParams.set('schema', schema);
    const config = new ConfigService(
      validateEnvironment({
        DATABASE_URL: url.toString(),
        REDIS_URL: environment.getOrThrow<string>('REDIS_URL'),
        REDIS_KEY_PREFIX: redisPrefix,
        JWT_ACCESS_SECRET: environment.getOrThrow<string>('JWT_ACCESS_SECRET'),
        JWT_REFRESH_SECRET:
          environment.getOrThrow<string>('JWT_REFRESH_SECRET'),
        API_ORIGIN: 'https://api.example.test',
        CORS_ORIGINS: 'https://web.example.test',
        NODE_ENV: 'test',
      }),
    );
    prisma = new PrismaService(config);
    await prisma.$connect();
    return { prisma, config, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

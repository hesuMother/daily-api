import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { AppSettings } from '../config/environment';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: ConfigService) {
    const { databaseUrl } = config.getOrThrow<AppSettings>('app');
    const url = new URL(databaseUrl);
    super({
      adapter: new PrismaPg(
        {
          connectionString: databaseUrl,
          connectionTimeoutMillis: 5000,
          statement_timeout: 10000,
          max: 10,
        },
        { schema: url.searchParams.get('schema') ?? 'public' },
      ),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async ping(): Promise<void> {
    await this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
        await tx.$queryRaw`SELECT 1`;
      },
      { maxWait: 1000, timeout: 2500 },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

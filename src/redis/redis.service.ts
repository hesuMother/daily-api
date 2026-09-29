import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppSettings } from '../config/environment';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);
  readonly keyPrefix: string;

  constructor(config: ConfigService) {
    const settings = config.getOrThrow<AppSettings>('app').redis;
    this.keyPrefix = settings.keyPrefix;
    this.client = new Redis(settings.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 3000,
      autoResendUnfulfilledCommands: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
    });
    this.client.on('error', () =>
      this.logger.warn('Redis 연결 오류가 발생했습니다.'),
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.client.status === 'ready') return;
    try {
      await this.client.connect();
      await this.client.ping();
    } catch {
      this.client.disconnect();
      throw new ServiceUnavailableException(
        '인증 저장소에 연결할 수 없습니다.',
      );
    }
  }

  async execute<T>(operation: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await operation(this.client);
    } catch {
      // Redis 장애 시 DB 세션이나 무검증 인증으로 우회하지 않습니다.
      throw new ServiceUnavailableException(
        '인증 저장소를 사용할 수 없습니다.',
      );
    }
  }

  async ping(): Promise<void> {
    await this.execute((client) => client.ping());
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}

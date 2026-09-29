import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';

export interface Readiness {
  status: 'ok' | 'error';
  checks: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

@Injectable()
export class AppService implements OnModuleDestroy {
  private stopping = false;
  private pending?: Promise<Readiness>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  liveness() {
    return { status: 'ok' as const };
  }

  async readiness(): Promise<Readiness> {
    if (this.stopping)
      throw new ServiceUnavailableException({ status: 'shutting_down' });
    // 동시 probe는 같은 점검을 공유해 장애 중 연결 풀을 소진하지 않습니다.
    this.pending ??= this.checkDependencies().finally(() => {
      this.pending = undefined;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ServiceUnavailableException({ status: 'error' })),
            3000,
          );
        }),
      ]);
      if (this.stopping)
        throw new ServiceUnavailableException({ status: 'shutting_down' });
      if (result.status === 'error')
        throw new ServiceUnavailableException(result);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkDependencies(): Promise<Readiness> {
    const results = await Promise.allSettled([
      this.prisma.ping(),
      this.redis.ping(),
    ]);
    return {
      status: results.every((result) => result.status === 'fulfilled')
        ? 'ok'
        : 'error',
      checks: {
        database: results[0].status === 'fulfilled' ? 'up' : 'down',
        redis: results[1].status === 'fulfilled' ? 'up' : 'down',
      },
    };
  }

  onModuleDestroy(): void {
    this.stopping = true;
  }
}

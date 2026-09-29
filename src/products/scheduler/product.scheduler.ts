import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { AppSettings } from '../../config/environment';
import type { ProductSyncSettings } from '../../config/product-sync.config';
import { CoupangCollector } from '../collectors/coupang/coupang.collector';
import { CoupangProtocol } from '../collectors/coupang/coupang.protocol';
import { ProductSyncService } from '../sync/product-sync.service';

@Injectable()
export class ProductScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductScheduler.name);
  private readonly jobName = 'coupang-product-sync';
  private activeRun?: Promise<void>;
  private cancellation?: AbortController;
  private stopping = false;
  private readonly settings: ProductSyncSettings;

  constructor(
    config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly collector: CoupangCollector,
    private readonly syncService: ProductSyncService,
    private readonly protocol: CoupangProtocol,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').productSync;
  }

  onModuleInit(): void {
    if (!this.settings.enabled) return;
    this.protocol.assertConfigured();
    const job = CronJob.from({
      cronTime: this.settings.cron,
      timeZone: 'Asia/Seoul',
      onTick: () => this.syncCoupangProducts(),
      waitForCompletion: true,
    });
    this.registry.addCronJob(this.jobName, job);
    job.start();
  }

  syncCoupangProducts(): Promise<void> {
    if (!this.settings.enabled || this.stopping || this.activeRun)
      return Promise.resolve();
    this.cancellation = new AbortController();
    this.activeRun = this.run(this.cancellation.signal).finally(() => {
      this.activeRun = undefined;
    });
    return this.activeRun;
  }

  private async run(signal: AbortSignal): Promise<void> {
    try {
      const products = await this.collector.collect(signal);
      signal.throwIfAborted();
      const result = await this.syncService.syncMany(
        products,
        this.collector.source,
        signal,
      );
      this.logger.log(`Coupang sync completed: ${JSON.stringify(result)}`);
    } catch {
      if (!signal.aborted)
        this.logger.error(
          'Coupang sync failed; no automatic whole-batch retry',
        );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.cancellation?.abort();
    if (this.registry.doesExist('cron', this.jobName))
      this.registry.deleteCronJob(this.jobName);
    // 진행 중인 단건 트랜잭션이 끝난 후에만 DB 연결 종료 단계로 넘어갑니다.
    await this.activeRun;
  }
}

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { AppSettings } from '../../config/environment';
import { ProductDiscoveryService } from './product-discovery.service';

/**
 * Collects new products from providers that publish a listing, every CRAWLER_DISCOVERY_INTERVAL_MS.
 * Runs in-process only: several app instances may visit the same pages, but offer unique keys prevent duplicates.
 */
@Injectable()
export class ProductDiscoveryScheduler implements OnModuleDestroy {
  private readonly settings: AppSettings['crawler'];
  private readonly logger = new Logger(ProductDiscoveryScheduler.name);
  private running?: Promise<void>;
  private lastStartedAt = 0;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly discovery: ProductDiscoveryService,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').crawler;
  }

  @Interval('product-discovery', 60000)
  async tick(now = Date.now()): Promise<void> {
    if (
      !this.settings.enabled ||
      !this.settings.discoveryEnabled ||
      this.stopping
    )
      return;
    if (this.running) return this.running;
    if (now - this.lastStartedAt < this.settings.discoveryIntervalMs) return;
    this.lastStartedAt = now;
    this.running = this.runBatch()
      .catch(() => {
        this.logger.error('Product discovery batch failed.');
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async runBatch(): Promise<void> {
    for (const provider of this.discovery.discoverableProviders()) {
      if (this.stopping) break;
      const result = await this.discovery.discover(provider);
      this.logger.log(
        JSON.stringify({
          provider,
          visited: result.visited,
          skipped: result.skipped,
          saved: result.saved,
          failures: result.failures.map((failure) => failure.code),
        }),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.running;
  }
}

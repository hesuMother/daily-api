import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { AppSettings } from '../../config/environment';
import { ProductService } from '../product.service';
import {
  ProductRefreshRepository,
  type RefreshClaim,
} from '../repository/product-refresh.repository';

@Injectable()
export class ProductRefreshScheduler implements OnModuleDestroy {
  private readonly settings: AppSettings['crawler'];
  private readonly logger = new Logger(ProductRefreshScheduler.name);
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly products: ProductService,
    private readonly refreshes: ProductRefreshRepository,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').crawler;
  }

  @Interval('product-refresh', 60000)
  async tick(): Promise<void> {
    if (
      !this.settings.enabled ||
      !this.settings.refreshEnabled ||
      this.stopping
    )
      return;
    if (this.running) return this.running;
    this.running = this.runBatch()
      .catch(() => {
        this.logger.error(
          'Product refresh batch failed; due offers will be retried.',
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async runBatch(): Promise<void> {
    const providerIds = this.products
      .listProviders()
      .map((provider) => provider.id);
    if (!providerIds.length) return;
    for (let i = 0; i < this.settings.refreshBatchSize && !this.stopping; i++) {
      const claim = await this.refreshes.claim(
        providerIds,
        this.settings.refreshIntervalMs,
        new Date(),
      );
      if (!claim) break;
      const error = await this.refreshOffer(claim);
      await this.refreshes.finish(
        claim,
        error
          ? this.settings.refreshRetryDelayMs
          : this.settings.refreshIntervalMs,
        error,
      );
      if (error === 'LIGHTPANDA_UNAVAILABLE') break;
    }
  }

  private async refreshOffer(claim: RefreshClaim): Promise<string | null> {
    let renewal: Promise<void> | undefined;
    let lostLease = false;
    // Keep the claim alive while a manual crawl occupies the shared queue.
    const heartbeat = setInterval(() => {
      if (renewal || lostLease) return;
      renewal = this.refreshes
        .renew(claim)
        .then((owned) => {
          if (!owned) lostLease = true;
        })
        .catch(() => {
          lostLease = true;
          this.logger.warn('Product refresh lease could not be renewed.');
        })
        .finally(() => {
          renewal = undefined;
        });
    }, 30000);
    heartbeat.unref();
    try {
      const result = await this.products.refreshOffer(claim.id);
      const error = result.failures.length
        ? [...new Set(result.failures.map((failure) => failure.code))].join(',')
        : result.products.length
          ? null
          : 'PRODUCT_NOT_FOUND';
      this.logger.log(
        JSON.stringify({ offerId: claim.id, saved: result.saved, error }),
      );
      return error;
    } catch {
      this.logger.warn(
        JSON.stringify({ offerId: claim.id, code: 'REFRESH_FAILED' }),
      );
      return 'REFRESH_FAILED';
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.running;
  }
}

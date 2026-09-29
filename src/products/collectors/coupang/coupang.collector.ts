import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppSettings } from '../../../config/environment';
import type { ProductSyncSettings } from '../../../config/product-sync.config';
import {
  validateCollectedProduct,
  type CollectedProduct,
} from '../collected-product.interface';
import type { ProductCollector } from '../product-collector.interface';
import { CoupangClient } from './coupang.client';
import { CoupangProtocol } from './coupang.protocol';

@Injectable()
export class CoupangCollector implements ProductCollector {
  readonly source = { slug: 'coupang', name: 'Coupang' };
  private readonly logger = new Logger(CoupangCollector.name);
  private readonly settings: ProductSyncSettings;

  constructor(
    config: ConfigService,
    private readonly client: CoupangClient,
    private readonly protocol: CoupangProtocol,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').productSync;
  }

  async collect(signal?: AbortSignal): Promise<CollectedProduct[]> {
    const products = new Map<string, CollectedProduct>();
    let rejected = 0;
    // 키워드는 설정에서 받아 큐/수동 호출에서도 같은 수집 계약을 사용합니다.
    for (const keyword of this.settings.keywords) {
      signal?.throwIfAborted();
      const response = await this.client.search({ keyword }, signal);
      for (const candidate of this.protocol.toCandidates(response)) {
        try {
          const product = validateCollectedProduct(candidate);
          products.set(product.externalProductId, product);
        } catch {
          rejected++;
        }
      }
    }
    if (rejected)
      this.logger.warn(`Skipped ${rejected} invalid collected products`);
    return [...products.values()];
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  InvalidCollectedProductError,
  validateCollectedProduct,
  type CollectedProduct,
  type ProductSource,
} from '../collectors/collected-product.interface';
import { ProductSyncRepository } from '../repository/product-sync.repository';

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

@Injectable()
export class ProductSyncService {
  private readonly logger = new Logger(ProductSyncService.name);
  constructor(private readonly repository: ProductSyncRepository) {}

  sync(product: CollectedProduct, source: ProductSource) {
    this.validateSource(source);
    return this.repository.sync(source, validateCollectedProduct(product));
  }

  async syncMany(
    products: readonly CollectedProduct[],
    source: ProductSource,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    this.validateSource(source);
    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
    };
    for (const product of products) {
      signal?.throwIfAborted();
      try {
        result[await this.sync(product, source)]++;
      } catch (error) {
        const itemError =
          error instanceof InvalidCollectedProductError ||
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            ['P2000', 'P2003', 'P2004', 'P2011'].includes(error.code));
        if (!itemError) {
          this.logger.error(`Product batch stopped: ${JSON.stringify(result)}`);
          throw error; // 연결 장애, 스키마 불일치, 알 수 없는 장애는 배치를 중단합니다.
        }
        result.failed++;
        this.logger.warn('Skipped one invalid product during sync');
      }
    }
    return result;
  }

  private validateSource(source: ProductSource): void {
    if (
      !source ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.slug) ||
      !source.name?.trim()
    ) {
      throw new Error('Invalid product source');
    }
  }
}

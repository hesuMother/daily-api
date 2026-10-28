import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProductSyncRepository } from './repository/product-sync.repository';
import { ProductSyncService } from './sync/product-sync.service';
import { CrawlerModule } from '../crawler/crawler.module';
import { ProductService } from './product.service';
import { ProductAdminController } from './product-admin.controller';
import { ProductRefreshRepository } from './repository/product-refresh.repository';
import { ProductRefreshScheduler } from './scheduler/product-refresh.scheduler';
import { RedisModule } from '../redis/redis.module';
import { ProductDiscoveryService } from './discovery/product-discovery.service';
import { ProductDiscoveryScheduler } from './discovery/product-discovery.scheduler';

@Module({
  imports: [DatabaseModule, CrawlerModule, RedisModule],
  controllers: [ProductAdminController],
  providers: [
    ProductSyncRepository,
    ProductSyncService,
    ProductService,
    ProductRefreshRepository,
    ProductRefreshScheduler,
    ProductDiscoveryService,
    ProductDiscoveryScheduler,
  ],
  exports: [ProductSyncService, ProductService],
})
export class ProductsModule {}

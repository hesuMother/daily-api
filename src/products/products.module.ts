import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CoupangClient } from './collectors/coupang/coupang.client';
import { CoupangCollector } from './collectors/coupang/coupang.collector';
import { CoupangProtocol } from './collectors/coupang/coupang.protocol';
import { ProductSyncRepository } from './repository/product-sync.repository';
import { ProductSyncService } from './sync/product-sync.service';
import { ProductScheduler } from './scheduler/product.scheduler';

@Module({
  imports: [DatabaseModule],
  providers: [
    CoupangProtocol,
    CoupangClient,
    CoupangCollector,
    ProductSyncRepository,
    ProductSyncService,
    ProductScheduler,
  ],
  exports: [ProductSyncService],
})
export class ProductsModule {}

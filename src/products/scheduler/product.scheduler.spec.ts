import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { productSyncSettings } from '../../config/product-sync.config';
import { CoupangCollector } from '../collectors/coupang/coupang.collector';
import { CoupangProtocol } from '../collectors/coupang/coupang.protocol';
import { ProductSyncService } from '../sync/product-sync.service';
import { ProductScheduler } from './product.scheduler';
import type { CollectedProduct } from '../collectors/collected-product.interface';

describe('ProductScheduler', () => {
  function setup(enabled: boolean) {
    const settings = { ...productSyncSettings({}), enabled };
    const registry = new SchedulerRegistry();
    const collect = jest
      .fn<CoupangCollector['collect']>()
      .mockResolvedValue([]);
    const syncMany = jest
      .fn<ProductSyncService['syncMany']>()
      .mockResolvedValue({ created: 0, updated: 0, unchanged: 0, failed: 0 });
    const protocol = new CoupangProtocol();
    const scheduler = new ProductScheduler(
      new ConfigService({ app: { productSync: settings } }),
      registry,
      {
        collect,
        source: { slug: 'coupang', name: 'Coupang' },
      } as unknown as CoupangCollector,
      { syncMany } as unknown as ProductSyncService,
      protocol,
    );
    return { scheduler, registry, collect, syncMany, protocol };
  }
  it('registers no jobs and makes no calls when disabled', async () => {
    const { scheduler, registry, collect } = setup(false);
    scheduler.onModuleInit();
    await scheduler.syncCoupangProducts();
    expect(registry.getCronJobs().size).toBe(0);
    expect(collect).not.toHaveBeenCalled();
  });
  it('blocks activation when the API contract is unverified', () => {
    const { scheduler } = setup(true);
    expect(() => scheduler.onModuleInit()).toThrow('official documentation');
  });
  it('registers the configured job without running on startup, and removes it on shutdown', async () => {
    const { scheduler, registry, collect, protocol } = setup(true);
    jest.spyOn(protocol, 'assertConfigured').mockReturnValue(undefined);
    try {
      scheduler.onModuleInit();
      expect(registry.getCronJobs().size).toBe(1);
      expect(collect).not.toHaveBeenCalled();
    } finally {
      await scheduler.onModuleDestroy();
    }
    expect(registry.getCronJobs().size).toBe(0);
  });
  it('skips overlapping runs and releases the guard after a failure', async () => {
    const { scheduler, collect, syncMany } = setup(true);
    let finish!: (products: CollectedProduct[]) => void;
    collect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = scheduler.syncCoupangProducts();
    await scheduler.syncCoupangProducts();
    expect(collect).toHaveBeenCalledTimes(1);
    finish([]);
    await first;
    collect.mockRejectedValueOnce(new Error('API failed'));
    await scheduler.syncCoupangProducts();
    await scheduler.syncCoupangProducts();
    expect(collect).toHaveBeenCalledTimes(3);
    expect(syncMany).toHaveBeenCalledTimes(2);
  });

  it('cancels new work and waits for an in-flight sync before shutdown completes', async () => {
    const { scheduler, collect, syncMany } = setup(true);
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    syncMany.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = () =>
          resolve({ created: 1, updated: 0, unchanged: 0, failed: 0 });
      });
    });
    const run = scheduler.syncCoupangProducts();
    await entered;
    let closed = false;
    const closing = scheduler.onModuleDestroy().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(collect.mock.calls[0][0]?.aborted).toBe(true);
    await scheduler.syncCoupangProducts();
    expect(collect).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([run, closing]);
    expect(closed).toBe(true);
  });
});

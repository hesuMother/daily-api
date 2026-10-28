import { jest } from '@jest/globals';
import { ProductSyncService } from './product-sync.service';
import { ProductSyncRepository } from '../repository/product-sync.repository';

describe('ProductSyncService batches', () => {
  const source = { slug: 'test-shop', name: 'Test Shop' };
  const product = { externalProductId: '42', name: 'Shirt', price: 1000 };
  const make = () => {
    const sync = jest
      .fn<ProductSyncRepository['sync']>()
      .mockResolvedValue('created');
    return {
      sync,
      service: new ProductSyncService({
        sync,
      } as unknown as ProductSyncRepository),
    };
  };
  it('continues after a malformed product', async () => {
    const { sync, service } = make();
    expect(
      await service.syncMany(
        [
          product,
          { ...product, price: -1 },
          { ...product, externalProductId: '43' },
        ],
        source,
      ),
    ).toEqual({ created: 2, updated: 0, unchanged: 0, failed: 1 });
    expect(sync).toHaveBeenCalledTimes(2);
  });
  it('stops on infrastructure failure without attempting the remaining products', async () => {
    const { sync, service } = make();
    sync.mockRejectedValueOnce(new Error('connection failed'));
    await expect(service.syncMany([product, product], source)).rejects.toThrow(
      'connection failed',
    );
    expect(sync).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid seller identity before a batch starts', async () => {
    const { sync, service } = make();
    await expect(
      service.syncMany([product], { ...source, slug: '' }),
    ).rejects.toThrow();
    expect(sync).not.toHaveBeenCalled();
  });

  it('finishes the current transaction and stops before the next item on cancellation', async () => {
    const { sync, service } = make();
    const controller = new AbortController();
    sync.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve('created');
    });
    await expect(
      service.syncMany([product, product], source, controller.signal),
    ).rejects.toThrow();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

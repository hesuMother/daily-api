import { jest } from '@jest/globals';
import { ProductService } from './product.service';
import type { ProductProvider } from '../crawler/providers/product-provider.interface';
import type { ExternalProduct } from '../crawler/types/external-product';
import { ProductSyncService } from './sync/product-sync.service';
import type { PrismaService } from '../database/prisma.service';

describe('Provider-independent ProductService', () => {
  it('accepts an API provider and continues saving other products after a persistence failure', async () => {
    const product: ExternalProduct = {
      provider: 'api-example',
      name: 'Shirt',
      price: null,
      productUrl: 'https://shop.test/a',
      fetchedAt: new Date(),
    };
    const provider: ProductProvider = {
      id: 'api-example',
      name: 'API example',
      search: () =>
        Promise.resolve({
          products: [
            product,
            { ...product, name: 'Other', productUrl: 'https://shop.test/b' },
          ],
          failures: [],
        }),
      getProduct: () => Promise.resolve({ products: [product], failures: [] }),
    };
    const sync = jest
      .fn<ProductSyncService['sync']>()
      .mockRejectedValueOnce(new Error('database secret'))
      .mockResolvedValue('created');
    const service = new ProductService(
      [provider],
      { sync } as unknown as ProductSyncService,
      {} as PrismaService,
    );
    const result = await service.search(provider.id, 'shirt');
    expect(result.products).toHaveLength(1);
    expect(result.saved.created).toBe(1);
    expect(result.failures).toEqual([
      {
        provider: provider.id,
        url: product.productUrl,
        code: 'PERSISTENCE_FAILED',
      },
    ]);
    expect(sync.mock.calls[0][0]).toMatchObject({
      price: null,
      isSoldOut: null,
    });
    await expect(service.search('not-registered', 'shirt')).rejects.toThrow();
  });
});

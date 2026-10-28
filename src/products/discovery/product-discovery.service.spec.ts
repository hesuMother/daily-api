import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { ProductProvider } from '../../crawler/providers/product-provider.interface';
import type { ExternalProduct } from '../../crawler/types/external-product';
import { CrawlError } from '../../crawler/types/external-product';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { ProductService } from '../product.service';
import type { ProductSyncService } from '../sync/product-sync.service';
import { ProductDiscoveryService } from './product-discovery.service';

const shop = 'https://shop.test/products/';

function setup(provider: ProductProvider, storedUrls: string[] = []) {
  const skipped = new Set<string>();
  const client = {
    smismember: jest.fn((_key: string, ...urls: string[]) =>
      Promise.resolve(urls.map((url) => (skipped.has(url) ? 1 : 0))),
    ),
    sadd: jest.fn((_key: string, ...urls: string[]) => {
      urls.forEach((url) => skipped.add(url));
      return Promise.resolve(urls.length);
    }),
  };
  const redis = {
    keyPrefix: 'test',
    execute: (operation: (c: typeof client) => Promise<unknown>) =>
      operation(client),
  } as unknown as RedisService;
  const prisma = {
    productOffer: {
      findMany: jest.fn(
        ({ where }: { where: { productUrl: { in: string[] } } }) =>
          Promise.resolve(
            where.productUrl.in
              .filter((url) => storedUrls.includes(url))
              .map((productUrl) => ({ productUrl })),
          ),
      ),
    },
  } as unknown as PrismaService;
  const sync = jest
    .fn<ProductSyncService['sync']>()
    .mockResolvedValue('created');
  const products = new ProductService(
    [provider],
    { sync } as unknown as ProductSyncService,
    prisma,
  );
  const config = {
    getOrThrow: () => ({ crawler: { maxPages: 3, discoveryBatchSize: 20 } }),
  } as unknown as ConfigService;
  return {
    service: new ProductDiscoveryService(config, products, prisma, redis),
    sync,
    skipped,
  };
}

const item = (id: number): ExternalProduct => ({
  provider: 'shop',
  name: 'Shirt ' + id,
  price: 1000,
  productUrl: shop + id,
  fetchedAt: new Date(),
});

describe('ProductDiscoveryService', () => {
  it('visits only unknown URLs within the page budget and remembers out-of-scope pages', async () => {
    const getProducts = jest.fn((urls: string[]) =>
      Promise.resolve({
        products: [item(5)],
        failures: [
          { provider: 'shop', url: urls[1], code: 'OUT_OF_SCOPE' as const },
          { provider: 'shop', url: urls[2], code: 'HTTP_FAILURE' as const },
        ],
      }),
    );
    const provider: ProductProvider = {
      id: 'shop',
      name: 'Shop',
      getProduct: () => Promise.reject(new Error('unused')),
      listProductUrls: () =>
        Promise.resolve([6, 5, 4, 3, 2, 1].map((id) => shop + id)),
      getProducts,
    };
    const { service, sync, skipped } = setup(provider, [shop + 6]);

    const first = await service.discover('shop', 10);
    expect(getProducts).toHaveBeenLastCalledWith([
      shop + 5,
      shop + 4,
      shop + 3,
    ]);
    expect(first).toMatchObject({
      visited: 3,
      skipped: 1,
      saved: { created: 1 },
      failures: [{ url: shop + 3, code: 'HTTP_FAILURE' }],
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect([...skipped]).toEqual([shop + 4]);

    // 4 is remembered as out of scope; 6 is stored. 5 is unknown here because sync is mocked.
    await service.discover('shop', 2);
    expect(getProducts).toHaveBeenLastCalledWith([shop + 5, shop + 3]);
  });

  it('reports an unavailable listing without crawling', async () => {
    const getProducts = jest.fn<NonNullable<ProductProvider['getProducts']>>();
    const { service } = setup({
      id: 'shop',
      name: 'Shop',
      getProduct: () => Promise.reject(new Error('unused')),
      listProductUrls: () =>
        Promise.reject(new CrawlError('SITEMAP_UNAVAILABLE', false)),
      getProducts,
    });
    await expect(service.discover('shop')).resolves.toMatchObject({
      visited: 0,
      failures: [{ code: 'SITEMAP_UNAVAILABLE' }],
    });
    expect(getProducts).not.toHaveBeenCalled();
  });

  it('rejects providers without a listing and lists only those with one', async () => {
    const { service } = setup({
      id: 'shop',
      name: 'Shop',
      getProduct: () => Promise.reject(new Error('unused')),
    });
    expect(service.discoverableProviders()).toEqual([]);
    await expect(service.discover('shop')).rejects.toThrow(
      '신규 상품 탐색을 지원하지 않습니다',
    );
    await expect(service.discover('missing')).rejects.toThrow();
  });
});

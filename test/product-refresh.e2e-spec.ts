import { ProductRefreshRepository } from '../src/products/repository/product-refresh.repository';
import { ProductRefreshScheduler } from '../src/products/scheduler/product-refresh.scheduler';
import { ProductService } from '../src/products/product.service';
import { ProductSyncRepository } from '../src/products/repository/product-sync.repository';
import { ProductSyncService } from '../src/products/sync/product-sync.service';
import type { ProductProvider } from '../src/crawler/providers/product-provider.interface';
import { createTestDatabase } from './database-fixture';

describe('Scheduled refresh PostgreSQL integration', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let repository: ProductRefreshRepository;
  let scheduler: ProductRefreshScheduler;
  let sellerId: string;
  const visited: string[] = [];
  const provider: ProductProvider = {
    id: 'refresh-fixture',
    name: 'Refresh fixture',
    search: () => {
      throw new Error('Scheduled refresh must never search');
    },
    getProduct: (url) => {
      visited.push(url);
      if (url.endsWith('/failed'))
        return Promise.resolve({
          products: [],
          failures: [
            { provider: 'refresh-fixture', url, code: 'HTTP_FAILURE' },
          ],
        });
      return Promise.resolve({
        products: [
          {
            provider: 'refresh-fixture',
            productUrl: url,
            name: 'Shirt',
            price: 2000,
            inStock: false,
            fetchedAt: new Date(),
          },
        ],
        failures: [],
      });
    },
  };
  beforeAll(async () => {
    db = await createTestDatabase();
    db.config.set('app.crawler.enabled', true);
    repository = new ProductRefreshRepository(db.prisma);
    const products = new ProductService(
      [provider],
      new ProductSyncService(new ProductSyncRepository(db.prisma)),
      db.prisma,
    );
    scheduler = new ProductRefreshScheduler(db.config, products, repository);
    sellerId = (
      await db.prisma.seller.create({
        data: { slug: provider.id, name: provider.name },
      })
    ).id;
  });
  afterAll(async () => {
    await scheduler?.onModuleDestroy();
    await db?.cleanup();
  });
  beforeEach(async () => {
    await db.prisma.product.deleteMany();
    visited.length = 0;
  });
  function offer(
    path: string,
    data: {
      lastCrawledAt?: Date;
      nextRefreshAt?: Date;
      refreshLockedUntil?: Date;
      refreshLockToken?: string;
      productUrl?: null;
    } = {},
    hidden = false,
    seller = sellerId,
  ) {
    return db.prisma.productOffer.create({
      data: {
        seller: { connect: { id: seller } },
        price: 1000,
        productUrl: 'https://shop.test/' + path,
        product: { create: { name: 'Shirt', isDeleted: hidden } },
        ...data,
        priceHistories: { create: { price: 1000, currency: 'KRW' } },
      },
    });
  }
  it('updates stale offers, records changed prices and excludes fresh, hidden, unregistered and URL-less offers', async () => {
    const stale = await offer('stale', {
      lastCrawledAt: new Date(Date.now() - 86400000),
    });
    await offer('fresh', { lastCrawledAt: new Date() });
    await offer('hidden', {}, true);
    await offer('no-url', { productUrl: null });
    const unregistered = await db.prisma.seller.create({
      data: { slug: 'unregistered', name: 'Other' },
    });
    await offer('other', {}, false, unregistered.id);
    await scheduler.tick();
    expect(visited).toEqual(['https://shop.test/stale']);
    const updated = await db.prisma.productOffer.findUniqueOrThrow({
      where: { id: stale.id },
      include: { priceHistories: true },
    });
    expect(updated.price).toBe(2000);
    expect(updated.isSoldOut).toBe(true);
    expect(updated.priceHistories).toHaveLength(2);
    expect(updated.nextRefreshAt!.getTime()).toBeGreaterThan(
      Date.now() + 21000000,
    );
    expect(updated.lastRefreshAttemptAt).toBeInstanceOf(Date);
    expect(updated.refreshLockToken).toBeNull();
    await scheduler.tick();
    expect(visited).toHaveLength(1);
  });
  it('allows only one worker to claim an offer and preserves ownership across stale completion attempts', async () => {
    const row = await offer('claim');
    const other = new ProductRefreshRepository(db.prisma);
    const claims = await Promise.all([
      repository.claim([provider.id], 60000, new Date()),
      other.claim([provider.id], 60000, new Date()),
    ]);
    const owned = claims.filter((claim) => claim !== null);
    expect(owned).toHaveLength(1);
    const claim = owned[0];
    expect(claim.id).toBe(row.id);
    expect(await repository.renew(claim)).toBe(true);
    await db.prisma.productOffer.update({
      where: { id: row.id },
      data: { refreshLockedUntil: new Date(Date.now() - 1000) },
    });
    expect(await repository.renew(claim)).toBe(false);
    const recovered = (await other.claim([provider.id], 60000, new Date()))!;
    expect(recovered.token).not.toBe(claim.token);
    await repository.finish(claim, 60000, null);
    expect(
      (
        await db.prisma.productOffer.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).refreshLockToken,
    ).toBe(recovered.token);
    await other.finish(recovered, 60000, null);
  });
  it('keeps failed observations intact, persists retry timing and continues with healthy offers', async () => {
    const failed = await offer('failed');
    await offer('healthy');
    await scheduler.tick();
    expect(visited.sort()).toEqual([
      'https://shop.test/failed',
      'https://shop.test/healthy',
    ]);
    const row = await db.prisma.productOffer.findUniqueOrThrow({
      where: { id: failed.id },
    });
    expect(row.price).toBe(1000);
    expect(row.lastCrawledAt).toBeNull();
    expect(row.lastRefreshError).toBe('HTTP_FAILURE');
    expect(row.nextRefreshAt!.getTime()).toBeGreaterThan(Date.now() + 850000);
    // A new repository (another process/restart) honors the persisted retry time.
    expect(
      await new ProductRefreshRepository(db.prisma).claim(
        [provider.id],
        60000,
        new Date(),
      ),
    ).toBeNull();
  });
});

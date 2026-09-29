import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PrismaService } from '../src/database/prisma.service';
import { ProductSyncRepository } from '../src/products/repository/product-sync.repository';
import { ProductSyncService } from '../src/products/sync/product-sync.service';

// PostgreSQL만 필요합니다. 기존 인증 E2E의 Redis/세션 테스트와 독립적으로 실행합니다.
describe('Product sync PostgreSQL integration', () => {
  const schema = 'product_sync_test_' + randomUUID().replaceAll('-', '');
  let admin: Client;
  let prisma: PrismaService;
  let service: ProductSyncService;
  let schemaCreated = false;
  const source = { slug: 'coupang', name: 'Coupang' };
  const product = {
    externalProductId: '42',
    name: 'Same product name',
    price: 1000,
    imageUrl: 'https://example.test/a.jpg',
  };

  beforeAll(async () => {
    const connectionString = new ConfigService().getOrThrow<string>(
      'DATABASE_URL',
    );
    admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await admin.query(`SET search_path TO "${schema}"`);
    const migrations = (
      await readdir('prisma/migrations', { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of migrations)
      await admin.query(
        await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'),
      );
    const url = new URL(connectionString);
    url.searchParams.set('schema', schema);
    prisma = new PrismaService(
      new ConfigService({ app: { databaseUrl: url.toString() } }),
    );
    await prisma.$connect();
    service = new ProductSyncService(new ProductSyncRepository(prisma));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    try {
      if (schemaCreated && /^product_sync_test_[a-f0-9]{32}$/.test(schema)) {
        await admin.query('ROLLBACK');
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await admin?.end();
    }
  });

  it('creates once, preserves omitted fields, and records only changed prices', async () => {
    await service.sync(
      { ...product, isSoldOut: true, purchaseUrl: 'https://example.test/buy' },
      source,
    );
    await service.sync(product, source);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.productImage.count()).toBe(1);
    expect(await prisma.productPriceHistory.count()).toBe(1);
    expect(await prisma.productOffer.findFirst()).toMatchObject({
      isSoldOut: true,
      purchaseUrl: 'https://example.test/buy',
    });
    await service.sync({ ...product, price: 900 }, source);
    expect(await prisma.productPriceHistory.count()).toBe(2);
    expect(await prisma.productOffer.findFirst()).toMatchObject({ price: 900 });
  });

  it('does not match distinct external IDs by identical names', async () => {
    await service.sync({ ...product, externalProductId: '43' }, source);
    await service.sync(product, { slug: 'other-shop', name: 'Other shop' });
    expect(await prisma.product.count()).toBe(3);
  });

  it('survives concurrent first ingestion without duplicate products, offers, images or histories', async () => {
    const value = { ...product, externalProductId: 'concurrent' };
    await Promise.all([
      service.sync(value, source),
      service.sync(value, source),
    ]);
    const offers = await prisma.productOffer.findMany({
      where: { externalProductId: 'concurrent' },
      include: { priceHistories: true, product: { include: { images: true } } },
    });
    expect(offers).toHaveLength(1);
    expect(offers[0].priceHistories).toHaveLength(1);
    expect(offers[0].product.images).toHaveLength(1);
    expect(await prisma.product.count()).toBe(4);
  });

  it('rolls back an offer update if history persistence fails', async () => {
    await admin.query(
      'ALTER TABLE "product_price_histories" ADD CONSTRAINT "test_reject_price" CHECK (price <> 777)',
    );
    try {
      const count = await prisma.product.count();
      await expect(
        service.sync(
          { ...product, externalProductId: 'failed-new', price: 777 },
          source,
        ),
      ).rejects.toThrow();
      expect(await prisma.product.count()).toBe(count);
      expect(
        await prisma.productOffer.count({
          where: { externalProductId: 'failed-new' },
        }),
      ).toBe(0);
      await expect(
        service.sync(
          { ...product, externalProductId: 'concurrent', price: 777 },
          source,
        ),
      ).rejects.toThrow();
      const offer = await prisma.productOffer.findFirstOrThrow({
        where: { externalProductId: 'concurrent' },
        include: { priceHistories: true },
      });
      expect(offer.price).toBe(1000);
      expect(offer.priceHistories).toHaveLength(1);
    } finally {
      await admin.query(
        'ALTER TABLE "product_price_histories" DROP CONSTRAINT "test_reject_price"',
      );
    }
  });
});

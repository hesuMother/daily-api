import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { Cm29Provider } from '../src/crawler/providers/sites/cm29/cm29.provider';
import { ProductService } from '../src/products/product.service';
import { ProductDiscoveryService } from '../src/products/discovery/product-discovery.service';
import { createTestDatabase } from './database-fixture';

/**
 * Live check against www.29cm.co.kr through the real Lightpanda container: `npm run test:cm29`.
 * Needs network access, Docker (lightpanda, postgres, redis) and products that still exist on the site.
 */
describe('29CM clothing through NestJS → Lightpanda → Prisma (live)', () => {
  // Sampled 2026-10-28: 여성의류 and 여성액세서리.
  const clothing = 'https://www.29cm.co.kr/products/4338738';
  const accessory = 'https://www.29cm.co.kr/products/4338139';
  let app: NestFastifyApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    db = await createTestDatabase();
    const settings =
      db.config.getOrThrow<Record<string, unknown>>('app.crawler');
    db.config.set('app.crawler', {
      ...settings,
      enabled: true,
      refreshEnabled: false,
      discoveryEnabled: false,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(db.config)
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await db?.cleanup();
  });

  it('saves a clothing product with its category path', async () => {
    const result = await app.get(ProductService).refresh('29cm', clothing);
    expect(result.failures).toEqual([]);
    expect(result.saved.created).toBe(1);
    const [product] = result.products;
    expect(product).toMatchObject({
      provider: '29cm',
      externalId: '4338738',
      productUrl: clothing,
      category: expect.stringMatching(/^여성의류( > |$)/) as unknown,
    });
    expect(product.name.length).toBeGreaterThan(0);
    expect(product.price === null || product.price > 0).toBe(true);
    const offer = await db.prisma.productOffer.findFirstOrThrow({
      where: { productUrl: clothing },
      select: { externalProductId: true, sourceCategory: true },
    });
    expect(offer.sourceCategory).toMatch(/^여성의류/);
  }, 120000);

  it('does not save non-clothing products', async () => {
    const result = await app.get(Cm29Provider).getProduct(accessory);
    expect(result.products).toEqual([]);
    expect(result.failures).toEqual([
      { provider: '29cm', url: accessory, code: 'OUT_OF_SCOPE' },
    ]);
  }, 120000);

  it('discovers new clothing from the sitemap and does not revisit pages', async () => {
    const discovery = app.get(ProductDiscoveryService);
    const first = await discovery.discover('29cm', 6);
    expect(first.visited).toBe(6);
    expect(first.failures).toEqual([]);
    expect(first.products.length + first.skipped).toBe(6);
    for (const product of first.products)
      expect(product.category).toMatch(/^(여성의류|남성의류)/);

    const visited = new Set(first.products.map((p) => p.productUrl));
    const second = await discovery.discover('29cm', 3);
    expect(second.visited).toBe(3);
    for (const product of second.products)
      expect(visited.has(product.productUrl)).toBe(false);

    const stored = await db.prisma.productOffer.findMany({
      where: { seller: { slug: '29cm' } },
      select: { sourceCategory: true },
    });
    expect(stored.length).toBe(
      1 + first.products.length + second.products.length,
    );
    for (const offer of stored)
      expect(offer.sourceCategory).toMatch(/^(여성의류|남성의류)/);
  }, 300000);
});

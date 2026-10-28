import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { LightpandaService } from '../src/crawler/browser/lightpanda.service';
import { CrawlerService } from '../src/crawler/crawler.service';
import { ExampleProvider } from '../src/crawler/providers/sites/example/example.provider';
import { ProductService } from '../src/products/product.service';
import { createTestDatabase } from './database-fixture';
import { createFixtureShop } from './fixtures/fixture-shop';
import { networkInterfaces } from 'node:os';

describe('Actual NestJS → Crawlee → CDP → Lightpanda → Prisma', () => {
  let app: NestFastifyApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let shop: Awaited<ReturnType<typeof createFixtureShop>>;
  let base: string;
  beforeAll(async () => {
    shop = await createFixtureShop();
    // Both the Windows process and Docker must reach the same real HTTP fixture.
    const host =
      new ConfigService().get<string>('CRAWLER_FIXTURE_HOST') ??
      Object.values(networkInterfaces())
        .flat()
        .find((address) => address?.family === 'IPv4' && !address.internal)
        ?.address ??
      '127.0.0.1';
    base = 'http://' + host + ':' + shop.port;
    db = await createTestDatabase();
    const settings =
      db.config.getOrThrow<Record<string, unknown>>('app.crawler');
    db.config.set('app.crawler', {
      ...settings,
      enabled: true,
      refreshEnabled: false,
      exampleBaseUrl: base,
      maxRequestsPerMinute: 120,
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
    await app.getHttpAdapter().getInstance().ready();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await db?.cleanup();
    await shop?.close();
  });

  it('reuses its startup browser, extracts JSON-LD and releases the request context', async () => {
    const browser = app.get(LightpandaService);
    expect(browser.connected).toBe(true);
    const result = await app
      .get(ExampleProvider)
      .getProduct(base + '/products/json-ld');
    expect(result.failures).toEqual([]);
    expect(result.products).toEqual([
      expect.objectContaining({
        provider: 'example',
        name: '테스트 셔츠',
        brand: 'Daily',
        price: 129000,
        modelNumber: 'SHIRT-MODEL',
        sku: 'SHIRT-SKU',
        inStock: true,
      }),
    ]);
    expect(browser.connected).toBe(true);
    expect(browser.activeContexts).toBe(0);
  }, 60000);

  it('discovers/deduplicates URLs, falls back to state and DOM, retries failures, obeys robots and saves nullable prices', async () => {
    const result = await app.get(ProductService).search('example', 'shirts');
    expect(result.failures.map((failure) => failure.code).sort()).toEqual([
      'PRODUCT_NOT_FOUND',
      'ROBOTS_DENIED',
    ]);
    expect(result.products).toHaveLength(5);
    expect(result.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'DOM shoes', price: 89900 }),
        expect.objectContaining({ name: 'State shirt' }),
        expect.objectContaining({ name: '가격 미정 상품', price: null }),
      ]),
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ROBOTS_DENIED' }),
        expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }),
      ]),
    );
    expect(shop.hits.get('/products/blocked')).toBeUndefined();
    expect(shop.hits.get('/products/retry')).toBe(2);
    expect(result.saved.created).toBe(5);
    expect(await db.prisma.productOffer.count()).toBe(5);
    const missing = await db.prisma.productOffer.findFirstOrThrow({
      where: { sourceName: '가격 미정 상품' },
      include: { priceHistories: true },
    });
    expect(missing.price).toBeNull();
    expect(missing.isSoldOut).toBeNull();
    expect(missing.priceHistories).toHaveLength(0);
    expect(app.get(LightpandaService).activeContexts).toBe(0);
  }, 90000);

  it('refreshes a stored URL without rediscovery and preserves matching metadata', async () => {
    const offer = await db.prisma.productOffer.findFirstOrThrow({
      where: { externalProductId: 'shirt-1' },
    });
    const searches = shop.hits.get('/search');
    const result = await app.get(ProductService).refreshOffer(offer.id);
    expect(result.failures).toEqual([]);
    expect(result.saved.created).toBe(0);
    expect(result.saved.unchanged).toBe(1);
    expect(shop.hits.get('/search')).toBe(searches);
    expect(await db.prisma.productOffer.count()).toBe(5);
    const refreshed = await db.prisma.productOffer.findUniqueOrThrow({
      where: { id: offer.id },
    });
    expect(refreshed.lastCrawledAt).toBeInstanceOf(Date);
    expect(refreshed).toMatchObject({
      sourceBrand: 'Daily',
      modelNumber: 'SHIRT-MODEL',
      sku: 'SHIRT-SKU',
    });
    expect(
      await db.prisma.productPriceHistory.count({
        where: { offerId: offer.id },
      }),
    ).toBe(1);
  }, 60000);

  it('rejects unregistered origins and off-policy redirects; admin endpoints require authentication', async () => {
    const provider = app.get(ExampleProvider);
    expect(
      (await provider.getProduct('http://127.0.0.1:1/private')).failures[0]
        .code,
    ).toBe('URL_NOT_ALLOWED');
    const redirected = await provider.getProduct(base + '/products/redirect');
    expect(redirected.products).toEqual([]);
    expect(redirected.failures[0].code).toBe('URL_NOT_ALLOWED');
    expect(app.get(LightpandaService).activeContexts).toBe(0);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/admin/products/providers' }))
        .statusCode,
    ).toBe(401);
  }, 60000);

  it('closes a timed-out page/context and processes the next request with the same browser', async () => {
    const config = new ConfigService({
      app: {
        crawler: {
          ...db.config.getOrThrow<Record<string, unknown>>('app.crawler'),
          requestTimeout: 1000,
          maxRetries: 0,
        },
      },
    });
    const browser = app.get(LightpandaService);
    const crawler = new CrawlerService(config, browser);
    try {
      const result = await crawler.run(
        'example',
        [base + '/products/slow'],
        {
          allowedOrigins: [base],
          isAllowedPath: (url) => url.pathname.startsWith('/products/'),
        },
        (page) => page.title(),
      );
      expect(result.values).toEqual([]);
      expect(result.failures[0].code).toBe('NAVIGATION_TIMEOUT');
      expect(browser.activeContexts).toBe(0);
      const recovered = await app
        .get(ExampleProvider)
        .getProduct(base + '/products/json-ld');
      expect(recovered.products).toHaveLength(1);
      expect(browser.connected).toBe(true);
      expect(browser.activeContexts).toBe(0);
    } finally {
      await crawler.onModuleDestroy();
    }
  }, 60000);
});

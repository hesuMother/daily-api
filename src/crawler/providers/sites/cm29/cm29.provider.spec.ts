import { jest } from '@jest/globals';
import type { CrawlerService } from '../../../crawler.service';
import { permittedUrl } from '../../../crawl-policy';
import {
  Cm29Provider,
  cm29ItemSitemaps,
  cm29ProductUrl,
  cm29SitemapProductUrls,
  parseCm29Product,
} from './cm29.provider';

// Shapes copied from 29CM product pages on 2026-10-20 and 2026-10-28.
const product = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': 'urn:29cm:product:4338738',
    sku: '4338738',
    name: '울 블렌드 니트',
    image: [
      {
        '@type': 'ImageObject',
        contentUrl: 'https://img.29cm.co.kr/next-product/a.jpg',
        width: 1500,
        height: 1500,
      },
    ],
    brand: { '@type': 'Brand', name: '데일리' },
    offers: {
      '@type': 'Offer',
      price: 89000,
      priceCurrency: 'KRW',
      availability: 'https://schema.org/InStock',
    },
    category: '니트',
    ...overrides,
  });
const crumbs = (largeCode: string, large: string) =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 3,
        name: '니트',
        item: `https://www.29cm.co.kr/store/category/list?categoryLargeCode=${largeCode}&categoryMediumCode=1`,
      },
      {
        '@type': 'ListItem',
        position: 1,
        name: '홈',
        item: 'https://www.29cm.co.kr',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: large,
        item: `https://www.29cm.co.kr/store/category/list?categoryLargeCode=${largeCode}`,
      },
    ],
  });
const url = 'https://www.29cm.co.kr/products/4338738';

describe('29CM clothing provider', () => {
  it('reads clothing JSON-LD with the category path and product ID', () => {
    expect(
      parseCm29Product([crumbs('268100100', '여성의류'), product()], url),
    ).toMatchObject({
      provider: '29cm',
      externalId: '4338738',
      name: '울 블렌드 니트',
      brand: '데일리',
      price: 89000,
      inStock: true,
      category: '여성의류 > 니트',
      productUrl: url,
      imageUrl: 'https://img.29cm.co.kr/next-product/a.jpg',
    });
    expect(
      parseCm29Product(
        [product(), crumbs('272100100', '남성의류')],
        url + '?utm_source=x',
      ).productUrl,
    ).toBe(url);
  });

  it.each([
    ['275100100', '남성액세서리'],
    ['270100100', '여성슈즈'],
    ['293100100', '가전'],
  ])('rejects non-clothing category %s as OUT_OF_SCOPE', (code, name) => {
    expect(() =>
      parseCm29Product([product(), crumbs(code, name)], url),
    ).toThrow('OUT_OF_SCOPE');
  });

  it('rejects pages without a category path, and pages without a product', () => {
    expect(() => parseCm29Product([product()], url)).toThrow('OUT_OF_SCOPE');
    expect(() =>
      parseCm29Product([crumbs('268100100', '여성의류')], url),
    ).toThrow('PRODUCT_NOT_FOUND');
  });

  it('keeps an unknown price as null instead of 0', () => {
    expect(
      parseCm29Product(
        [product({ offers: {} }), crumbs('268100100', '여성의류')],
        url,
      ).price,
    ).toBeNull();
  });

  it('allows only product detail pages on www.29cm.co.kr', () => {
    const { policy } = new Cm29Provider({} as CrawlerService);
    expect(permittedUrl(url, policy)).toBe(url);
    for (const value of [
      'https://www.29cm.co.kr/my-page/orders',
      'https://www.29cm.co.kr/order/cart',
      'https://www.29cm.co.kr/store/search?keyword=x',
      'https://www.29cm.co.kr/products/abc',
      'https://www.29cm.co.kr.evil.test/products/1',
      'http://www.29cm.co.kr/products/1',
    ])
      expect(() => permittedUrl(value, policy)).toThrow('URL_NOT_ALLOWED');
    expect(cm29ProductUrl('/products/1#top')).toBe(
      'https://www.29cm.co.kr/products/1',
    );
    expect(cm29ProductUrl('https://other.test/products/1')).toBeNull();
  });

  it('lists sitemap products newest first and item sitemaps highest first', () => {
    expect(
      cm29SitemapProductUrls(`<urlset>
        <url><loc>https://www.29cm.co.kr/products/22088</loc></url>
        <url><loc> https://www.29cm.co.kr/products/4340587 </loc></url>
        <url><loc>https://www.29cm.co.kr/products/22088</loc></url>
        <url><loc>https://www.29cm.co.kr/store/brand/1</loc></url>
      </urlset>`),
    ).toEqual([
      'https://www.29cm.co.kr/products/4340587',
      'https://www.29cm.co.kr/products/22088',
    ]);
    expect(
      cm29ItemSitemaps(`<sitemapindex>
        <sitemap><loc>https://www.29cm.co.kr/sitemap/sitemap-item-2.xml</loc></sitemap>
        <sitemap><loc>https://www.29cm.co.kr/sitemap/sitemap-category-1.xml</loc></sitemap>
        <sitemap><loc>https://www.29cm.co.kr/sitemap/sitemap-item-24.xml</loc></sitemap>
        <sitemap><loc>https://evil.test/sitemap/sitemap-item-99.xml</loc></sitemap>
      </sitemapindex>`),
    ).toEqual([
      'https://www.29cm.co.kr/sitemap/sitemap-item-24.xml',
      'https://www.29cm.co.kr/sitemap/sitemap-item-2.xml',
    ]);
  });

  it('crawls canonical product URLs in one batch', async () => {
    const run = jest
      .fn<CrawlerService['run']>()
      .mockResolvedValue({ values: [], failures: [] });
    const provider = new Cm29Provider({ run } as unknown as CrawlerService);
    await provider.getProducts([
      url + '?utm=1',
      'https://www.29cm.co.kr/products/2',
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual([
      url,
      'https://www.29cm.co.kr/products/2',
    ]);
    expect('search' in provider).toBe(false);
  });

  it('reads robots before the sitemap and refuses a failed sitemap', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('User-agent: *\nAllow: /\n'))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(
      new Cm29Provider({} as CrawlerService).listProductUrls(),
    ).rejects.toThrow('SITEMAP_UNAVAILABLE');
    expect(fetch.mock.calls[0][0]).toBe('https://www.29cm.co.kr/robots.txt');
    fetch.mockRestore();
  });
});

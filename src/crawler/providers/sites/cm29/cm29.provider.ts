import { Injectable } from '@nestjs/common';
import { CrawlerService } from '../../../crawler.service';
import { CrawlRobotsPolicy, type CrawlSitePolicy } from '../../../crawl-policy';
import {
  asObject,
  parseProductJsonLd,
  type JsonObject,
} from '../../../extractors/json-ld.extractor';
import { normalizeProduct } from '../../../extractors/product.extractor';
import {
  CrawlError,
  type ExternalProduct,
  type ProviderResult,
} from '../../../types/external-product';
import type { ProductProvider } from '../../product-provider.interface';

const ORIGIN = 'https://www.29cm.co.kr';
const PRODUCT_PATH = /^\/products\/(\d+)$/;
const ITEM_SITEMAP =
  /^https:\/\/www\.29cm\.co\.kr\/sitemap\/sitemap-item-(\d+)\.xml$/;
const MAX_SITEMAP_FILES = 3;
const MIN_CANDIDATES = 5000;
const MAX_SITEMAP_BYTES = 20 * 1024 * 1024;

/** Large categories saved by this provider, keyed by 29CM categoryLargeCode. */
export const CM29_CLOTHING_CATEGORIES: Readonly<Record<string, string>> = {
  '268100100': '여성의류',
  '272100100': '남성의류',
};

/** `https://www.29cm.co.kr/products/<id>` without query or fragment, or null for other pages. */
export function cm29ProductUrl(value: string): string | null {
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && PRODUCT_PATH.test(url.pathname)
      ? ORIGIN + url.pathname
      : null;
  } catch {
    return null;
  }
}

interface Crumb {
  name: string;
  url?: string;
}

function breadcrumb(scripts: string[]): Crumb[] {
  for (const script of scripts) {
    let value: unknown;
    try {
      value = JSON.parse(script);
    } catch {
      continue; // Reported once by the Product JSON-LD parser.
    }
    const list = asObject(value);
    if (list?.['@type'] !== 'BreadcrumbList') continue;
    const items = Array.isArray(list.itemListElement)
      ? list.itemListElement
          .map(asObject)
          .filter((entry): entry is JsonObject => entry !== null)
      : [];
    return items
      .sort((a, b) => Number(a.position) - Number(b.position))
      .flatMap((entry) => {
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        const item =
          typeof entry.item === 'string'
            ? entry.item
            : asObject(entry.item)?.['@id'];
        return name
          ? [{ name, url: typeof item === 'string' ? item : undefined }]
          : [];
      });
  }
  return [];
}

function largeCategoryCode(crumb: Crumb | undefined): string | null {
  try {
    return crumb?.url
      ? new URL(crumb.url).searchParams.get('categoryLargeCode')
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads the Product and BreadcrumbList JSON-LD that 29CM renders on the server.
 * Only clothing is accepted; other categories fail as OUT_OF_SCOPE so discovery can skip them later.
 */
export function parseCm29Product(
  scripts: string[],
  url: string,
  malformed?: () => void,
): ExternalProduct {
  const productUrl = cm29ProductUrl(url);
  const data = parseProductJsonLd(scripts, malformed);
  const product =
    productUrl && data ? normalizeProduct(data, '29cm', productUrl) : null;
  if (!productUrl || !product) throw new CrawlError('PRODUCT_NOT_FOUND', false);
  // [홈, large category, medium category, small category]
  const trail = breadcrumb(scripts);
  const largeCode = largeCategoryCode(trail[1]);
  if (!largeCode || !(largeCode in CM29_CLOTHING_CATEGORIES))
    throw new CrawlError('OUT_OF_SCOPE', false);
  return {
    ...product,
    externalId: PRODUCT_PATH.exec(new URL(productUrl).pathname)?.[1],
    category: trail
      .slice(1)
      .map((crumb) => crumb.name)
      .join(' > '),
  };
}

function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
    ([, loc]) => loc,
  );
}

/** Product page URLs newest first (29CM product IDs increase over time). */
export function cm29SitemapProductUrls(xml: string): string[] {
  const ids = new Set<number>();
  for (const loc of sitemapLocations(xml)) {
    const url = cm29ProductUrl(loc);
    const id = url && PRODUCT_PATH.exec(new URL(url).pathname)?.[1];
    if (id) ids.add(Number(id));
  }
  return [...ids].sort((a, b) => b - a).map((id) => `${ORIGIN}/products/${id}`);
}

/** Product sitemaps from the index, highest-numbered (newest) first. */
export function cm29ItemSitemaps(indexXml: string): string[] {
  return sitemapLocations(indexXml)
    .map((loc) => ({ loc, n: Number(ITEM_SITEMAP.exec(loc)?.[1]) }))
    .filter(({ n }) => Number.isInteger(n))
    .sort((a, b) => b.n - a.n)
    .map(({ loc }) => loc);
}

/**
 * 29CM clothing (여성의류, 남성의류).
 * robots.txt (checked 2026-10-28) allows general bots outside /embed/, /my-page/, /order/, /auth/ and /inbox/
 * and publishes the sitemap used for discovery. Review robots and the terms again before production use.
 * Keyword search is not offered: search and category lists are filled by client-side API calls
 * that Lightpanda did not render, so the sitemap is the listing source.
 */
@Injectable()
export class Cm29Provider implements ProductProvider {
  readonly id = '29cm';
  readonly name = '29CM';
  readonly policy: CrawlSitePolicy = {
    allowedOrigins: [ORIGIN],
    isAllowedPath: (url) => PRODUCT_PATH.test(url.pathname),
  };

  constructor(private readonly crawler: CrawlerService) {}

  getProduct(url: string): Promise<ProviderResult> {
    return this.getProducts([url]);
  }

  async getProducts(urls: string[]): Promise<ProviderResult> {
    const result = await this.crawler.run(
      this.id,
      urls.map((url) => cm29ProductUrl(url) ?? url),
      this.policy,
      async (page, url) => {
        const scripts = await page
          .locator('script[type="application/ld+json"]')
          .allTextContents();
        const product = parseCm29Product(scripts, url, () =>
          this.crawler.warn(this.id, url, 'MALFORMED_JSON_LD'),
        );
        if (product.price === null)
          this.crawler.warn(this.id, url, 'PRICE_MISSING');
        return product;
      },
    );
    return { products: result.values, failures: result.failures };
  }

  async listProductUrls(): Promise<string[]> {
    const signal = AbortSignal.timeout(60000);
    const robots = new CrawlRobotsPolicy();
    const files = cm29ItemSitemaps(
      await this.fetchSitemap(
        ORIGIN + '/sitemap/sitemap-root.xml',
        robots,
        signal,
      ),
    ).slice(0, MAX_SITEMAP_FILES);
    const urls = new Set<string>();
    for (const file of files) {
      const xml = await this.fetchSitemap(file, robots, signal);
      for (const url of cm29SitemapProductUrls(xml)) urls.add(url);
      if (urls.size >= MIN_CANDIDATES) break;
    }
    return [...urls];
  }

  private async fetchSitemap(
    url: string,
    robots: CrawlRobotsPolicy,
    signal: AbortSignal,
  ): Promise<string> {
    if (new URL(url).origin !== ORIGIN)
      throw new CrawlError('URL_NOT_ALLOWED', false);
    await robots.assertAllowed(url, signal);
    try {
      const response = await fetch(url, { redirect: 'error', signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const body = await response.text();
      if (body.length > MAX_SITEMAP_BYTES) throw new Error();
      return body;
    } catch {
      throw new CrawlError('SITEMAP_UNAVAILABLE', false);
    }
  }
}

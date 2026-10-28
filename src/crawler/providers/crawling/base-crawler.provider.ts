import type { Page } from 'playwright-core';
import type { CrawlerService } from '../../crawler.service';
import type { CrawlSitePolicy } from '../../crawl-policy';
import type { ProductProvider } from '../product-provider.interface';
import {
  extractProduct,
  type SiteProductParser,
} from '../../extractors/product.extractor';
import { CrawlError, type ProviderResult } from '../../types/external-product';

export abstract class BaseCrawlerProvider implements ProductProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly policy: CrawlSitePolicy;
  protected abstract readonly parser: SiteProductParser;
  protected abstract searchUrl(keyword: string): string;
  protected abstract discoverProductUrls(page: Page): Promise<string[]>;

  constructor(protected readonly crawler: CrawlerService) {}

  async search(keyword: string): Promise<ProviderResult> {
    const discovery = await this.crawler.run(
      this.id,
      [this.searchUrl(keyword)],
      this.policy,
      (page) => this.discoverProductUrls(page),
    );
    const details = await this.details(discovery.values.flat());
    return {
      products: details.products,
      failures: [...discovery.failures, ...details.failures],
    };
  }
  getProduct(url: string): Promise<ProviderResult> {
    return this.details([url]);
  }
  private async details(urls: string[]): Promise<ProviderResult> {
    const result = await this.crawler.run(
      this.id,
      urls,
      this.policy,
      async (page, url) => {
        const product = await extractProduct(
          page,
          this.id,
          url,
          this.parser,
          () => this.crawler.warn(this.id, url, 'MALFORMED_JSON_LD'),
        );
        if (!product) throw new CrawlError('PRODUCT_NOT_FOUND', false);
        if (product.price === null)
          this.crawler.warn(this.id, url, 'PRICE_MISSING');
        return product;
      },
    );
    return { products: result.values, failures: result.failures };
  }
}

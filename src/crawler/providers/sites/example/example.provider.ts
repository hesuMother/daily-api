import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from 'playwright-core';
import type { AppSettings } from '../../../../config/environment';
import { CrawlerService } from '../../../crawler.service';
import { BaseCrawlerProvider } from '../../crawling/base-crawler.provider';
import { ExampleParser } from './example.parser';
import type { CrawlSitePolicy } from '../../../crawl-policy';

@Injectable()
export class ExampleProvider extends BaseCrawlerProvider {
  readonly id = 'example';
  readonly name = 'Example fixture shop';
  readonly policy: CrawlSitePolicy;
  private readonly origin: string;

  constructor(
    crawler: CrawlerService,
    config: ConfigService,
    protected readonly parser: ExampleParser,
  ) {
    super(crawler);
    this.origin = new URL(
      config.getOrThrow<AppSettings>('app').crawler.exampleBaseUrl,
    ).origin;
    this.policy = {
      allowedOrigins: [this.origin],
      isAllowedPath: (url) =>
        url.pathname === '/search' ||
        /^\/products\/[a-z0-9-]+$/.test(url.pathname),
    };
  }
  protected searchUrl(keyword: string): string {
    const url = new URL('/search', this.origin);
    url.searchParams.set('q', keyword);
    return url.href;
  }
  protected async discoverProductUrls(page: Page): Promise<string[]> {
    return page
      .locator('a[data-product-link]')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).href),
      );
  }
}

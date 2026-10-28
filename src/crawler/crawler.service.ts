import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BasicCrawler,
  Configuration,
  Log,
  LogLevel,
  RequestQueue,
} from 'crawlee';
import { randomUUID } from 'node:crypto';
import type { Page, Response } from 'playwright-core';
import type { AppSettings } from '../config/environment';
import { LightpandaService } from './browser/lightpanda.service';
import {
  CrawlRobotsPolicy,
  permittedUrl,
  type CrawlSitePolicy,
} from './crawl-policy';
import {
  CrawlError,
  safeLogUrl,
  type CrawlFailure,
  type CrawlFailureCode,
} from './types/external-product';

@Injectable()
export class CrawlerService implements OnModuleDestroy {
  private readonly settings: AppSettings['crawler'];
  private readonly logger = new Logger(CrawlerService.name);
  private tail: Promise<unknown> = Promise.resolve();
  private readonly shutdown = new AbortController();
  private active?: BasicCrawler;

  constructor(
    config: ConfigService,
    private readonly browser: LightpandaService,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').crawler;
  }

  /** Serialize batches so the configured concurrency applies across simultaneous callers. */
  run<T>(
    provider: string,
    urls: string[],
    policy: CrawlSitePolicy,
    handler: (page: Page, url: string) => Promise<T>,
  ): Promise<{ values: T[]; failures: CrawlFailure[] }> {
    const run = this.tail.then(() =>
      this.execute(provider, urls, policy, handler),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  warn(provider: string, url: string, code: CrawlFailureCode): void {
    this.logger.warn(JSON.stringify({ provider, url: safeLogUrl(url), code }));
  }

  private async execute<T>(
    provider: string,
    urls: string[],
    policy: CrawlSitePolicy,
    handler: (page: Page, url: string) => Promise<T>,
  ) {
    const values: T[] = [],
      failures: CrawlFailure[] = [];
    const fail = (url: string, code: CrawlFailureCode) => {
      const failure = { provider, url: safeLogUrl(url), code };
      failures.push(failure);
      this.warn(provider, url, code);
    };
    if (this.shutdown.signal.aborted) throw new CrawlError('SHUTDOWN', false);
    const requests: string[] = [];
    for (const url of urls.slice(0, this.settings.maxPages)) {
      try {
        requests.push(permittedUrl(url, policy));
      } catch {
        fail(url, 'URL_NOT_ALLOWED');
      }
    }
    if (!requests.length) return { values, failures };
    try {
      await this.browser.connect();
    } catch {
      for (const url of requests) fail(url, 'LIGHTPANDA_UNAVAILABLE');
      return { values, failures };
    }
    const config = new Configuration({
      persistStorage: false,
      purgeOnStart: false,
      logLevel: LogLevel.OFF,
      storageClientOptions: { persistStorage: false },
    });
    const queue = await RequestQueue.open('crawl-' + randomUUID(), { config });
    const robots = new CrawlRobotsPolicy();
    const crawler = new BasicCrawler(
      {
        requestQueue: queue,
        log: new Log({ level: LogLevel.OFF }),
        maxConcurrency: Math.min(
          this.settings.maxConcurrency,
          this.browser.contextCapacity,
        ),
        maxRequestRetries: this.settings.maxRetries,
        maxRequestsPerCrawl: this.settings.maxPages,
        maxRequestsPerMinute: this.settings.maxRequestsPerMinute,
        sameDomainDelaySecs: 1,
        useSessionPool: false,
        retryOnBlocked: false,
        // Checked with Crawlee's robots parser below; unlike its default loader, failures deny access.
        respectRobotsTxtFile: false,
        requestHandlerTimeoutSecs: this.settings.requestTimeout / 1000 + 10,
        requestHandler: async ({ request }) => {
          const signal = AbortSignal.any([
            this.shutdown.signal,
            AbortSignal.timeout(this.settings.requestTimeout),
          ]);
          try {
            await robots.assertAllowed(request.url, signal);
            const result = await this.browser.withPage(async (page) => {
              // Intercept navigations/resources that CDP exposes and validate the final URL too.
              // HTTP redirect hops are not all exposed by Lightpanda's Fetch implementation.
              await page.route('**/*', async (route) => {
                if (
                  !policy.allowedOrigins.includes(
                    new URL(route.request().url()).origin,
                  )
                ) {
                  await route.abort();
                  return;
                }
                if (route.request().isNavigationRequest()) {
                  try {
                    permittedUrl(route.request().url(), policy);
                    await robots.assertAllowed(route.request().url(), signal);
                  } catch {
                    await route.abort();
                    return;
                  }
                }
                await route.continue();
              });
              let response: Response | null;
              try {
                response = await page.goto(request.url, {
                  waitUntil: 'domcontentloaded',
                  timeout: this.settings.requestTimeout,
                });
              } catch (error) {
                throw new CrawlError(
                  signal.aborted ||
                    (error instanceof Error && error.name === 'TimeoutError')
                    ? 'NAVIGATION_TIMEOUT'
                    : 'NAVIGATION_FAILED',
                );
              }
              const finalUrl = permittedUrl(page.url(), policy);
              if (response && response.status() >= 400)
                throw new CrawlError('HTTP_FAILURE', response.status() >= 500);
              await robots.assertAllowed(finalUrl, signal);
              return handler(page, finalUrl);
            }, signal);
            signal.throwIfAborted();
            values.push(result);
          } catch (error) {
            const safe =
              error instanceof CrawlError
                ? error
                : new CrawlError(
                    signal.aborted ? 'REQUEST_TIMEOUT' : 'EXTRACTION_FAILED',
                  );
            if (!safe.retryable || this.shutdown.signal.aborted)
              request.noRetry = true;
            throw safe;
          }
        },
        failedRequestHandler: ({ request }, error) => {
          fail(
            request.url,
            error instanceof CrawlError ? error.code : 'REQUEST_TIMEOUT',
          );
        },
      },
      config,
    );
    this.active = crawler;
    try {
      await crawler.run(requests.map((url) => ({ url, uniqueKey: url })));
    } finally {
      this.active = undefined;
      await queue.drop();
    }
    return { values, failures };
  }

  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort();
    this.active?.stop('Application shutdown');
    await this.tail;
  }
}

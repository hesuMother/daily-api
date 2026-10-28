import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import type { AppSettings } from '../../config/environment';
import { CrawlError } from '../types/external-product';

@Injectable()
export class LightpandaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(LightpandaService.name);
  private readonly settings: AppSettings['crawler'];
  private browser?: Browser;
  private connecting?: Promise<void>;
  private closing = false;
  private readonly contexts = new Set<BrowserContext>();

  constructor(config: ConfigService) {
    this.settings = config.getOrThrow<AppSettings>('app').crawler;
  }
  async onModuleInit(): Promise<void> {
    if (this.settings.enabled)
      await this.connect().catch(() =>
        this.logger.error(
          'LIGHTPANDA_UNAVAILABLE: crawler disabled until connection recovers',
        ),
      );
  }

  async connect(): Promise<void> {
    if (this.closing || !this.settings.enabled)
      throw new CrawlError('LIGHTPANDA_UNAVAILABLE', false);
    if (this.browser?.isConnected()) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        const browser = await chromium.connectOverCDP(this.settings.cdpUrl, {
          timeout: this.settings.requestTimeout,
        });
        if (this.closing) {
          await browser.close();
          throw new CrawlError('SHUTDOWN', false);
        }
        this.browser = browser;
      } catch {
        throw new CrawlError('LIGHTPANDA_UNAVAILABLE');
      }
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  get activeContexts(): number {
    return this.contexts.size;
  }

  // The pinned Lightpanda build rejects a second Target.createBrowserContext.
  // Enforce this through Crawlee concurrency, never by sharing cookies across requests.
  readonly contextCapacity = 1;
  get connected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  async withPage<T>(
    operation: (page: Page) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (!this.browser?.isConnected() || this.closing)
      throw new CrawlError('LIGHTPANDA_UNAVAILABLE');
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    const abort = () => {
      if (context) void context.close().catch(() => undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      try {
        signal.throwIfAborted();
        context = await this.browser.newContext();
        this.contexts.add(context);
        signal.throwIfAborted();
        page = await context.newPage();
        page.setDefaultTimeout(this.settings.requestTimeout);
        page.setDefaultNavigationTimeout(this.settings.requestTimeout);
      } catch {
        throw new CrawlError(
          signal.aborted ? 'REQUEST_TIMEOUT' : 'PAGE_CREATION_FAILED',
        );
      }
      signal.throwIfAborted();
      return await operation(page);
    } finally {
      signal.removeEventListener('abort', abort);
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      if (context) this.contexts.delete(context);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    await this.connecting?.catch(() => undefined);
    await Promise.allSettled(
      [...this.contexts].map((context) => context.close()),
    );
    this.contexts.clear();
    await this.browser?.close().catch(() => undefined);
  }
}

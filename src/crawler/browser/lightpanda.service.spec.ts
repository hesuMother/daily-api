import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import { crawlerSettings } from '../../config/crawler.config';
import { LightpandaService } from './lightpanda.service';

describe('Lightpanda browser lifecycle', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup() {
    const page = {
      close: jest.fn<() => Promise<void>>().mockResolvedValue(),
      setDefaultTimeout: jest.fn(),
      setDefaultNavigationTimeout: jest.fn(),
    };
    const context = {
      newPage: jest
        .fn<() => Promise<Page>>()
        .mockResolvedValue(page as unknown as Page),
      close: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };
    const browser = {
      isConnected: () => true,
      newContext: jest
        .fn<() => Promise<BrowserContext>>()
        .mockResolvedValue(context as unknown as BrowserContext),
      close: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };
    const connect = jest
      .spyOn(chromium, 'connectOverCDP')
      .mockResolvedValue(browser as unknown as Browser);
    const service = new LightpandaService(
      new ConfigService({
        app: { crawler: crawlerSettings({ CRAWLER_ENABLED: 'true' }) },
      }),
    );
    return { service, browser, context, page, connect };
  }
  it('creates only one connection and closes isolated page/context resources per request', async () => {
    const { service, connect, browser, context, page } = setup();
    await service.onModuleInit();
    await service.connect();
    for (let i = 0; i < 2; i++)
      await service.withPage(
        () => Promise.resolve('ok'),
        new AbortController().signal,
      );
    expect(connect).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(context.close).toHaveBeenCalledTimes(2);
    expect(page.close).toHaveBeenCalledTimes(2);
    expect(service.activeContexts).toBe(0);
    await service.onApplicationShutdown();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
  it('cleans up extraction and page creation failures', async () => {
    const { service, context, page } = setup();
    await service.onModuleInit();
    await expect(
      service.withPage(
        () => Promise.reject(new Error('parse')),
        new AbortController().signal,
      ),
    ).rejects.toThrow('parse');
    expect(page.close).toHaveBeenCalledTimes(1);
    context.newPage.mockRejectedValueOnce(new Error('CDP secret'));
    await expect(
      service.withPage(() => Promise.resolve(''), new AbortController().signal),
    ).rejects.toThrow('PAGE_CREATION_FAILED');
    expect(context.close).toHaveBeenCalledTimes(2);
    expect(service.activeContexts).toBe(0);
    await service.onApplicationShutdown();
  });
  it('fails clearly before connection and tolerates startup connection failure', async () => {
    const { service, connect } = setup();
    await expect(
      service.withPage(() => Promise.resolve(''), new AbortController().signal),
    ).rejects.toThrow('LIGHTPANDA_UNAVAILABLE');
    connect.mockRejectedValueOnce(new Error('private connection string'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.connected).toBe(false);
    await service.connect();
    expect(service.connected).toBe(true);
    await service.onApplicationShutdown();
  });
});

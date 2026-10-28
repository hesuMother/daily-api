import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { crawlerSettings } from '../../config/crawler.config';
import { ProductRefreshScheduler } from './product-refresh.scheduler';
import type { ProductService } from '../product.service';
import type { ProductRefreshRepository } from '../repository/product-refresh.repository';

describe('Periodic product refresh', () => {
  afterEach(() => jest.useRealTimers());
  const claim = { id: 'offer-id', token: 'claim-token' };
  const success = {
    products: [
      {
        provider: 'example',
        name: 'Shirt',
        price: 1000,
        productUrl: 'https://shop.test/a',
        fetchedAt: new Date(),
      },
    ],
    failures: [],
    saved: { created: 0, updated: 1, unchanged: 0 },
  };
  function setup(raw: Record<string, unknown> = {}) {
    const products = {
      listProviders: () => [{ id: 'example', name: 'Example' }],
      refreshOffer: jest
        .fn<ProductService['refreshOffer']>()
        .mockResolvedValue(success),
    };
    const repository = {
      claim: jest
        .fn<ProductRefreshRepository['claim']>()
        .mockResolvedValueOnce(claim)
        .mockResolvedValue(null),
      renew: jest
        .fn<ProductRefreshRepository['renew']>()
        .mockResolvedValue(true),
      finish: jest.fn<ProductRefreshRepository['finish']>().mockResolvedValue(),
    };
    const settings = crawlerSettings({ CRAWLER_ENABLED: 'true', ...raw });
    const scheduler = new ProductRefreshScheduler(
      new ConfigService({ app: { crawler: settings } }),
      products as unknown as ProductService,
      repository as unknown as ProductRefreshRepository,
    );
    return { scheduler, products, repository, settings };
  }
  it.each([{ CRAWLER_ENABLED: 'false' }, { CRAWLER_REFRESH_ENABLED: 'false' }])(
    'skips disabled scheduling',
    async (raw) => {
      const { scheduler, repository } = setup(raw);
      await scheduler.tick();
      expect(repository.claim).not.toHaveBeenCalled();
    },
  );
  it('refreshes stored offer IDs and schedules the next successful observation', async () => {
    const { scheduler, products, repository, settings } = setup();
    await scheduler.tick();
    expect(products.refreshOffer).toHaveBeenCalledWith(claim.id);
    expect(repository.finish).toHaveBeenCalledWith(
      claim,
      settings.refreshIntervalMs,
      null,
    );
  });
  it('does not overlap ticks and waits for a running refresh during shutdown', async () => {
    const { scheduler, products, repository } = setup();
    let complete!: (value: typeof success) => void;
    products.refreshOffer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = scheduler.tick();
    await Promise.resolve();
    const second = scheduler.tick();
    const closing = scheduler.onModuleDestroy();
    complete(success);
    await Promise.all([first, second, closing]);
    expect(products.refreshOffer).toHaveBeenCalledTimes(1);
    repository.claim.mockClear();
    await scheduler.tick();
    expect(repository.claim).not.toHaveBeenCalled();
  });
  it('reschedules a failed offer and continues with other offers', async () => {
    const { scheduler, products, repository, settings } = setup();
    repository.claim
      .mockReset()
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce({ id: 'next', token: 'next-token' })
      .mockResolvedValue(null);
    products.refreshOffer.mockRejectedValueOnce(
      new Error('private database connection'),
    );
    await scheduler.tick();
    expect(repository.finish).toHaveBeenNthCalledWith(
      1,
      claim,
      settings.refreshRetryDelayMs,
      'REFRESH_FAILED',
    );
    expect(products.refreshOffer).toHaveBeenCalledTimes(2);
  });
  it('backs off the batch when Lightpanda is unavailable', async () => {
    const { scheduler, products, repository, settings } = setup();
    products.refreshOffer.mockResolvedValueOnce({
      ...success,
      products: [],
      failures: [
        {
          provider: 'example',
          url: 'https://shop.test/a',
          code: 'LIGHTPANDA_UNAVAILABLE',
        },
      ],
    });
    await scheduler.tick();
    expect(repository.claim).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledWith(
      claim,
      settings.refreshRetryDelayMs,
      'LIGHTPANDA_UNAVAILABLE',
    );
  });
  it('renews a claim during slow refreshes and clears the heartbeat afterwards', async () => {
    jest.useFakeTimers();
    const { scheduler, products, repository } = setup();
    let complete!: (value: typeof success) => void;
    products.refreshOffer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const run = scheduler.tick();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30000);
    expect(repository.renew).toHaveBeenCalledWith(claim);
    complete(success);
    await run;
    expect(jest.getTimerCount()).toBe(0);
  });
  it('honors the batch size', async () => {
    const { scheduler, repository } = setup({
      CRAWLER_REFRESH_BATCH_SIZE: '1',
    });
    await scheduler.tick();
    expect(repository.claim).toHaveBeenCalledTimes(1);
  });
});

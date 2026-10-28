import { crawlerSettings } from './crawler.config';

describe('Crawler environment configuration', () => {
  it('starts disabled with low concurrency', () => {
    expect(crawlerSettings({})).toMatchObject({
      enabled: false,
      maxConcurrency: 3,
      maxRetries: 2,
      requestTimeout: 30000,
      refreshEnabled: true,
      refreshIntervalMs: 21600000,
      refreshRetryDelayMs: 900000,
      refreshBatchSize: 10,
      discoveryEnabled: false,
      discoveryIntervalMs: 3600000,
      discoveryBatchSize: 20,
    });
  });
  it.each([
    { CRAWLER_MAX_CONCURRENCY: '0' },
    { CRAWLER_MAX_RETRIES: '-1' },
    { CRAWLER_REQUEST_TIMEOUT: 'NaN' },
    { CRAWLER_ENABLED: 'yes' },
    { CRAWLER_REFRESH_ENABLED: 'yes' },
    { CRAWLER_REFRESH_INTERVAL_MS: '0' },
    { CRAWLER_REFRESH_RETRY_DELAY_MS: 'NaN' },
    { CRAWLER_REFRESH_BATCH_SIZE: '101' },
    { CRAWLER_DISCOVERY_ENABLED: 'yes' },
    { CRAWLER_DISCOVERY_INTERVAL_MS: '60000' },
    { CRAWLER_DISCOVERY_BATCH_SIZE: '0' },
    { LIGHTPANDA_CDP_URL: 'https://example.test' },
    { LIGHTPANDA_CDP_URL: 'ws://user:secret@example.test' },
  ])('rejects invalid settings', (input) => {
    expect(() => crawlerSettings(input)).toThrow();
  });
});

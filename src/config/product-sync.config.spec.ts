import { productSyncSettings } from './product-sync.config';

describe('Product sync configuration', () => {
  it('is disabled by default and deduplicates keywords', () => {
    expect(productSyncSettings({}).enabled).toBe(false);
    expect(
      productSyncSettings({ COUPANG_SYNC_KEYWORDS: 'shirt, shirt, coat' })
        .keywords,
    ).toEqual(['shirt', 'coat']);
  });
  it('requires credentials and search scope when enabled', () => {
    expect(() =>
      productSyncSettings({ COUPANG_SYNC_ENABLED: 'true' }),
    ).toThrow();
    expect(
      productSyncSettings({
        COUPANG_SYNC_ENABLED: 'true',
        COUPANG_ACCESS_KEY: 'test',
        COUPANG_SECRET_KEY: 'test',
        COUPANG_SYNC_KEYWORDS: 'shirt',
      }).enabled,
    ).toBe(true);
  });
  it.each([
    { COUPANG_SYNC_CRON: 'bad cron' },
    { COUPANG_SYNC_ENABLED: 'yes' },
    { COUPANG_MAX_RETRIES: 6 },
    { COUPANG_TIMEOUT_MS: 0 },
    { COUPANG_REQUEST_INTERVAL_MS: -1 },
  ])('rejects invalid settings %s', (input) => {
    expect(() => productSyncSettings(input)).toThrow();
  });
});

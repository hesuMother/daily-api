export interface CrawlerSettings {
  enabled: boolean;
  cdpUrl: string;
  maxConcurrency: number;
  maxRetries: number;
  requestTimeout: number;
  maxPages: number;
  maxRequestsPerMinute: number;
  exampleBaseUrl: string;
  refreshEnabled: boolean;
  refreshIntervalMs: number;
  refreshRetryDelayMs: number;
  refreshBatchSize: number;
  discoveryEnabled: boolean;
  discoveryIntervalMs: number;
  discoveryBatchSize: number;
}

export function crawlerSettings(raw: Record<string, unknown>): CrawlerSettings {
  const flag = raw.CRAWLER_ENABLED ?? 'false';
  if (flag !== 'true' && flag !== 'false')
    throw new Error('CRAWLER_ENABLED must be true or false');
  const refreshFlag = raw.CRAWLER_REFRESH_ENABLED ?? 'true';
  if (refreshFlag !== 'true' && refreshFlag !== 'false')
    throw new Error('CRAWLER_REFRESH_ENABLED must be true or false');
  const discoveryFlag = raw.CRAWLER_DISCOVERY_ENABLED ?? 'false';
  if (discoveryFlag !== 'true' && discoveryFlag !== 'false')
    throw new Error('CRAWLER_DISCOVERY_ENABLED must be true or false');
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = raw[key] === undefined ? fallback : Number(raw[key]);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(key + ' is outside its integer range');
    return value;
  };
  const url = (key: string, fallback: string, protocols: string[]) => {
    try {
      const value = raw[key] ?? fallback;
      if (typeof value !== 'string') throw new Error();
      const parsed = new URL(value);
      if (
        !protocols.includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        parsed.search
      )
        throw new Error();
      return parsed.href.replace(/\/$/, '');
    } catch {
      throw new Error(
        key + ' must be a URL without credentials, query or fragment',
      );
    }
  };
  return {
    enabled: flag === 'true',
    refreshEnabled: refreshFlag === 'true',
    refreshIntervalMs: number(
      'CRAWLER_REFRESH_INTERVAL_MS',
      21600000,
      60000,
      604800000,
    ),
    refreshRetryDelayMs: number(
      'CRAWLER_REFRESH_RETRY_DELAY_MS',
      900000,
      60000,
      86400000,
    ),
    refreshBatchSize: number('CRAWLER_REFRESH_BATCH_SIZE', 10, 1, 100),
    discoveryEnabled: discoveryFlag === 'true',
    discoveryIntervalMs: number(
      'CRAWLER_DISCOVERY_INTERVAL_MS',
      3600000,
      300000,
      86400000,
    ),
    discoveryBatchSize: number('CRAWLER_DISCOVERY_BATCH_SIZE', 20, 1, 100),
    cdpUrl: url('LIGHTPANDA_CDP_URL', 'ws://127.0.0.1:9222', ['ws:', 'wss:']),
    exampleBaseUrl: url(
      'CRAWLER_EXAMPLE_BASE_URL',
      'http://host.docker.internal:9080',
      ['http:', 'https:'],
    ),
    maxConcurrency: number('CRAWLER_MAX_CONCURRENCY', 3, 1, 10),
    maxRetries: number('CRAWLER_MAX_RETRIES', 2, 0, 5),
    requestTimeout: number('CRAWLER_REQUEST_TIMEOUT', 30000, 1000, 120000),
    maxPages: number('CRAWLER_MAX_PAGES', 30, 1, 100),
    maxRequestsPerMinute: number('CRAWLER_MAX_REQUESTS_PER_MINUTE', 30, 1, 120),
  };
}

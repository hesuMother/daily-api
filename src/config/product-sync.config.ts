import { CronTime } from 'cron';

export interface ProductSyncSettings {
  enabled: boolean;
  cron: string;
  accessKey: string;
  secretKey: string;
  subId?: string;
  keywords: string[];
  timeoutMs: number;
  requestIntervalMs: number;
  maxRetries: number;
  retryBaseMs: number;
  maxBackoffMs: number;
}

export function productSyncSettings(
  raw: Record<string, unknown>,
): ProductSyncSettings {
  if (
    raw.COUPANG_SYNC_ENABLED !== undefined &&
    raw.COUPANG_SYNC_ENABLED !== 'true' &&
    raw.COUPANG_SYNC_ENABLED !== 'false'
  ) {
    throw new Error('COUPANG_SYNC_ENABLED must be true or false');
  }
  const enabled = raw.COUPANG_SYNC_ENABLED === 'true';
  const value = (key: string, fallback = '') =>
    typeof raw[key] === 'string' ? raw[key].trim() : fallback;
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const n = raw[key] === undefined ? fallback : Number(raw[key]);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`${key} is outside its integer range`);
    return n;
  };
  const cron = value('COUPANG_SYNC_CRON', '0 0 */6 * * *');
  try {
    new CronTime(cron, 'Asia/Seoul');
  } catch {
    throw new Error('Invalid COUPANG_SYNC_CRON');
  }
  const accessKey = value('COUPANG_ACCESS_KEY');
  const secretKey = value('COUPANG_SECRET_KEY');
  const keywords = [
    ...new Set(
      value('COUPANG_SYNC_KEYWORDS')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (enabled && (!accessKey || !secretKey || keywords.length === 0)) {
    throw new Error(
      'Coupang sync requires access/secret keys and COUPANG_SYNC_KEYWORDS',
    );
  }
  return {
    enabled,
    cron,
    accessKey,
    secretKey,
    subId: value('COUPANG_SUB_ID') || undefined,
    keywords,
    timeoutMs: integer('COUPANG_TIMEOUT_MS', 10000, 100, 120000),
    // 운영 조절값이며 쿠팡의 공식 제한값을 의미하지 않습니다.
    requestIntervalMs: integer('COUPANG_REQUEST_INTERVAL_MS', 1000, 0, 60000),
    maxRetries: integer('COUPANG_MAX_RETRIES', 2, 0, 5),
    retryBaseMs: integer('COUPANG_RETRY_BASE_MS', 1000, 1, 60000),
    maxBackoffMs: integer('COUPANG_MAX_BACKOFF_MS', 60000, 1, 300000),
  };
}

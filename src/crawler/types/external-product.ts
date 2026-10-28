/** KRW integer amounts. Missing prices are never represented by zero. */
export interface ExternalProduct {
  provider: string;
  externalId?: string;
  name: string;
  brand?: string;
  price: number | null;
  originalPrice?: number | null;
  modelNumber?: string;
  sku?: string;
  imageUrl?: string;
  productUrl: string;
  category?: string;
  inStock?: boolean;
  fetchedAt: Date;
}

export type CrawlFailureCode =
  | 'NAVIGATION_TIMEOUT'
  | 'MALFORMED_JSON_LD'
  | 'PRODUCT_NOT_FOUND'
  | 'PRICE_MISSING'
  | 'LIGHTPANDA_UNAVAILABLE'
  | 'PAGE_CREATION_FAILED'
  | 'NAVIGATION_FAILED'
  | 'HTTP_FAILURE'
  | 'ROBOTS_DENIED'
  | 'URL_NOT_ALLOWED'
  | 'EXTRACTION_FAILED'
  | 'REQUEST_TIMEOUT'
  | 'OUT_OF_SCOPE'
  | 'SITEMAP_UNAVAILABLE'
  | 'SHUTDOWN';
export interface CrawlFailure {
  provider: string;
  url: string;
  code: CrawlFailureCode;
}
export interface ProviderResult {
  products: ExternalProduct[];
  failures: CrawlFailure[];
}
export class CrawlError extends Error {
  constructor(
    readonly code: CrawlFailureCode,
    readonly retryable = true,
  ) {
    super(code);
  }
}

export function safeLogUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return '[invalid-url]';
  }
}

import type { ProviderResult } from '../types/external-product';

export const PRODUCT_PROVIDERS = Symbol('PRODUCT_PROVIDERS');
/** API and crawler providers implement the same contract, including partial failures. */
export interface ProductProvider {
  readonly id: string;
  readonly name: string;
  /** Omitted when the site offers no keyword search we can use. */
  search?(keyword: string): Promise<ProviderResult>;
  getProduct(url: string): Promise<ProviderResult>;
  /** Product page URLs, newest first, from a listing the site publishes for crawlers (e.g. a sitemap). */
  listProductUrls?(): Promise<string[]>;
  getProducts?(urls: string[]): Promise<ProviderResult>;
}

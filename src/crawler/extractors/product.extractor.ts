import type { Page } from 'playwright-core';
import {
  asObject,
  extractProductJsonLd,
  type JsonObject,
} from './json-ld.extractor';
import { parseKrwPrice } from './price.parser';
import type { ExternalProduct } from '../types/external-product';

export const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
function httpUrl(value: unknown, base: string): string | undefined {
  const text = textValue(value);
  if (!text) return undefined;
  try {
    const url = new URL(text, base);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeProduct(
  data: JsonObject,
  provider: string,
  productUrl: string,
): ExternalProduct | null {
  const name = textValue(data.name);
  if (!name) return null;
  const offers = (Array.isArray(data.offers) ? data.offers : [data.offers])
    .map(asObject)
    .filter((entry): entry is JsonObject => entry !== null);
  // Keep price, currency and stock from the same offer; do not combine unrelated variants.
  const offer =
    offers.find(
      (entry) =>
        parseKrwPrice(entry.price ?? entry.lowPrice, entry.priceCurrency) !==
        null,
    ) ?? offers[0];
  const availability = textValue(offer?.availability)?.split('/').pop();
  const image = Array.isArray(data.image)
    ? (data.image[0] as unknown)
    : data.image;
  return {
    provider,
    name,
    productUrl,
    externalId: textValue(data.productID),
    brand: textValue(data.brand) ?? textValue(asObject(data.brand)?.name),
    price: parseKrwPrice(offer?.price ?? offer?.lowPrice, offer?.priceCurrency),
    originalPrice:
      data.originalPrice === undefined
        ? undefined
        : parseKrwPrice(data.originalPrice, offer?.priceCurrency),
    modelNumber: textValue(data.mpn),
    sku: textValue(data.sku),
    category: textValue(data.category),
    imageUrl:
      httpUrl(image, productUrl) ??
      httpUrl(asObject(image)?.url ?? asObject(image)?.contentUrl, productUrl),
    inStock: ['InStock', 'LimitedAvailability', 'OnlineOnly'].includes(
      availability ?? '',
    )
      ? true
      : ['OutOfStock', 'SoldOut', 'Discontinued'].includes(availability ?? '')
        ? false
        : undefined,
    fetchedAt: new Date(),
  };
}

export interface SiteProductParser {
  structuredState(page: Page): Promise<JsonObject | null>;
  dom(page: Page): Promise<JsonObject | null>;
}

export async function extractProduct(
  page: Page,
  provider: string,
  url: string,
  parser: SiteProductParser,
  malformed: () => void,
): Promise<ExternalProduct | null> {
  const jsonLd = await extractProductJsonLd(page, malformed);
  if (jsonLd) {
    const product = normalizeProduct(jsonLd, provider, url);
    if (product) return product;
  }
  const state = await parser.structuredState(page);
  if (state) {
    const product = normalizeProduct(state, provider, url);
    if (product) return product;
  }
  const dom = await parser.dom(page);
  return dom ? normalizeProduct(dom, provider, url) : null;
}

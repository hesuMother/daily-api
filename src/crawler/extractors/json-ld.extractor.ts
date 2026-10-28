import type { Page } from 'playwright-core';

export type JsonObject = Record<string, unknown>;
export const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

export function findProduct(value: unknown, depth = 0): JsonObject | null {
  if (depth > 20) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const product = findProduct(entry, depth + 1);
      if (product) return product;
    }
    return null;
  }
  const object = asObject(value);
  if (!object) return null;
  const types: unknown[] = Array.isArray(object['@type'])
    ? object['@type']
    : [object['@type']];
  if (
    types.some(
      (type) =>
        type === 'Product' ||
        type === 'https://schema.org/Product' ||
        type === 'http://schema.org/Product',
    )
  )
    return object;
  return findProduct(object['@graph'], depth + 1);
}

export function parseProductJsonLd(
  scripts: string[],
  malformed: () => void = () => undefined,
): JsonObject | null {
  for (const script of scripts) {
    try {
      const product = findProduct(JSON.parse(script) as unknown);
      if (product) return product;
    } catch {
      malformed();
    }
  }
  return null;
}

export async function extractProductJsonLd(
  page: Page,
  malformed?: () => void,
): Promise<JsonObject | null> {
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return parseProductJsonLd(scripts, malformed);
}

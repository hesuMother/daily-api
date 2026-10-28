import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright-core';
import {
  asObject,
  type JsonObject,
} from '../../../extractors/json-ld.extractor';
import type { SiteProductParser } from '../../../extractors/product.extractor';

@Injectable()
export class ExampleParser implements SiteProductParser {
  async structuredState(page: Page): Promise<JsonObject | null> {
    const scripts = await page
      .locator('script#product-state')
      .allTextContents();
    for (const script of scripts) {
      try {
        return asObject(asObject(JSON.parse(script) as unknown)?.product);
      } catch {
        /* DOM fallback follows. */
      }
    }
    return null;
  }
  async dom(page: Page): Promise<JsonObject | null> {
    const name = (
      await page.locator('[data-product-name]').allTextContents()
    )[0];
    if (!name) return null;
    const price = (
      await page.locator('[data-product-price]').allTextContents()
    )[0];
    const brand = (
      await page.locator('[data-product-brand]').allTextContents()
    )[0];
    return { name, brand, offers: { price, priceCurrency: 'KRW' } };
  }
}

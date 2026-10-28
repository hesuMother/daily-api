import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppSettings } from '../../config/environment';
import type { ProductProvider } from '../../crawler/providers/product-provider.interface';
import {
  CrawlError,
  safeLogUrl,
  type CrawlFailure,
} from '../../crawler/types/external-product';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ProductService } from '../product.service';

type DiscoverableProvider = ProductProvider &
  Required<Pick<ProductProvider, 'listProductUrls' | 'getProducts'>>;

const CHUNK = 500;

/**
 * Finds products that are not stored yet from a provider's published listing and saves them.
 * Pages the provider rejects as OUT_OF_SCOPE (e.g. non-clothing) are remembered in Redis and not visited again.
 */
@Injectable()
export class ProductDiscoveryService {
  private readonly logger = new Logger(ProductDiscoveryService.name);
  private readonly settings: AppSettings['crawler'];

  constructor(
    config: ConfigService,
    private readonly products: ProductService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').crawler;
  }

  discoverableProviders(): string[] {
    return this.products
      .listProviders()
      .map(({ id }) => this.products.provider(id))
      .filter(isDiscoverable)
      .map(({ id }) => id);
  }

  async discover(providerId: string, limit = this.settings.discoveryBatchSize) {
    const provider = this.products.provider(providerId);
    if (!isDiscoverable(provider))
      throw new BadRequestException(
        '이 Provider는 신규 상품 탐색을 지원하지 않습니다.',
      );
    // The crawler visits at most maxPages per batch.
    const budget = Math.max(1, Math.min(limit, this.settings.maxPages));
    let candidates: string[];
    try {
      candidates = await provider.listProductUrls();
    } catch (error) {
      const failure: CrawlFailure = {
        provider: provider.id,
        url: '[sitemap]',
        code: error instanceof CrawlError ? error.code : 'SITEMAP_UNAVAILABLE',
      };
      this.logger.warn(JSON.stringify(failure));
      return {
        products: [],
        saved: { created: 0, updated: 0, unchanged: 0 },
        failures: [failure],
        visited: 0,
        skipped: 0,
      };
    }
    const picked: string[] = [];
    for (
      let i = 0;
      i < candidates.length && picked.length < budget;
      i += CHUNK
    ) {
      const chunk = candidates.slice(i, i + CHUNK);
      const known = await this.known(provider.id, chunk);
      for (const url of chunk) {
        if (picked.length >= budget) break;
        if (!known.has(url)) picked.push(url);
      }
    }
    const result = picked.length
      ? await provider.getProducts(picked)
      : { products: [], failures: [] };
    const outOfScope = result.failures
      .filter((failure) => failure.code === 'OUT_OF_SCOPE')
      .map((failure) => failure.url);
    if (outOfScope.length)
      await this.redis.execute((client) =>
        client.sadd(this.skipKey(provider.id), ...outOfScope),
      );
    const saved = await this.products.save(provider, {
      products: result.products,
      // Out-of-scope pages are an expected outcome of discovery, not errors.
      failures: result.failures.filter(
        (failure) => failure.code !== 'OUT_OF_SCOPE',
      ),
    });
    return { ...saved, visited: picked.length, skipped: outOfScope.length };
  }

  /** URLs already stored as offers or previously rejected as out of scope. */
  private async known(
    providerId: string,
    urls: string[],
  ): Promise<Set<string>> {
    const [offers, skipped] = await Promise.all([
      this.prisma.productOffer.findMany({
        where: { seller: { slug: providerId }, productUrl: { in: urls } },
        select: { productUrl: true },
      }),
      this.redis.execute((client) =>
        client.smismember(
          this.skipKey(providerId),
          ...urls.map((url) => safeLogUrl(url)),
        ),
      ),
    ]);
    const known = new Set<string>();
    for (const offer of offers)
      if (offer.productUrl) known.add(offer.productUrl);
    urls.forEach((url, index) => {
      if (skipped[index]) known.add(url);
    });
    return known;
  }

  private skipKey(providerId: string): string {
    return this.redis.keyPrefix + ':crawler:out-of-scope:' + providerId;
  }
}

function isDiscoverable(
  provider: ProductProvider,
): provider is DiscoverableProvider {
  return (
    typeof provider.listProductUrls === 'function' &&
    typeof provider.getProducts === 'function'
  );
}

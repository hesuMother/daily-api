import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PRODUCT_PROVIDERS,
  type ProductProvider,
} from '../crawler/providers/product-provider.interface';
import type {
  ExternalProduct,
  ProviderResult,
} from '../crawler/types/external-product';
import { safeLogUrl } from '../crawler/types/external-product';
import { ProductSyncService } from './sync/product-sync.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  constructor(
    @Inject(PRODUCT_PROVIDERS) private readonly providers: ProductProvider[],
    private readonly sync: ProductSyncService,
    private readonly prisma: PrismaService,
  ) {}

  listProviders() {
    return this.providers.map(({ id, name }) => ({ id, name }));
  }
  async search(providerId: string, keyword: string) {
    const provider = this.provider(providerId);
    if (!provider.search)
      throw new BadRequestException(
        '이 Provider는 키워드 검색을 지원하지 않습니다. 신규 상품 탐색을 사용하세요.',
      );
    return this.save(provider, await provider.search(keyword));
  }
  async refresh(providerId: string, url: string) {
    const provider = this.provider(providerId);
    return this.save(provider, await provider.getProduct(url));
  }
  async refreshOffer(id: string) {
    const offer = await this.prisma.productOffer.findUnique({
      where: { id },
      select: { productUrl: true, seller: { select: { slug: true } } },
    });
    if (!offer) throw new NotFoundException('판매 정보를 찾을 수 없습니다.');
    if (!offer.productUrl)
      throw new BadRequestException('갱신할 상품 페이지 주소가 없습니다.');
    return this.refresh(offer.seller.slug, offer.productUrl);
  }
  provider(id: string): ProductProvider {
    const provider = this.providers.find((item) => item.id === id);
    if (!provider)
      throw new NotFoundException('등록되지 않은 상품 Provider입니다.');
    return provider;
  }
  /** Saves each product independently and reports persistence failures alongside crawl failures. */
  async save(provider: ProductProvider, result: ProviderResult) {
    const products: ExternalProduct[] = [];
    const failures: { provider: string; url: string; code: string }[] = [
      ...result.failures,
    ];
    const saved = { created: 0, updated: 0, unchanged: 0 };
    for (const product of result.products) {
      try {
        if (product.provider !== provider.id)
          throw new Error('PROVIDER_MISMATCH');
        const outcome = await this.sync.sync(
          {
            externalProductId: product.externalId,
            name: product.name,
            price: product.price,
            productUrl: product.productUrl,
            purchaseUrl: product.productUrl,
            currency: 'KRW',
            originalPrice: product.originalPrice,
            brand: product.brand,
            category: product.category,
            modelNumber: product.modelNumber,
            sku: product.sku,
            imageUrl: product.imageUrl,
            isSoldOut: product.inStock === undefined ? null : !product.inStock,
            fetchedAt: product.fetchedAt,
          },
          { slug: provider.id, name: provider.name },
        );
        saved[outcome]++;
        products.push(product);
      } catch {
        const failure = {
          provider: provider.id,
          url: safeLogUrl(product.productUrl),
          code: 'PERSISTENCE_FAILED',
        };
        failures.push(failure);
        this.logger.error(JSON.stringify(failure));
      }
    }
    return { products, saved, failures };
  }
}

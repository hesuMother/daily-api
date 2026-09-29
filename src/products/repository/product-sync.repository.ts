import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type {
  CollectedProduct,
  ProductSource,
} from '../collectors/collected-product.interface';

export type SyncOutcome = 'created' | 'updated' | 'unchanged';

@Injectable()
export class ProductSyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  async sync(
    source: ProductSource,
    product: CollectedProduct,
  ): Promise<SyncOutcome> {
    // 최초 수집의 고유 키 충돌과 직렬화 충돌만 최대 두 번 재시도합니다.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const seller = await tx.seller.upsert({
              where: { slug: source.slug },
              update: {},
              create: {
                slug: source.slug,
                name: source.name,
                isInternal: false,
              },
              select: { id: true },
            });
            const existing = await tx.productOffer.findUnique({
              where: {
                sellerId_externalProductId: {
                  sellerId: seller.id,
                  externalProductId: product.externalProductId,
                },
              },
            });
            const currency = product.currency ?? 'KRW';
            if (!existing) {
              const created = await this.createProduct(tx, product);
              await tx.productOffer.create({
                data: {
                  productId: created.id,
                  sellerId: seller.id,
                  externalProductId: product.externalProductId,
                  price: product.price,
                  currency,
                  purchaseUrl: product.purchaseUrl,
                  isSoldOut: product.isSoldOut ?? false,
                  priceHistories: {
                    create: { price: product.price, currency },
                  },
                },
              });
              return 'created';
            }
            const priceChanged =
              existing.price !== product.price ||
              existing.currency !== currency;
            const changed =
              priceChanged ||
              (product.purchaseUrl !== undefined &&
                product.purchaseUrl !== existing.purchaseUrl) ||
              (product.isSoldOut !== undefined &&
                product.isSoldOut !== existing.isSoldOut);
            // 응답에 없는 URL/품절 상태는 보존하고 updatedAt은 마지막 관측 시각으로 갱신합니다.
            await tx.productOffer.update({
              where: { id: existing.id },
              data: {
                price: product.price,
                currency,
                purchaseUrl: product.purchaseUrl,
                isSoldOut: product.isSoldOut,
                ...(priceChanged
                  ? {
                      priceHistories: {
                        create: { price: product.price, currency },
                      },
                    }
                  : {}),
              },
            });
            // 다른 소스에서 같은 Product를 사용해도 기존 이미지는 보존합니다.
            // Serializable 트랜잭션은 동시 이미지 조회/생성 충돌도 감지합니다.
            if (
              product.imageUrl &&
              !(await tx.productImage.findFirst({
                where: {
                  productId: existing.productId,
                  imageUrl: product.imageUrl,
                },
                select: { id: true },
              }))
            ) {
              await tx.productImage.create({
                data: {
                  productId: existing.productId,
                  imageUrl: product.imageUrl,
                },
              });
            }
            return changed ? 'updated' : 'unchanged';
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 10000,
          },
        );
      } catch (error) {
        if (
          attempt >= 2 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2002', 'P2034'].includes(error.code)
        )
          throw error;
      }
    }
  }

  private createProduct(
    tx: Prisma.TransactionClient,
    product: CollectedProduct,
  ) {
    // 향후 ProductMatcher 도입 지점입니다. 이름만으로 다른 판매처 상품과 합치지 않습니다.
    return tx.product.create({
      data: {
        name: product.name,
        ...(product.imageUrl
          ? { images: { create: { imageUrl: product.imageUrl } } }
          : {}),
      },
      select: { id: true },
    });
  }
}

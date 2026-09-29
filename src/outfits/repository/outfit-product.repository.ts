import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { ProductPickerQueryDto } from '../dto/outfit.dto';

const productSelect = {
  id: true,
  name: true,
  images: {
    take: 1,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { imageUrl: true },
  },
  offers: {
    take: 5,
    orderBy: [{ price: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      price: true,
      currency: true,
      purchaseUrl: true,
      isSoldOut: true,
      seller: { select: { name: true } },
    },
  },
} satisfies Prisma.ProductSelect;

@Injectable()
export class OutfitProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, query: ProductPickerQueryDto) {
    const where: Prisma.ProductWhereInput = {
      isDeleted: false,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const paging = {
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    };
    if (query.source === 'all') {
      const rows = await this.prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging,
      });
      return {
        items: rows
          .slice(0, query.limit)
          .map((product) => ({ productId: product.id, product })),
        page: query.page,
        hasMore: rows.length > query.limit,
      };
    }
    if (query.source === 'bookmarks') {
      const rows = await this.prisma.productBookmark.findMany({
        where: {
          userId,
          isDeleted: false,
          OR: [
            { product: where },
            {
              productId: null,
              ...(query.q
                ? {
                    legacyProductName: {
                      contains: query.q,
                      mode: 'insensitive',
                    },
                  }
                : {}),
            },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...paging,
        select: {
          id: true,
          productId: true,
          legacyProductName: true,
          legacyProductLink: true,
          product: { select: productSelect },
        },
      });
      return {
        items: rows.slice(0, query.limit).map((row) => ({
          bookmarkId: row.id,
          productId: row.productId,
          product: row.product,
          ...(row.product
            ? {}
            : {
                manual: {
                  name: row.legacyProductName ?? '외부 상품',
                  link: row.legacyProductLink,
                },
              }),
        })),
        page: query.page,
        hasMore: rows.length > query.limit,
      };
    }
    const rows = await this.prisma.productHistory.findMany({
      where: {
        userId,
        isDeleted: false,
        OR: [
          { product: where },
          {
            productId: null,
            ...(query.q
              ? {
                  legacyProductLink: { contains: query.q, mode: 'insensitive' },
                }
              : {}),
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paging,
      select: {
        id: true,
        productId: true,
        legacyProductLink: true,
        createdAt: true,
        product: { select: productSelect },
      },
    });
    return {
      items: rows.slice(0, query.limit).map((row) => ({
        historyId: row.id,
        productId: row.productId,
        product: row.product,
        viewedAt: row.createdAt,
        ...(row.product
          ? {}
          : { manual: { name: '외부 상품', link: row.legacyProductLink } }),
      })),
      page: query.page,
      hasMore: rows.length > query.limit,
    };
  }

  recordView(userId: string, productId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireProduct(tx, productId);
      await tx.productHistory.create({ data: { userId, productId } });
    });
  }

  bookmark(userId: string, productId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireProduct(tx, productId);
      return tx.productBookmark.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId },
        update: { isDeleted: false },
        select: { productId: true, isDeleted: true },
      });
    });
  }

  async unbookmark(userId: string, productId: string): Promise<void> {
    await this.prisma.productBookmark.updateMany({
      where: { userId, productId },
      data: { isDeleted: true },
    });
  }

  private async requireProduct(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    if (
      !(await tx.product.findFirst({
        where: { id, isDeleted: false },
        select: { id: true },
      }))
    )
      throw new NotFoundException('상품을 찾을 수 없습니다.');
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ReportTargetType } from '../generated/prisma/client';
import {
  visibleOutfit,
  type OutfitViewer,
} from '../outfits/repository/outfit.repository';

@Injectable()
export class SupportTargetService {
  async assertAccessible(
    tx: Prisma.TransactionClient,
    type: ReportTargetType,
    id: string,
    user: OutfitViewer,
  ): Promise<void> {
    const select = { id: true } as const;
    let target: { id: string } | null = null;
    switch (type) {
      case 'OUTFIT':
        target = await tx.outfit.findFirst({
          where: { id, ...visibleOutfit(user) },
          select,
        });
        break;
      case 'USER':
        target = await tx.user.findUnique({ where: { id }, select });
        break;
      case 'PRODUCT':
        target = await tx.product.findFirst({
          where: { id, isDeleted: false },
          select,
        });
        break;
      case 'PRODUCT_OFFER':
        target = await tx.productOffer.findFirst({
          where: { id, product: { isDeleted: false } },
          select,
        });
        break;
      case 'PRODUCT_HISTORY':
        target = await tx.productHistory.findFirst({
          where: { id, userId: user.id, isDeleted: false },
          select,
        });
        break;
      case 'PRODUCT_BOOKMARK':
        target = await tx.productBookmark.findFirst({
          where: { id, userId: user.id, isDeleted: false },
          select,
        });
        break;
    }
    if (!target) throw new NotFoundException('대상을 찾을 수 없습니다.');
  }
}

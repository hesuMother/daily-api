import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type {
  CreateOutfitDto,
  PageQueryDto,
  ReviewOutfitDto,
} from '../dto/outfit.dto';

const outfitSelect = {
  id: true,
  authorId: true,
  name: true,
  description: true,
  height: true,
  weight: true,
  imageUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, username: true, profileImageUrl: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      type: true,
      name: true,
      link: true,
      productId: true,
      offerId: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.OutfitSelect;

export interface OutfitViewer {
  id: string;
  role: UserRole;
}

export function visibleOutfit(viewer?: OutfitViewer): Prisma.OutfitWhereInput {
  if (viewer?.role === 'ADMIN') return {};
  return {
    OR: [{ status: 'APPROVED' }, ...(viewer ? [{ authorId: viewer.id }] : [])],
  };
}

@Injectable()
export class OutfitRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(id: string, authorId: string, dto: CreateOutfitDto) {
    return this.prisma.$transaction(async (tx) => {
      const items: Prisma.OutfitItemCreateWithoutOutfitInput[] = [];
      for (const [sortOrder, item] of dto.items.entries()) {
        if (item.productId) {
          if (item.name !== undefined || item.link !== undefined)
            throw new BadRequestException(
              '상품 선택과 직접 입력은 동시에 사용할 수 없습니다.',
            );
          const product = await tx.product.findFirst({
            where: { id: item.productId, isDeleted: false },
            select: { id: true, name: true },
          });
          if (!product)
            throw new BadRequestException('선택한 상품을 사용할 수 없습니다.');
          const offer = item.offerId
            ? await tx.productOffer.findFirst({
                where: { id: item.offerId, productId: product.id },
                select: { id: true, purchaseUrl: true },
              })
            : null;
          if (item.offerId && !offer)
            throw new BadRequestException(
              '판매 정보가 선택한 상품에 속하지 않습니다.',
            );
          items.push({
            type: item.type,
            name: product.name,
            link: offer?.purchaseUrl,
            sortOrder,
            product: { connect: { id: product.id } },
            ...(offer ? { offer: { connect: { id: offer.id } } } : {}),
          });
        } else {
          if (item.offerId || !item.name?.trim())
            throw new BadRequestException(
              '직접 입력 아이템은 이름이 필요하고 판매 정보 ID는 사용할 수 없습니다.',
            );
          items.push({
            type: item.type,
            name: item.name,
            link: item.link,
            sortOrder,
          });
        }
      }
      const outfit = await tx.outfit.create({
        data: {
          id,
          authorId,
          name: dto.name,
          description: dto.description,
          height: dto.height,
          weight: dto.weight,
          imageUrl: `/v1/outfits/${id}/image`,
          status: 'PENDING',
          items: { create: items },
        },
        select: outfitSelect,
      });
      await tx.auditLog.create({
        data: {
          actorId: authorId,
          action: 'CREATE',
          targetType: 'outfit',
          targetId: id,
        },
      });
      return outfit;
    });
  }

  async detail(id: string, viewer?: OutfitViewer) {
    const outfit = await this.prisma.outfit.findFirst({
      where: { id, ...visibleOutfit(viewer) },
      select: outfitSelect,
    });
    if (!outfit) throw new NotFoundException('코디를 찾을 수 없습니다.');
    const rejectionLog =
      viewer && (viewer.id === outfit.authorId || viewer.role === 'ADMIN')
        ? await this.prisma.rejectedOutfit.findMany({
            where: { outfitId: id },
            orderBy: { reviewedAt: 'desc' },
            take: 10,
            select: { reason: true, reviewedAt: true },
          })
        : undefined;
    return { ...outfit, ...(rejectionLog ? { rejectionLog } : {}) };
  }

  async list(
    query: PageQueryDto,
    scope: 'public' | 'mine' | 'pending',
    authorId?: string,
  ) {
    const where: Prisma.OutfitWhereInput =
      scope === 'mine'
        ? { authorId }
        : { status: scope === 'pending' ? 'PENDING' : 'APPROVED' };
    const rows = await this.prisma.outfit.findMany({
      where,
      select: outfitSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    });
    return {
      items: rows.slice(0, query.limit),
      page: query.page,
      hasMore: rows.length > query.limit,
    };
  }

  review(id: string, reviewerId: string, dto: ReviewOutfitDto) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.outfit.updateMany({
        where: { id, status: 'PENDING', authorId: { not: null } },
        data: { status: dto.status },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          '이미 검수되었거나 작성자 확인이 필요한 코디입니다.',
        );
      if (dto.status === 'REJECTED')
        await tx.rejectedOutfit.create({
          data: { outfitId: id, reviewerId, reason: dto.reason! },
        });
      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: dto.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
          targetType: 'outfit',
          targetId: id,
        },
      });
      return tx.outfit.findUniqueOrThrow({
        where: { id },
        select: outfitSelect,
      });
    });
  }
}

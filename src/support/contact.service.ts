import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { OutfitViewer } from '../outfits/repository/outfit.repository';
import type { ContactQueryDto, CreateContactDto } from './dto/support.dto';
import { SupportTargetService } from './support-target.service';

const publicSelect = {
  id: true,
  reason: true,
  description: true,
  feature: true,
  targetType: true,
  targetId: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ContactSelect;
const adminSelect = {
  ...publicSelect,
  user: { select: { id: true, username: true, email: true } },
} satisfies Prisma.ContactSelect;

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: SupportTargetService,
  ) {}

  categories() {
    return this.prisma.contactCategory.findMany({
      orderBy: { slug: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  create(user: OutfitViewer, dto: CreateContactDto) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.contactCategory.findUnique({
          where: { id: dto.categoryId },
          select: { id: true },
        }))
      )
        throw new BadRequestException('문의 분류를 찾을 수 없습니다.');
      if (dto.targetType && dto.targetId)
        await this.targets.assertAccessible(
          tx,
          dto.targetType,
          dto.targetId,
          user,
        );
      const contact = await tx.contact.create({
        data: {
          reason: dto.reason,
          description: dto.description,
          feature: dto.feature,
          targetType: dto.targetType,
          targetId: dto.targetId,
          contactCategoryId: dto.categoryId,
          contactUserId: user.id,
        },
        select: publicSelect,
      });
      await tx.discordNotification.create({
        data: { kind: 'CONTACT', targetId: contact.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CREATE',
          targetType: 'contact',
          targetId: contact.id,
        },
      });
      return contact;
    });
  }

  async list(query: ContactQueryDto, contactUserId?: string) {
    const rows = await this.prisma.contact.findMany({
      where: {
        contactUserId,
        ...(query.view === 'unread'
          ? { readAt: null }
          : query.view === 'read'
            ? { readAt: { not: null } }
            : {}),
      },
      select: contactUserId ? publicSelect : adminSelect,
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

  async detail(id: string, contactUserId?: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, contactUserId },
      select: contactUserId ? publicSelect : adminSelect,
    });
    if (!contact) throw new NotFoundException('문의를 찾을 수 없습니다.');
    if (contactUserId) return contact;
    const notification = await this.prisma.discordNotification.findUnique({
      where: { kind_targetId: { kind: 'CONTACT', targetId: id } },
      select: {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        deliveredAt: true,
      },
    });
    return { ...contact, notification };
  }

  markRead(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!contact) throw new NotFoundException('문의를 찾을 수 없습니다.');
      const changed = await tx.contact.updateMany({
        where: { id, readAt: null },
        data: { readAt: new Date(), status: 'IN_PROGRESS' },
      });
      if (changed.count)
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'UPDATE',
            targetType: 'contact',
            targetId: id,
            metadata: { action: 'MARK_READ' },
          },
        });
      return tx.contact.findUniqueOrThrow({
        where: { id },
        select: adminSelect,
      });
    });
  }
}

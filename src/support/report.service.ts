import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { OutfitViewer } from '../outfits/repository/outfit.repository';
import type {
  CreateReportDto,
  ReportQueryDto,
  UpdateReportStatusDto,
} from './dto/support.dto';
import { SupportTargetService } from './support-target.service';

const publicSelect = {
  id: true,
  reason: true,
  description: true,
  targetType: true,
  targetId: true,
  status: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ReportSelect;
const adminSelect = {
  ...publicSelect,
  adminNote: true,
  reporter: { select: { id: true, username: true, email: true } },
} satisfies Prisma.ReportSelect;

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: SupportTargetService,
  ) {}

  categories() {
    return this.prisma.reportCategory.findMany({
      orderBy: { slug: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  create(user: OutfitViewer, dto: CreateReportDto) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.reportCategory.findUnique({
          where: { id: dto.categoryId },
          select: { id: true },
        }))
      )
        throw new BadRequestException('신고 분류를 찾을 수 없습니다.');
      await this.targets.assertAccessible(
        tx,
        dto.targetType,
        dto.targetId,
        user,
      );
      const report = await tx.report.create({
        data: {
          reason: dto.reason,
          description: dto.description,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reportCategoryId: dto.categoryId,
          reporterId: user.id,
        },
        select: publicSelect,
      });
      await tx.discordNotification.create({
        data: { kind: 'REPORT', targetId: report.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CREATE',
          targetType: 'report',
          targetId: report.id,
        },
      });
      return report;
    });
  }

  async list(query: ReportQueryDto, reporterId?: string) {
    const rows = await this.prisma.report.findMany({
      where: { reporterId, status: query.status, targetType: query.targetType },
      select: reporterId ? publicSelect : adminSelect,
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

  async detail(id: string, reporterId?: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, reporterId },
      select: reporterId ? publicSelect : adminSelect,
    });
    if (!report) throw new NotFoundException('신고를 찾을 수 없습니다.');
    if (reporterId) return report;
    const history = await this.prisma.auditLog.findMany({
      where: { targetType: 'report', targetId: id },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        actorId: true,
        action: true,
        metadata: true,
        createdAt: true,
      },
    });
    const notification = await this.prisma.discordNotification.findUnique({
      where: { kind_targetId: { kind: 'REPORT', targetId: id } },
      select: {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        deliveredAt: true,
      },
    });
    return { ...report, history, notification };
  }

  updateStatus(id: string, actorId: string, dto: UpdateReportStatusDto) {
    if (dto.status === dto.expectedStatus)
      throw new BadRequestException('다른 상태로 변경해주세요.');
    if (dto.action !== 'NONE' && dto.status !== 'RESOLVED')
      throw new BadRequestException(
        '대상 숨김은 해결 처리와 함께 사용해주세요.',
      );
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id },
        select: { targetType: true, targetId: true },
      });
      if (!report) throw new NotFoundException('신고를 찾을 수 없습니다.');
      const changed = await tx.report.updateMany({
        where: { id, status: dto.expectedStatus },
        data: {
          status: dto.status,
          adminNote: dto.note,
          completedAt: dto.status === 'REVIEWING' ? null : new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          '다른 관리자가 처리했습니다. 새로고침해주세요.',
        );
      if (dto.action === 'HIDE_OUTFIT') {
        if (report.targetType !== 'OUTFIT')
          throw new BadRequestException('코디 신고에만 사용할 수 있습니다.');
        const hidden = await tx.outfit.updateMany({
          where: { id: report.targetId },
          data: { status: 'REJECTED' },
        });
        if (!hidden.count)
          throw new NotFoundException(
            '대상 코디가 삭제되었습니다. 조치 없이 처리해주세요.',
          );
        await tx.rejectedOutfit.create({
          data: {
            outfitId: report.targetId,
            reviewerId: actorId,
            reason: '운영 정책에 따라 비공개 처리되었습니다.',
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'REJECT',
            targetType: 'outfit',
            targetId: report.targetId,
            metadata: { reportId: id },
          },
        });
      }
      if (dto.action === 'HIDE_PRODUCT') {
        if (report.targetType !== 'PRODUCT')
          throw new BadRequestException('상품 신고에만 사용할 수 있습니다.');
        const hidden = await tx.product.updateMany({
          where: { id: report.targetId },
          data: { isDeleted: true },
        });
        if (!hidden.count)
          throw new NotFoundException(
            '대상 상품이 삭제되었습니다. 조치 없이 처리해주세요.',
          );
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'DELETE',
            targetType: 'product',
            targetId: report.targetId,
            metadata: { reportId: id },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action:
            dto.status === 'RESOLVED'
              ? 'RESOLVE'
              : dto.status === 'REJECTED'
                ? 'REJECT'
                : 'UPDATE',
          targetType: 'report',
          targetId: id,
          metadata: {
            from: dto.expectedStatus,
            to: dto.status,
            note: dto.note,
            action: dto.action,
          },
        },
      });
      return tx.report.findUniqueOrThrow({
        where: { id },
        select: adminSelect,
      });
    });
  }
}

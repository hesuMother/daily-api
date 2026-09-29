import {
  ConflictException,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators';
import type { AuthUserDto } from '../auth/dto/auth-response.dto';
import { PrismaService } from '../database/prisma.service';

@ApiTags('Notification administration')
@ApiBearerAuth('accessToken')
@Roles('ADMIN')
@Controller('admin/notifications')
export class NotificationAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Post(':id/retry')
  @ApiOperation({
    summary: '전송 실패 알림 재시도 (신고·문의 관리자 상세에서 알림 ID 확인)',
  })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUserDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.discordNotification.updateMany({
        where: { id, status: 'FAILED', availableAt: { lte: new Date() } },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          lastError: null,
        },
      });
      if (!changed.count)
        throw new ConflictException('재시도 가능한 실패 알림이 아닙니다.');
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'UPDATE',
          targetType: 'discord_notification',
          targetId: id,
          metadata: { action: 'RETRY' },
        },
      });
      return { id, status: 'PENDING' };
    });
  }
}

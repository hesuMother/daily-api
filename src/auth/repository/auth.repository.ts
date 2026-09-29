import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { UserRegisteredEvent } from '../events/user-registered.event';

const userSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  isVerified: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForLogin(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { ...userSelect, password: true },
    });
  }

  findUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
  }

  register(
    user: { id: string; username: string; email: string; password: string },
    persistSession: () => Promise<void>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const created = await tx.user.create({
          data: user,
          select: userSelect,
        });
        // Redis 저장 실패 시 사용자 생성도 롤백합니다. DB에는 사용자 정보만 저장합니다.
        await persistSession();
        return created;
      },
      { timeout: 10000 },
    );
  }

  async recordRegistration(event: UserRegisteredEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: event.userId,
        action: 'CREATE',
        targetType: 'user',
        targetId: event.userId,
        metadata: {
          event: 'user.registered',
          requestId: event.requestId,
          occurredAt: event.occurredAt.toISOString(),
        },
      },
    });
  }
}

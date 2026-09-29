import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { AppSettings } from '../config/environment';
import type { DiscordSettings } from '../config/discord.config';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { DiscordClient } from './discord.client';

@Injectable()
export class DiscordWorker implements OnModuleDestroy {
  private readonly settings: DiscordSettings;
  private readonly logger = new Logger(DiscordWorker.name);
  private readonly shutdown = new AbortController();
  private running?: Promise<void>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly client: DiscordClient,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').discord;
  }

  @Interval(15000)
  async tick(): Promise<void> {
    if (!this.settings.enabled || this.shutdown.signal.aborted) return;
    if (this.running) return this.running;
    this.running = this.deliverBatch()
      .catch(() => {
        // URLs and arbitrary exception messages can contain webhook credentials.
        this.logger.error(
          'Discord notification batch failed; pending jobs will be retried.',
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async deliverBatch(): Promise<void> {
    for (let index = 0; index < 10 && !this.shutdown.signal.aborted; index++) {
      const now = new Date();
      const blocked = await this.prisma.discordNotification.findMany({
        where: { lastError: 'HTTP_429', availableAt: { gt: now } },
        distinct: ['kind'],
        select: { kind: true },
      });
      const eligible: Prisma.DiscordNotificationWhereInput = {
        // Also respect Discord global limits and configurations sharing one webhook.
        kind: { notIn: blocked.length ? ['REPORT', 'CONTACT'] : [] },
        OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', lockedUntil: { lte: now } },
        ],
      };
      const job = await this.prisma.discordNotification.findFirst({
        where: eligible,
        orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      });
      if (!job) return;
      const lockToken = randomUUID();
      const claim = await this.prisma.discordNotification.updateMany({
        where: { id: job.id, ...eligible },
        data: {
          status: 'PROCESSING',
          lockToken,
          lockedUntil: new Date(Date.now() + 30000),
          attempts: { increment: 1 },
        },
      });
      if (!claim.count) continue;
      const ownership = {
        id: job.id,
        status: 'PROCESSING' as const,
        lockToken,
      };
      if (job.attempts >= 5) {
        await this.prisma.discordNotification.updateMany({
          where: ownership,
          data: {
            status: 'FAILED',
            lockedUntil: null,
            lockToken: null,
            lastError: 'ATTEMPTS_EXHAUSTED',
          },
        });
        continue;
      }
      const webhook =
        job.kind === 'REPORT'
          ? this.settings.reportWebhookUrl
          : this.settings.contactWebhookUrl;
      // Deliberately omit names, email addresses and user-entered text from external alerts.
      const content = `${job.kind === 'REPORT' ? '새 신고' : '새 문의'}가 접수되었습니다.\n접수 ID: ${job.targetId}\n관리자 페이지에서 내용을 확인해주세요.`;
      const result = await this.client.send(
        webhook,
        content,
        this.shutdown.signal,
      );
      const retry = result.status === 'retry' && job.attempts + 1 < 5;
      const delay =
        result.status === 'retry'
          ? (result.delayMs ?? Math.min(300000, 15000 * 2 ** job.attempts))
          : 0;
      await this.prisma.discordNotification.updateMany({
        where: ownership,
        data: {
          status:
            result.status === 'sent' ? 'SENT' : retry ? 'PENDING' : 'FAILED',
          deliveredAt: result.status === 'sent' ? new Date() : null,
          lastError: result.status === 'sent' ? null : result.error,
          availableAt: new Date(Date.now() + delay),
          lockedUntil: null,
          lockToken: null,
        },
      });
      if (result.status === 'retry' && result.error === 'HTTP_429') return;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort();
    await this.running;
  }
}

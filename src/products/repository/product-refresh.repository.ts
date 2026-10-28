import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export const REFRESH_LEASE_MS = 90000;
export interface RefreshClaim {
  id: string;
  token: string;
}

@Injectable()
export class ProductRefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(
    providerIds: string[],
    intervalMs: number,
    now: Date,
  ): Promise<RefreshClaim | null> {
    const eligible: Prisma.ProductOfferWhereInput = {
      productUrl: { not: null },
      product: { isDeleted: false },
      seller: { slug: { in: providerIds } },
      AND: [
        {
          OR: [
            { lastCrawledAt: null },
            { lastCrawledAt: { lte: new Date(now.getTime() - intervalMs) } },
          ],
        },
        { OR: [{ nextRefreshAt: null }, { nextRefreshAt: { lte: now } }] },
        {
          OR: [
            { refreshLockedUntil: null },
            { refreshLockedUntil: { lte: now } },
          ],
        },
      ],
    };
    // A competing worker may claim the selected row first. Re-read a few times.
    for (let attempt = 0; attempt < 3; attempt++) {
      const offer = await this.prisma.productOffer.findFirst({
        where: eligible,
        orderBy: [
          { lastCrawledAt: { sort: 'asc', nulls: 'first' } },
          { id: 'asc' },
        ],
        select: { id: true },
      });
      if (!offer) return null;
      const token = randomUUID();
      const claimed = await this.prisma.productOffer.updateMany({
        where: { id: offer.id, ...eligible },
        data: {
          refreshLockToken: token,
          refreshLockedUntil: new Date(now.getTime() + REFRESH_LEASE_MS),
          lastRefreshAttemptAt: now,
        },
      });
      if (claimed.count) return { id: offer.id, token };
    }
    return null;
  }

  async renew(claim: RefreshClaim): Promise<boolean> {
    const changed = await this.prisma.productOffer.updateMany({
      where: {
        id: claim.id,
        refreshLockToken: claim.token,
        refreshLockedUntil: { gt: new Date() },
      },
      data: { refreshLockedUntil: new Date(Date.now() + REFRESH_LEASE_MS) },
    });
    return changed.count === 1;
  }

  async finish(
    claim: RefreshClaim,
    delayMs: number,
    error: string | null,
  ): Promise<void> {
    await this.prisma.productOffer.updateMany({
      where: { id: claim.id, refreshLockToken: claim.token },
      data: {
        nextRefreshAt: new Date(Date.now() + delayMs),
        lastRefreshError: error,
        refreshLockToken: null,
        refreshLockedUntil: null,
      },
    });
  }
}

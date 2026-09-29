import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  CREATE_SESSION,
  DISCARD_SESSION,
  REVOKE_SESSION,
  ROTATE_SESSION,
} from './session.scripts';

export interface DeviceSession {
  userId: string;
  deviceId: string;
  sessionId: string;
  tokenId: string;
  expiresAt: Date;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly redis: RedisService) {}

  sessionKey(userId: string, deviceId: string): string {
    return this.redis.keyPrefix + ':session:{' + userId + '}:' + deviceId;
  }

  tokenKey(userId: string, tokenId: string): string {
    return this.redis.keyPrefix + ':token:{' + userId + '}:' + tokenId;
  }

  async create(session: DeviceSession): Promise<void> {
    const result = await this.redis.execute((client) =>
      client.eval(
        CREATE_SESSION,
        2,
        this.sessionKey(session.userId, session.deviceId),
        this.tokenKey(session.userId, session.tokenId),
        session.sessionId,
        session.tokenId,
        session.deviceId,
        session.expiresAt.getTime(),
      ),
    );
    if (result !== 1)
      throw new UnauthorizedException('인증 세션을 생성할 수 없습니다.');
  }

  async findActive(
    userId: string,
    deviceId: string,
    sessionId: string,
  ): Promise<DeviceSession | null> {
    const stored = await this.redis.execute((client) =>
      client.hgetall(this.sessionKey(userId, deviceId)),
    );
    const expires = Number(stored.exp);
    if (
      stored.sid !== sessionId ||
      !stored.jti ||
      !Number.isSafeInteger(expires) ||
      expires <= Date.now()
    )
      return null;
    return {
      userId,
      deviceId,
      sessionId,
      tokenId: stored.jti,
      expiresAt: new Date(expires),
    };
  }

  async rotate(input: {
    userId: string;
    deviceId: string;
    sessionId: string;
    tokenId: string;
    nextTokenId: string;
  }): Promise<'rotated' | 'invalid' | 'reused'> {
    const result = await this.redis.execute((client) =>
      client.eval(
        ROTATE_SESSION,
        3,
        this.sessionKey(input.userId, input.deviceId),
        this.tokenKey(input.userId, input.tokenId),
        this.tokenKey(input.userId, input.nextTokenId),
        input.sessionId,
        input.tokenId,
        input.deviceId,
        input.nextTokenId,
      ),
    );
    if (result === 1) return 'rotated';
    return result === 2 ? 'reused' : 'invalid';
  }

  async revoke(
    userId: string,
    deviceId: string,
    sessionId: string,
  ): Promise<void> {
    await this.redis.execute((client) =>
      client.eval(
        REVOKE_SESSION,
        1,
        this.sessionKey(userId, deviceId),
        sessionId,
      ),
    );
  }

  async discard(session: DeviceSession): Promise<void> {
    await this.redis.execute((client) =>
      client.eval(
        DISCARD_SESSION,
        2,
        this.sessionKey(session.userId, session.deviceId),
        this.tokenKey(session.userId, session.tokenId),
        session.sessionId,
        session.deviceId,
      ),
    );
  }
}

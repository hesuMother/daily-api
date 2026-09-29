import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { AppSettings } from '../../config/environment';
import type { TokenClaims } from '../auth.types';

@Injectable()
export class TokenService {
  private readonly settings: AppSettings['jwt'];

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').jwt;
  }

  get refreshTtlSeconds(): number {
    return this.settings.refreshTtlSeconds;
  }

  async issue(
    userId: string,
    deviceId: string,
    sessionId: string,
    sessionExpiresAt: Date,
  ) {
    const remaining =
      Math.floor(sessionExpiresAt.getTime() / 1000) -
      Math.floor(Date.now() / 1000);
    if (remaining <= 0)
      throw new UnauthorizedException('인증 정보가 유효하지 않습니다.');
    const expiresIn = Math.min(this.settings.accessTtlSeconds, remaining);
    const refreshId = randomUUID();
    const common = {
      subject: userId,
      issuer: this.settings.issuer,
      audience: this.settings.audience,
      algorithm: 'HS256' as const,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sid: sessionId, did: deviceId, tokenType: 'access' },
        {
          ...common,
          jwtid: randomUUID(),
          secret: this.settings.accessSecret,
          expiresIn,
        },
      ),
      this.jwt.signAsync(
        { sid: sessionId, did: deviceId, tokenType: 'refresh' },
        {
          ...common,
          jwtid: refreshId,
          secret: this.settings.refreshSecret,
          expiresIn: remaining,
        },
      ),
    ]);
    return {
      accessToken,
      refreshToken,
      refreshId,
      expiresIn,
    };
  }

  async verify(
    token: string,
    type: 'access' | 'refresh',
  ): Promise<TokenClaims> {
    try {
      if (token.length > 4096) throw new Error('Oversized token');
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret:
            type === 'access'
              ? this.settings.accessSecret
              : this.settings.refreshSecret,
          algorithms: ['HS256'],
          issuer: this.settings.issuer,
          audience: this.settings.audience,
        },
      );
      if (
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.sid !== 'string' ||
        !isUUID(payload.sid) ||
        typeof payload.did !== 'string' ||
        !isUUID(payload.did, '4') ||
        typeof payload.jti !== 'string' ||
        !isUUID(payload.jti) ||
        payload.tokenType !== type ||
        typeof payload.exp !== 'number' ||
        !Number.isInteger(payload.exp) ||
        typeof payload.iat !== 'number' ||
        !Number.isInteger(payload.iat) ||
        payload.iat > Math.floor(Date.now() / 1000)
      )
        throw new Error('Invalid claims');
      return {
        sub: payload.sub,
        sid: payload.sid,
        did: payload.did,
        jti: payload.jti,
        tokenType: type,
        exp: payload.exp,
        iat: payload.iat,
      };
    } catch {
      throw new UnauthorizedException('인증 정보가 유효하지 않습니다.');
    }
  }
}

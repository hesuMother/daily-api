import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from '../repository/auth.repository';
import {
  SessionRepository,
  type DeviceSession,
} from '../repository/session.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { LoginDto, RegisterDto } from '../dto/auth-request.dto';
import type { AuthResponseDto, AuthUserDto } from '../dto/auth-response.dto';
import type { AuthHttpResult, AuthPrincipal, TokenClaims } from '../auth.types';
import {
  USER_REGISTERED_EVENT,
  UserRegisteredEvent,
} from '../events/user-registered.event';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly events: EventEmitter2,
  ) {}

  async register(
    dto: RegisterDto,
    requestId: string,
  ): Promise<AuthHttpResult<AuthResponseDto>> {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const expiresAt = this.sessionExpiry();
    const [password, pair] = await Promise.all([
      this.passwords.hash(dto.password),
      this.tokens.issue(userId, dto.deviceId, sessionId, expiresAt),
    ]);
    const session: DeviceSession = {
      userId,
      deviceId: dto.deviceId,
      sessionId,
      expiresAt,
      tokenId: pair.refreshId,
    };
    let sessionAttempted = false;
    let user: AuthUserDto;
    try {
      user = await this.repository.register(
        { id: userId, email: dto.email, username: dto.username, password },
        async () => {
          sessionAttempted = true;
          await this.sessions.create(session);
        },
      );
    } catch (error) {
      // DB 커밋 실패/Redis 응답 유실 시 남을 수 있는 새 세션을 보상 정리합니다.
      if (sessionAttempted) {
        try {
          await this.sessions.discard(session);
        } catch {
          this.logger.warn(
            '가입 실패 세션을 정리하지 못했습니다. 만료 시 자동 제거됩니다.',
          );
        }
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('이미 사용 중인 이메일 또는 아이디입니다.');
      }
      throw error;
    }
    await this.events.emitAsync(
      USER_REGISTERED_EVENT,
      new UserRegisteredEvent(user.id, user.createdAt, requestId),
    );
    return this.response(user, dto.deviceId, pair, expiresAt);
  }

  async login(dto: LoginDto): Promise<AuthHttpResult<AuthResponseDto>> {
    const stored = await this.repository.findForLogin(dto.email);
    if (
      !(await this.passwords.verify(stored?.password, dto.password)) ||
      !stored
    ) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    const user: AuthUserDto = {
      id: stored.id,
      username: stored.username,
      email: stored.email,
      role: stored.role,
      isVerified: stored.isVerified,
      createdAt: stored.createdAt,
    };
    const sessionId = randomUUID();
    const expiresAt = this.sessionExpiry();
    const pair = await this.tokens.issue(
      user.id,
      dto.deviceId,
      sessionId,
      expiresAt,
    );
    await this.sessions.create({
      userId: user.id,
      deviceId: dto.deviceId,
      sessionId,
      expiresAt,
      tokenId: pair.refreshId,
    });
    return this.response(user, dto.deviceId, pair, expiresAt);
  }

  async refresh(
    refreshToken: string | undefined,
  ): Promise<AuthHttpResult<AuthResponseDto>> {
    if (!refreshToken) throw this.unauthorized();
    const claims = await this.tokens.verify(refreshToken, 'refresh');
    const session = await this.sessions.findActive(
      claims.sub,
      claims.did,
      claims.sid,
    );
    if (!session) throw this.unauthorized();
    const user = await this.repository.findUser(claims.sub);
    if (!user) {
      await this.sessions.revoke(claims.sub, claims.did, claims.sid);
      throw this.unauthorized();
    }
    const pair = await this.tokens.issue(
      claims.sub,
      claims.did,
      claims.sid,
      session.expiresAt,
    );
    const result = await this.sessions.rotate({
      userId: claims.sub,
      deviceId: claims.did,
      sessionId: claims.sid,
      tokenId: claims.jti,
      nextTokenId: pair.refreshId,
    });
    if (result !== 'rotated') throw this.unauthorized();
    return this.response(user, claims.did, pair, session.expiresAt);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    let claims: TokenClaims;
    try {
      claims = await this.tokens.verify(refreshToken, 'refresh');
    } catch (error) {
      if (error instanceof UnauthorizedException) return;
      throw error;
    }
    // 예전 로그인 토큰으로 같은 기기의 새 로그인 세션을 로그아웃할 수 없습니다.
    await this.sessions.revoke(claims.sub, claims.did, claims.sid);
  }

  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    const claims = await this.tokens.verify(accessToken, 'access');
    const session = await this.sessions.findActive(
      claims.sub,
      claims.did,
      claims.sid,
    );
    if (!session) throw this.unauthorized();
    const user = await this.repository.findUser(claims.sub);
    if (!user) throw this.unauthorized();
    return { user, sessionId: claims.sid, deviceId: claims.did };
  }

  private sessionExpiry(): Date {
    return new Date(
      (Math.floor(Date.now() / 1000) + this.tokens.refreshTtlSeconds) * 1000,
    );
  }

  private response(
    user: AuthUserDto,
    deviceId: string,
    pair: Awaited<ReturnType<TokenService['issue']>>,
    expiresAt: Date,
  ): AuthHttpResult<AuthResponseDto> {
    return {
      body: {
        user,
        deviceId,
        accessToken: pair.accessToken,
        tokenType: 'Bearer',
        expiresIn: pair.expiresIn,
      },
      refreshCookie: { token: pair.refreshToken, expiresAt },
    };
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('인증 정보가 유효하지 않습니다.');
  }
}

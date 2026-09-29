import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppSettings } from '../../config/environment';
import { AUTH_REQUEST_HEADER, type AuthRequest } from '../auth.types';

@Injectable()
export class AuthOriginGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    const settings = config.getOrThrow<AppSettings>('app');
    this.allowedOrigins = new Set([
      settings.apiOrigin,
      ...settings.corsOrigins,
    ]);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (request.method === 'GET' || request.method === 'HEAD') return true;
    // 사용자 지정 헤더는 일반 HTML form을 차단하며 교차 출처 요청은 preflight를 거칩니다.
    if (request.headers[AUTH_REQUEST_HEADER] !== '1') {
      throw new ForbiddenException('X-Auth-Request: 1 헤더가 필요합니다.');
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.has(origin)) {
      throw new ForbiddenException('허용되지 않은 요청 출처입니다.');
    }
    return true;
  }
}

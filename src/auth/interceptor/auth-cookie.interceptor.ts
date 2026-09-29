import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import { catchError, map, type Observable, throwError } from 'rxjs';
import type { AppSettings } from '../../config/environment';
import { REFRESH_COOKIE_NAME, type AuthHttpResult } from '../auth.types';
import { CLEAR_REFRESH_ON_ERROR } from '../decorators/auth.decorators';

@Injectable()
export class AuthCookieInterceptor implements NestInterceptor {
  private readonly cookieOptions: CookieSerializeOptions;

  constructor(
    config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: config.getOrThrow<AppSettings>('app').refreshCookieSameSite,
    };
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler<AuthHttpResult<unknown>>,
  ): Observable<unknown> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    return next.handle().pipe(
      map((result) => {
        if (result.refreshCookie) {
          reply.setCookie(REFRESH_COOKIE_NAME, result.refreshCookie.token, {
            ...this.cookieOptions,
            expires: result.refreshCookie.expiresAt,
            maxAge: Math.max(
              0,
              Math.floor(
                (result.refreshCookie.expiresAt.getTime() - Date.now()) / 1000,
              ),
            ),
          });
        }
        if (result.clearRefreshCookie)
          reply.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions);
        // 갱신 토큰은 Set-Cookie로만 전달하고 JSON에서 제거합니다.
        return result.body;
      }),
      catchError((error: unknown) => {
        if (
          error instanceof UnauthorizedException &&
          this.reflector.get<boolean>(
            CLEAR_REFRESH_ON_ERROR,
            context.getHandler(),
          )
        ) {
          reply.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions);
        }
        return throwError(() => error);
      }),
    );
  }
}

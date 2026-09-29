import type { FastifyRequest } from 'fastify';
import type { AuthUserDto } from './dto/auth-response.dto';
import type { RequestWithId } from '../common/middleware/request-id.middleware';

export interface TokenClaims {
  sub: string;
  sid: string;
  did: string;
  jti: string;
  tokenType: 'access' | 'refresh';
  exp: number;
  iat: number;
}

export interface AuthPrincipal {
  user: AuthUserDto;
  sessionId: string;
  deviceId: string;
}

export interface AuthRequest extends FastifyRequest {
  auth?: AuthPrincipal;
  raw: RequestWithId;
}

export interface AuthHttpResult<T> {
  body: T;
  refreshCookie?: { token: string; expiresAt: Date };
  clearRefreshCookie?: boolean;
}

export const REFRESH_COOKIE_NAME = '__Host-refresh_token';
export const AUTH_REQUEST_HEADER = 'x-auth-request';

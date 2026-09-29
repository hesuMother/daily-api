import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/client';
import type { AuthRequest } from '../auth.types';
import type { AuthUserDto } from '../dto/auth-response.dto';

export const IS_PUBLIC = 'auth:public';
export const OPTIONAL_AUTH = 'auth:optional';
export const REQUIRED_ROLES = 'auth:roles';
export const CLEAR_REFRESH_ON_ERROR = 'auth:clear-refresh-on-error';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
export const ClearRefreshOnError = () =>
  SetMetadata(CLEAR_REFRESH_ON_ERROR, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUserDto => {
    const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
    if (!auth) throw new UnauthorizedException('인증이 필요합니다.');
    return auth.user;
  },
);

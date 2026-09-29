import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../generated/prisma/client';
import { REQUIRED_ROLES } from '../decorators/auth.decorators';
import type { AuthRequest } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const principal = context.switchToHttp().getRequest<AuthRequest>().auth;
    if (!principal || !roles.includes(principal.user.role))
      throw new ForbiddenException('접근 권한이 없습니다.');
    return true;
  }
}

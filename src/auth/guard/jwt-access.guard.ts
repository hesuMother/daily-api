import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../decorators/auth.decorators';
import { AuthService } from '../service/auth.service';
import type { AuthRequest } from '../auth.types';

@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (
      !request.headers.authorization &&
      this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match)
      throw new UnauthorizedException('Bearer 액세스 토큰이 필요합니다.');
    request.auth = await this.authService.authenticate(match[1]);
    return true;
  }
}

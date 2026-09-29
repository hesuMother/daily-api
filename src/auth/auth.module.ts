import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { SessionRepository } from './repository/session.repository';
import { AuthController } from './controller/auth.controller';
import { AuthRepository } from './repository/auth.repository';
import { AuthService } from './service/auth.service';
import { PasswordService } from './service/password.service';
import { TokenService } from './service/token.service';
import { JwtAccessGuard } from './guard/jwt-access.guard';
import { RolesGuard } from './guard/roles.guard';
import { AuthOriginGuard } from './guard/auth-origin.guard';
import { AuthCookieInterceptor } from './interceptor/auth-cookie.interceptor';
import { UserRegisteredListener } from './events/user-registered.listener';

@Module({
  imports: [DatabaseModule, RedisModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    SessionRepository,
    AuthService,
    PasswordService,
    TokenService,
    AuthOriginGuard,
    AuthCookieInterceptor,
    UserRegisteredListener,
    { provide: APP_GUARD, useClass: JwtAccessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

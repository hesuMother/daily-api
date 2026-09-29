import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { AuthService } from '../service/auth.service';
import { LoginDto, RegisterDto } from '../dto/auth-request.dto';
import {
  AuthErrorDto,
  AuthResponseDto,
  AuthUserDto,
  LogoutResponseDto,
} from '../dto/auth-response.dto';
import {
  ClearRefreshOnError,
  CurrentUser,
  Public,
} from '../decorators/auth.decorators';
import { AuthOriginGuard } from '../guard/auth-origin.guard';
import { AuthCookieInterceptor } from '../interceptor/auth-cookie.interceptor';
import {
  REFRESH_COOKIE_NAME,
  type AuthHttpResult,
  type AuthRequest,
} from '../auth.types';

@ApiTags('Auth')
@ApiServiceUnavailableResponse({
  type: AuthErrorDto,
  description: 'Redis 인증 저장소 연결 실패. 인증은 허용되지 않습니다.',
})
@ApiBadRequestResponse({
  type: AuthErrorDto,
  description: '요청 DTO 검증 실패',
})
@ApiUnauthorizedResponse({
  type: AuthErrorDto,
  description: '로그인 정보 또는 토큰이 유효하지 않음',
})
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description: '출처/CSRF 헤더 또는 역할 검사 실패',
})
@ApiResponse({
  status: 429,
  type: AuthErrorDto,
  description: '요청 횟수 초과. 잠시 후 다시 요청하세요.',
})
@Controller('auth')
@UseGuards(AuthOriginGuard)
@UseInterceptors(AuthCookieInterceptor)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @RouteConfig({ rateLimit: { max: 5, timeWindow: '1 minute' } })
  @ApiHeader({
    name: 'X-Auth-Request',
    required: true,
    schema: { type: 'string', enum: ['1'], default: '1' },
  })
  @ApiOperation({
    summary: '회원가입 및 로그인',
    description:
      '사용자는 PostgreSQL, 기기 세션과 jti는 Redis에 저장합니다. deviceId는 기기별 고정 UUID v4입니다. userId가 포함된 user.registered 이벤트를 발송합니다. 갱신 토큰은 JSON에 포함하지 않으며 __Host-refresh_token 쿠키(HttpOnly, Secure, Path=/, 기본 SameSite=Lax)로 발급됩니다.',
  })
  @ApiCreatedResponse({
    type: AuthResponseDto,
    headers: {
      'Set-Cookie': {
        description:
          'HttpOnly; Secure 갱신 쿠키. 프론트 fetch credentials: include 필요.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiConflictResponse({
    type: AuthErrorDto,
    description: '중복 이메일 또는 아이디',
  })
  register(
    @Body() dto: RegisterDto,
    @Req() request: AuthRequest,
  ): Promise<AuthHttpResult<AuthResponseDto>> {
    return this.auth.register(dto, request.raw.requestId ?? request.id);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  @ApiHeader({
    name: 'X-Auth-Request',
    required: true,
    schema: { type: 'string', enum: ['1'], default: '1' },
  })
  @ApiOperation({
    summary: '이메일/비밀번호 로그인',
    description:
      'accessToken은 프론트 메모리, refreshToken은 HttpOnly·Secure 쿠키에 저장합니다. Redis에는 토큰 ID와 기기 세션만 저장합니다. 같은 userId/deviceId의 재로그인은 이전 세션을 교체하고 다른 기기의 로그인은 유지합니다.',
  })
  @ApiOkResponse({
    type: AuthResponseDto,
    headers: {
      'Set-Cookie': {
        description: '__Host-refresh_token; HttpOnly; Secure; Path=/',
        schema: { type: 'string' },
      },
    },
  })
  login(@Body() dto: LoginDto): Promise<AuthHttpResult<AuthResponseDto>> {
    return this.auth.login(dto);
  }

  @Public()
  @ClearRefreshOnError()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @ApiCookieAuth('refreshToken')
  @ApiHeader({
    name: 'X-Auth-Request',
    required: true,
    schema: { type: 'string', enum: ['1'], default: '1' },
  })
  @ApiOperation({
    summary: '토큰 갱신(RTR)',
    description:
      '요청 본문은 없습니다. 서명된 JWT의 sub/did/sid/jti를 확인하고 Redis Lua로 토큰 ID를 원자적으로 회전합니다. 이전 토큰 재사용 시 해당 기기 세션을 폐기하고 401을 반환합니다. 다른 기기는 유지합니다. 최초 만료는 연장하지 않으므로 프론트는 갱신 요청을 직렬화해야 합니다.',
  })
  @ApiOkResponse({
    type: AuthResponseDto,
    headers: {
      'Set-Cookie': {
        description: '이전 쿠키를 대체하는 새 HttpOnly·Secure 갱신 쿠키',
        schema: { type: 'string' },
      },
    },
  })
  refresh(
    @Req() request: AuthRequest,
  ): Promise<AuthHttpResult<AuthResponseDto>> {
    return this.auth.refresh(request.cookies[REFRESH_COOKIE_NAME]);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @ApiCookieAuth('refreshToken')
  @ApiHeader({
    name: 'X-Auth-Request',
    required: true,
    schema: { type: 'string', enum: ['1'], default: '1' },
  })
  @ApiOperation({
    summary: '현재 세션 로그아웃',
    description:
      '요청 본문은 없습니다. 현재 세션을 폐기하고 갱신 쿠키를 삭제합니다. 쿠키가 없거나 만료되어도 성공합니다. 프론트 메모리의 accessToken도 삭제하세요.',
  })
  @ApiOkResponse({
    type: LogoutResponseDto,
    headers: {
      'Set-Cookie': {
        description: '갱신 쿠키 삭제: 동일 이름/Path에 과거 Expires 설정',
        schema: { type: 'string' },
      },
    },
  })
  async logout(
    @Req() request: AuthRequest,
  ): Promise<AuthHttpResult<LogoutResponseDto>> {
    await this.auth.logout(request.cookies[REFRESH_COOKIE_NAME]);
    return {
      body: { message: '로그아웃되었습니다.' },
      clearRefreshCookie: true,
    };
  }

  @Get('me')
  @ApiBearerAuth('accessToken')
  @ApiOperation({
    summary: '내 정보 조회',
    description:
      'JWT 서명/만료와 Redis의 현재 기기 세션을 확인합니다. 사용자/역할은 PostgreSQL의 현재 값을 사용하고 비밀번호 해시는 반환하지 않습니다.',
  })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentUser() user: AuthUserDto): AuthHttpResult<AuthUserDto> {
    return { body: user };
  }
}

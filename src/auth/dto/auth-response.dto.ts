import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client';

export class AuthUserDto {
  @ApiProperty({
    format: 'uuid',
    example: 'f8282e2e-6de3-4f25-ae58-fc6baab19518',
  })
  id!: string;

  @ApiProperty({ example: 'daily_user' })
  username!: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email!: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole', example: UserRole.USER })
  role!: UserRole;

  @ApiProperty({
    example: false,
    description: '이메일 인증 여부. 회원가입만으로 true가 되지 않습니다.',
  })
  isVerified!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-08T00:00:00.000Z',
  })
  createdAt!: Date;
}

export class AuthResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'a38141d5-37c3-4d8a-824f-93b9527d9d21',
    description: '현재 로그인 기기 식별자',
  })
  deviceId!: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      '프론트 메모리에만 보관하고 Authorization: Bearer 헤더로 전송합니다.',
  })
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: 900,
    minimum: 1,
    maximum: 3600,
    description: '액세스 토큰 유효 기간(초). 세션 만료가 가까우면 짧아집니다.',
  })
  expiresIn!: number;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class LogoutResponseDto {
  @ApiProperty({ example: '로그아웃되었습니다.' })
  message!: string;
}

export class AuthErrorDto {
  @ApiProperty({ example: 401 })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: '인증 정보가 유효하지 않습니다.',
  })
  message!: string | string[];

  @ApiProperty({ example: 'Unauthorized' })
  error!: string;
}

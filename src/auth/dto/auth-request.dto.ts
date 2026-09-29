import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

function normalize(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class LoginDto {
  @ApiProperty({
    example: 'a38141d5-37c3-4d8a-824f-93b9527d9d21',
    format: 'uuid',
    description:
      '기기/브라우저별 고정 UUID v4. 프론트에서 생성하여 같은 기기의 회원가입/로그인에 재사용합니다. 인증 비밀값은 아닙니다.',
  })
  @Transform(({ value }: { value: unknown }) => normalize(value))
  @IsUUID('4')
  deviceId!: string;

  @ApiProperty({
    example: 'user@example.com',
    format: 'email',
    maxLength: 254,
    description: '가입한 이메일. 앞뒤 공백 제거 후 소문자로 처리합니다.',
  })
  @Transform(({ value }: { value: unknown }) => normalize(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'My-long-password!2026',
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
    description: '12~128자. 공백과 대소문자를 원문 그대로 사용합니다.',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty({
    example: 'daily_user',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-z0-9_]+$',
    description:
      '고유 아이디. 영문 소문자, 숫자, 밑줄만 허용합니다. 대문자는 소문자로 변환합니다.',
  })
  @Transform(({ value }: { value: unknown }) => normalize(value))
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/)
  username!: string;
}

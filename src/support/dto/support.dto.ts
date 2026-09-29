import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ReportStatus, ReportTargetType } from '../../generated/prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class SubmissionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class CreateReportDto extends SubmissionDto {
  @ApiProperty({ enum: ReportTargetType })
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetId!: string;
}

export class CreateContactDto extends SubmissionDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: '문의 기능 이름 (예: 코디 업로드)',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  feature?: string;

  @ApiPropertyOptional({
    enum: ReportTargetType,
    description: 'targetId와 함께 입력',
  })
  @ValidateIf(
    (dto: CreateContactDto) =>
      dto.targetType !== undefined || dto.targetId !== undefined,
  )
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(
    (dto: CreateContactDto) =>
      dto.targetType !== undefined || dto.targetId !== undefined,
  )
  @IsUUID()
  targetId?: string;
}

export class ReportQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}

export class ContactQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'unread', 'read'], default: 'all' })
  @IsIn(['all', 'unread', 'read'])
  view: 'all' | 'unread' | 'read' = 'all';
}

export class UpdateReportStatusDto {
  @ApiProperty({
    enum: ['PENDING', 'REVIEWING'],
    description: '화면에서 조회한 현재 상태. 동시 처리 충돌 방지.',
  })
  @IsIn(['PENDING', 'REVIEWING'])
  expectedStatus!: 'PENDING' | 'REVIEWING';

  @ApiProperty({ enum: ['REVIEWING', 'RESOLVED', 'REJECTED'] })
  @IsIn(['REVIEWING', 'RESOLVED', 'REJECTED'])
  status!: 'REVIEWING' | 'RESOLVED' | 'REJECTED';

  @ApiProperty({
    maxLength: 2000,
    description: '관리자 내부 처리 기록. 신고자에게 공개하지 않음.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;

  @ApiPropertyOptional({
    enum: ['NONE', 'HIDE_OUTFIT', 'HIDE_PRODUCT'],
    default: 'NONE',
    description: 'RESOLVED 처리 시 해당 종류의 대상만 숨김',
  })
  @IsIn(['NONE', 'HIDE_OUTFIT', 'HIDE_PRODUCT'])
  action: 'NONE' | 'HIDE_OUTFIT' | 'HIDE_PRODUCT' = 'NONE';
}

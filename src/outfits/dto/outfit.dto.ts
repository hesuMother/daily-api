import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OutfitItemType } from '../../generated/prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';
export { PageQueryDto } from '../../common/dto/page-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OutfitItemDto {
  @ApiProperty({ enum: OutfitItemType })
  @IsEnum(OutfitItemType)
  type!: OutfitItemType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '카탈로그에서 선택한 상품. 생략 시 name 필수.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '선택 상품에 속한 판매 정보',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  offerId?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: '직접 입력 아이템의 이름',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(2048)
  link?: string;
}

export class CreateOutfitDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ minimum: 50, maximum: 250, description: '키(cm), 정수' })
  @IsInt()
  @Min(50)
  @Max(250)
  height!: number;

  @ApiProperty({ minimum: 10, maximum: 400, description: '몸무게(kg), 정수' })
  @IsInt()
  @Min(10)
  @Max(400)
  weight!: number;

  @ApiProperty({ type: [OutfitItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OutfitItemDto)
  items!: OutfitItemDto[];
}

export class ProductPickerQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'history', 'bookmarks'],
    default: 'all',
  })
  @IsIn(['all', 'history', 'bookmarks'])
  source: 'all' | 'history' | 'bookmarks' = 'all';

  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ReviewOutfitDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: '반려 시 필수', maxLength: 1000 })
  @ValidateIf(
    (dto: ReviewOutfitDto) =>
      dto.status === 'REJECTED' || dto.reason !== undefined,
  )
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Roles } from '../auth/decorators/auth.decorators';
import { ProductDiscoveryService } from './discovery/product-discovery.service';
import { ProductService } from './product.service';

export class ProductSearchDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  keyword!: string;
}
export class ProductRefreshDto {
  @ApiProperty({ description: '등록된 Provider가 허용하는 상품 URL' })
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
    disallow_auth: true,
  })
  @MaxLength(2048)
  url!: string;
}
export class ProductDiscoverDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: '방문할 상품 페이지 수 (CRAWLER_MAX_PAGES 이하로 제한)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('Product collection')
@ApiBearerAuth('accessToken')
@Roles('ADMIN')
@Controller('admin/products')
export class ProductAdminController {
  constructor(
    private readonly products: ProductService,
    private readonly discovery: ProductDiscoveryService,
  ) {}
  @Get('providers') providers() {
    return this.products.listProviders();
  }
  @RouteConfig({ rateLimit: { max: 3, timeWindow: '1 minute' } })
  @Post('providers/:provider/search')
  search(@Param('provider') provider: string, @Body() dto: ProductSearchDto) {
    return this.products.search(provider, dto.keyword);
  }
  @RouteConfig({ rateLimit: { max: 3, timeWindow: '1 minute' } })
  @Post('providers/:provider/discover')
  discover(
    @Param('provider') provider: string,
    @Body() dto: ProductDiscoverDto,
  ) {
    return this.discovery.discover(provider, dto.limit);
  }
  @RouteConfig({ rateLimit: { max: 3, timeWindow: '1 minute' } })
  @Post('providers/:provider/refresh')
  refresh(@Param('provider') provider: string, @Body() dto: ProductRefreshDto) {
    return this.products.refresh(provider, dto.url);
  }
  @RouteConfig({ rateLimit: { max: 3, timeWindow: '1 minute' } })
  @Post('offers/:id/refresh')
  refreshOffer(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.refreshOffer(id);
  }
}

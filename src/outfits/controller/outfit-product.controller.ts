import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CurrentUser } from '../../auth/decorators/auth.decorators';
import type { AuthUserDto } from '../../auth/dto/auth-response.dto';
import { ProductPickerQueryDto } from '../dto/outfit.dto';
import { OutfitProductRepository } from '../repository/outfit-product.repository';

@ApiTags('Outfit products')
@ApiBearerAuth('accessToken')
@Controller('outfits/products')
export class OutfitProductController {
  constructor(private readonly products: OutfitProductRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '전체 상품 검색 또는 내 조회 이력·북마크에서 선택' })
  search(
    @CurrentUser() user: AuthUserDto,
    @Query() query: ProductPickerQueryDto,
  ) {
    return this.products.search(user.id, query);
  }

  @Post(':id/view')
  @HttpCode(204)
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @ApiOperation({ summary: '상품 상세를 봤을 때 조회 기록 저장' })
  view(
    @CurrentUser() user: AuthUserDto,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.recordView(user.id, id);
  }

  @Post(':id/bookmark')
  @ApiOperation({ summary: '상품 찜하기 (중복 생성 방지)' })
  bookmark(
    @CurrentUser() user: AuthUserDto,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.bookmark(user.id, id);
  }

  @Delete(':id/bookmark')
  @HttpCode(204)
  @ApiOperation({ summary: '내 상품 찜 해제' })
  unbookmark(
    @CurrentUser() user: AuthUserDto,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.unbookmark(user.id, id);
  }
}

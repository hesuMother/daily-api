import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators';
import type { AuthUserDto } from '../../auth/dto/auth-response.dto';
import { PageQueryDto, ReviewOutfitDto } from '../dto/outfit.dto';
import { OutfitService } from '../service/outfit.service';

@ApiTags('Outfit moderation')
@ApiBearerAuth('accessToken')
@Roles('ADMIN')
@Controller('admin/outfits')
export class OutfitAdminController {
  constructor(private readonly outfits: OutfitService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '대표/관리자의 대기 코디 검수 목록' })
  pending(@Query() query: PageQueryDto) {
    return this.outfits.list(query, 'pending');
  }

  @Post(':id/review')
  @ApiOperation({ summary: '대기 코디 승인 또는 반려 (반려 사유 필수)' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUserDto,
    @Body() data: ReviewOutfitDto,
  ) {
    return this.outfits.review(id, user.id, data);
  }
}

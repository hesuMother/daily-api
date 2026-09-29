import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/auth.decorators';
import type { AuthUserDto } from '../auth/dto/auth-response.dto';
import { ReportService } from './report.service';
import { CreateReportDto, ReportQueryDto } from './dto/support.dto';
import { SupportPrivacyInterceptor } from './support-privacy.interceptor';

@ApiTags('Reports')
@ApiBearerAuth('accessToken')
@UseInterceptors(SupportPrivacyInterceptor)
@Controller('reports')
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Get('categories')
  @ApiOperation({ summary: '접수 분류 목록' })
  categories() {
    return this.service.categories();
  }

  @Post()
  @RouteConfig({ rateLimit: { max: 5, timeWindow: '1 minute' } })
  @ApiOperation({ summary: '신고 접수 및 디스코드 알림 예약' })
  create(@CurrentUser() user: AuthUserDto, @Body() dto: CreateReportDto) {
    return this.service.create(user, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: '내 접수 목록' })
  mine(@CurrentUser() user: AuthUserDto, @Query() query: ReportQueryDto) {
    return this.service.list(query, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '내 접수 상세' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUserDto,
  ) {
    return this.service.detail(id, user.id);
  }
}

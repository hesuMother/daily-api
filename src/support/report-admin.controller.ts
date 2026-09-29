import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators';
import type { AuthUserDto } from '../auth/dto/auth-response.dto';
import { ReportService } from './report.service';
import { ReportQueryDto, UpdateReportStatusDto } from './dto/support.dto';
import { SupportPrivacyInterceptor } from './support-privacy.interceptor';

@ApiTags('Report administration')
@ApiBearerAuth('accessToken')
@Roles('ADMIN')
@UseInterceptors(SupportPrivacyInterceptor)
@Controller('admin/reports')
export class ReportAdminController {
  constructor(private readonly service: ReportService) {}

  @Get()
  @ApiOperation({ summary: '관리자 접수 목록' })
  list(@Query() query: ReportQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '관리자 접수 상세 및 알림 상태' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '신고 처리 및 선택적 대상 숨김' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUserDto,
    @Body() dto: UpdateReportStatusDto,
  ) {
    return this.service.updateStatus(id, user.id, dto);
  }
}

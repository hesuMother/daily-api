import {
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
import { ContactService } from './contact.service';
import { ContactQueryDto } from './dto/support.dto';
import { SupportPrivacyInterceptor } from './support-privacy.interceptor';

@ApiTags('Contact administration')
@ApiBearerAuth('accessToken')
@Roles('ADMIN')
@UseInterceptors(SupportPrivacyInterceptor)
@Controller('admin/contacts')
export class ContactAdminController {
  constructor(private readonly service: ContactService) {}

  @Get()
  @ApiOperation({ summary: '관리자 접수 목록' })
  list(@Query() query: ContactQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '관리자 접수 상세 및 알림 상태' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '문의 읽음 처리 (이메일 회신은 별도)' })
  read(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUserDto,
  ) {
    return this.service.markRead(id, user.id);
  }
}

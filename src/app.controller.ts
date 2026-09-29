import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './auth/decorators/auth.decorators';

@ApiTags('Health')
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '프로세스 생존 확인' })
  liveness() {
    return this.appService.liveness();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'PostgreSQL·Redis 연결 및 요청 수신 준비 확인' })
  @ApiServiceUnavailableResponse({ description: '의존성 장애 또는 종료 중' })
  readiness() {
    return this.appService.readiness();
  }
}

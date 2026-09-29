import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReportController } from './report.controller';
import { ReportAdminController } from './report-admin.controller';
import { ContactController } from './contact.controller';
import { ContactAdminController } from './contact-admin.controller';
import { ReportService } from './report.service';
import { ContactService } from './contact.service';
import { SupportTargetService } from './support-target.service';
import { SupportPrivacyInterceptor } from './support-privacy.interceptor';

@Module({
  imports: [DatabaseModule],
  controllers: [
    ReportController,
    ReportAdminController,
    ContactController,
    ContactAdminController,
  ],
  providers: [
    ReportService,
    ContactService,
    SupportTargetService,
    SupportPrivacyInterceptor,
  ],
})
export class SupportModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DiscordClient } from './discord.client';
import { DiscordWorker } from './discord.worker';
import { NotificationAdminController } from './notification-admin.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationAdminController],
  providers: [DiscordClient, DiscordWorker],
})
export class NotificationsModule {}

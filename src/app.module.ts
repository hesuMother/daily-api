import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ProductsModule } from './products/products.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { OutfitsModule } from './outfits/outfits.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SupportModule } from './support/support.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    AppConfigModule,
    EventEmitterModule.forRoot(),
    AuthModule,
    ProductsModule,
    DatabaseModule,
    RedisModule,
    OutfitsModule,
    ScheduleModule.forRoot(),
    SupportModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

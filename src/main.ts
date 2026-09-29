import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AppConfigModule } from './config/app-config.module';
import type { AppSettings } from './config/environment';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  // 어댑터 생성 전에도 Nest DI를 통해 검증된 환경설정을 읽습니다.
  const context = await NestFactory.createApplicationContext(AppConfigModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  const settings = context.get(ConfigService).getOrThrow<AppSettings>('app');
  await context.close();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: settings.trustProxy,
      bodyLimit: 1024 * 1024,
    }),
    { logger: ['log', 'error', 'warn'], abortOnError: false },
  );
  try {
    await configureApp(app);
    app.enableShutdownHooks();
    await app.listen(settings.port, '0.0.0.0');
  } catch (error) {
    await app.close();
    throw error;
  }
  const logger = new Logger('Bootstrap');
  logger.log('API: ' + settings.apiOrigin);
  logger.log('Swagger: ' + settings.apiOrigin + '/docs');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exitCode = 1;
});

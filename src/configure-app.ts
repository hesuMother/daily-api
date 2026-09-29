import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { AppSettings } from './config/environment';
import { REFRESH_COOKIE_NAME } from './auth/auth.types';

export async function configureApp(app: NestFastifyApplication) {
  const settings = app.get(ConfigService).getOrThrow<AppSettings>('app');
  await app.register(helmet, {
    contentSecurityPolicy: settings.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: [
              "'self'",
              ...new Set(
                settings.swaggerServers.map(
                  (server) => new URL(server.url).origin,
                ),
              ),
            ],
            upgradeInsecureRequests: [],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  app.enableCors({
    origin: settings.corsOrigins.length > 0 ? settings.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Request'],
    exposedHeaders: ['X-Request-Id'],
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 1,
      parts: 2,
      fileSize: 8 * 1024 * 1024,
      fieldSize: 32768,
    },
  });
  await app.register(compress);
  await app.register(rateLimit, { global: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  const builder = new DocumentBuilder()
    .setTitle('Daily API')
    .setDescription(
      '인증: accessToken은 메모리/Bearer, refreshToken은 HttpOnly·Secure 쿠키. 인증 POST 요청은 X-Auth-Request: 1 및 credentials: include가 필요합니다.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'accessToken',
    )
    .addCookieAuth(
      REFRESH_COOKIE_NAME,
      { type: 'apiKey', in: 'cookie' },
      'refreshToken',
    );
  for (const server of settings.swaggerServers)
    builder.addServer(server.url, server.description);
  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Daily API 문서',
    swaggerOptions: {
      withCredentials: true,
      persistAuthorization: false,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      validatorUrl: null,
    },
  });
  return document;
}

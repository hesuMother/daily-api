import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI에는 Nest DI 컨테이너가 없으므로 ConfigService를 직접 생성합니다.
const config = new ConfigService();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: config.getOrThrow<string>('DATABASE_URL'),
  },
});

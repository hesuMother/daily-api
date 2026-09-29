require('dotenv/config');
const { randomBytes } = require('node:crypto');

// 테스트에서만 사용하는 키. 실제 .env 파일은 수정하지 않습니다.
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('base64url');
process.env.NODE_ENV = 'test';
process.env.API_ORIGIN = 'https://api.example.test';
process.env.CORS_ORIGINS = 'https://web.example.test';
process.env.USE_REVERSE_PROXY = 'false';
process.env.JWT_ACCESS_TTL_SECONDS = '900';
process.env.JWT_REFRESH_TTL_SECONDS = '604800';
process.env.REFRESH_COOKIE_SAME_SITE = 'lax';
process.env.COUPANG_SYNC_ENABLED = 'false';
process.env.DISCORD_NOTIFICATIONS_ENABLED = 'false';

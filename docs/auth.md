# 인증 API

NestJS 12 / Fastify 5 / PostgreSQL / Prisma 7 및 Redis 기반 인증입니다. 사용자와 감사 로그는 PostgreSQL, 기기별 인증 세션은 Redis에 저장합니다. 서버 환경설정은 ConfigService를 통해 읽습니다.

## 실행

명령은 daily_api 폴더에서 실행합니다.

```sh
npm install
npm run prisma:generate
npm run db:migrate
npm run start:dev
```

`.env.example`을 참고해 `.env`를 설정합니다. JWT_ACCESS_SECRET과 JWT_REFRESH_SECRET에는 서로 다른 32바이트 이상의 난수를 사용합니다. 개발용 키 생성 예:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

개발과 운영은 서로 다른 키를 사용하며 운영 키는 운영 환경에 따로 설정해야 합니다.

| 환경변수                            | 의미 / 기본값                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| DATABASE_URL                        | 필수 PostgreSQL 연결 문자열. 선택한 schema도 적용됩니다.                                         |
| REDIS_URL / REDIS_KEY_PREFIX         | 필수 Redis 연결 문자열 / 인증 키 네임스페이스(기본 daily:auth) |
| JWT_ACCESS_SECRET                   | 필수 액세스 JWT 서명키                                                                           |
| JWT_REFRESH_SECRET                  | 필수 갱신 JWT 서명키. 액세스 키와 달라야 합니다.                                                 |
| JWT_ACCESS_TTL_SECONDS              | 기본 900초, 1~3600초                                                                             |
| JWT_REFRESH_TTL_SECONDS             | 기본 604800초(7일), 최대 2592000초(30일). 액세스 TTL보다 커야 합니다.                            |
| JWT_ISSUER / JWT_AUDIENCE           | 기본 daily-api / daily-web. 발급과 검증 양쪽에 적용됩니다.                                       |
| API_ORIGIN                          | 기본 http://localhost:3000(PORT 반영). 운영에서는 명시적인 HTTPS Origin이 필요합니다.            |
| CORS_ORIGINS                        | 허용할 프론트 Origin을 쉼표로 구분. 기본값은 빈 목록입니다. 와일드카드/경로를 허용하지 않습니다. |
| REFRESH_COOKIE_SAME_SITE            | 기본 lax. strict 또는 none도 가능하며 Secure는 항상 true입니다.                                  |
| USE_REVERSE_PROXY / TRUSTED_PROXIES | 프록시 사용 여부 및 신뢰할 프록시 IP/CIDR 목록                                                   |

서버는 HTTPS 프록시 뒤에서도 실행할 수 있습니다. 이때 API_ORIGIN을 실제 HTTPS 주소로 설정하고 프록시 IP를 명시합니다. 다른 사이트의 프론트에서 쿠키를 사용하려면 SameSite=none과 정확한 CORS_ORIGINS가 필요하며 브라우저의 제3자 쿠키 정책도 적용됩니다.

## 엔드포인트

Swagger: `/docs`, OpenAPI JSON: `/docs-json`

| 메서드 / 경로          | 요청                                   | 성공 응답                              |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| POST /v1/auth/register | RegisterDto: username, email, password, deviceId | 201 AuthResponseDto + 갱신 쿠키        |
| POST /v1/auth/login    | LoginDto: email, password, deviceId              | 200 AuthResponseDto + 갱신 쿠키        |
| POST /v1/auth/refresh  | 본문 없음. 갱신 쿠키 필요              | 200 AuthResponseDto + 회전된 갱신 쿠키 |
| POST /v1/auth/logout   | 본문 없음. 현재 갱신 쿠키              | 200 LogoutResponseDto + 쿠키 삭제      |
| GET /v1/auth/me        | Authorization: Bearer 액세스 토큰      | 200 AuthUserDto                        |

모든 인증 POST에는 `X-Auth-Request: 1` 헤더가 필요합니다. 브라우저 Origin은 API_ORIGIN 또는 CORS_ORIGINS에 있어야 합니다. Origin을 보내지 않는 CLI 클라이언트도 사용자 지정 헤더는 보내야 합니다.

회원가입의 username은 3~30자의 영문 소문자/숫자/밑줄입니다. 이메일은 최대 254자이고 이메일과 username은 앞뒤 공백을 제거하고 소문자로 변환합니다. 비밀번호는 12~128자이며 원문을 보존합니다. DTO 밖의 role, isVerified 등은 400으로 거절됩니다.

성공 응답 예:

```json
{
  "accessToken": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "deviceId": "a38141d5-37c3-4d8a-824f-93b9527d9d21",
  "user": {
    "id": "f8282e2e-6de3-4f25-ae58-fc6baab19518",
    "username": "daily_user",
    "email": "user@example.com",
    "role": "USER",
    "isVerified": false,
    "createdAt": "2026-09-08T00:00:00.000Z"
  }
}
```

비밀번호/해시/갱신 토큰은 JSON에 포함되지 않습니다. 검증 실패 400, 인증 실패 401, 출처/권한 실패 403, 중복 가입 409, 요청 제한 429 응답도 DTO로 문서화했습니다.

## 프론트 연동

```ts
const API = 'https://api.example.com';
let accessToken: string | null = null;
// 기기 식별자만 저장합니다. 인증 토큰이나 비밀값이 아닙니다.
const deviceId = localStorage.getItem('deviceId') ?? crypto.randomUUID();
localStorage.setItem('deviceId', deviceId);

async function login(email: string, password: string) {
  const response = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Request': '1' },
    body: JSON.stringify({ email, password, deviceId }),
  });
  if (!response.ok) throw new Error('로그인 실패');
  const body = await response.json();
  accessToken = body.accessToken;
  return body.user;
}

// 같은 탭의 동시 요청이 하나의 갱신 Promise를 공유하게 합니다.
let refreshInFlight: Promise<string> | undefined;
function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= (async () => {
    const response = await fetch(`${API}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Auth-Request': '1' },
    });
    if (!response.ok) {
      accessToken = null;
      throw new Error('다시 로그인해야 합니다.');
    }
    const body = await response.json();
    accessToken = body.accessToken;
    return body.accessToken as string;
  })().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}
```

페이지 새로고침 후에는 쿠키로 갱신하여 메모리의 액세스 토큰을 복원합니다. localStorage/sessionStorage에는 토큰을 보관하지 않습니다. 보호 API에는 `Authorization: Bearer <accessToken>`을 전송합니다.

갱신 쿠키 이름은 `__Host-refresh_token`이고 `HttpOnly; Secure; Path=/`가 항상 적용됩니다. Domain을 지정하지 않습니다. 브라우저 JavaScript에서 읽거나 Set-Cookie 헤더를 파싱하지 않습니다. 쿠키 테스트는 HTTPS 환경에서 진행하세요.

로그아웃 API 성공 후 메모리의 accessToken을 삭제합니다. 여러 탭이 같은 쿠키를 공유하면 탭 간 갱신도 Web Locks/BroadcastChannel 등의 방법으로 조정해야 합니다. 이전 토큰으로 재시도하면 세션이 폐기됩니다.

## 토큰 회전과 권한

- 회원가입과 로그인에는 UUID v4 `deviceId`가 필요합니다. 같은 사용자·기기의 재로그인은 이전 세션을 교체하고 다른 기기는 유지합니다.
- Redis에는 세션 ID, 현재 jti, 절대 만료 시각과 발급한 jti의 기기/세션 연결을 저장합니다. JWT 원문이나 비밀번호는 저장하지 않습니다.
- 회전·재사용 감지·폐기는 같은 사용자 해시 슬롯의 Redis Lua 스크립트에서 원자적으로 처리합니다.
- 사용된 토큰이 재전송되면 해당 세션을 폐기하고 401을 반환합니다. 동시 갱신에서도 하나만 성공하고 나머지 재사용 탐지가 세션을 폐기합니다.
- 회전해도 최초 7일의 세션 만료 시각을 연장하지 않습니다. 사용된 토큰 이력은 세션 만료 전까지 보관해야 합니다.
- 로그아웃은 해당 기기의 일치하는 세션만 폐기합니다. 예전 로그인 토큰은 새 세션을 폐기할 수 없습니다. 액세스 가드가 Redis 세션을 확인하므로 기존 액세스 토큰도 즉시 거절됩니다.
- PostgreSQL과 Redis는 하나의 DB 트랜잭션이 아닙니다. 가입 중 Redis 저장 실패 시 DB를 롤백하고, DB 커밋 실패 시 시도한 Redis 세션을 보상 정리합니다.
- 역할은 DB의 현재 값을 확인합니다. 서명 알고리즘 HS256, issuer, audience, 토큰 종류, UUID 식별자, 발급/만료 시각을 검사합니다.

일반 경로는 기본적으로 JwtAccessGuard로 보호됩니다. 공개 경로에는 `@Public()`, 역할 제한에는 `@Roles(UserRole.ADMIN)`, 현재 사용자 주입에는 `@CurrentUser()`를 사용합니다. 보호 API의 Swagger에는 `@ApiBearerAuth("accessToken")`를 추가합니다.

## 파일 구조와 이벤트

```text
src/auth/
  controller/auth.controller.ts
  service/auth.service.ts, password.service.ts, token.service.ts
  repository/auth.repository.ts
  dto/
  guard/           # JWT, 역할, 출처 검사
  interceptor/     # 쿠키 설정/삭제, 응답 토큰 분리, no-store
  decorators/      # Public, Roles, CurrentUser
  events/          # user.registered와 감사 로그 리스너
src/common/middleware/request-id.middleware.ts
src/config/        # ConfigModule와 환경설정 검증
src/database/      # ConfigService 기반 Prisma 연결
```

회원가입 트랜잭션이 커밋되면 `user.registered` 이벤트를 발행합니다. 페이로드는 `{ userId, occurredAt, requestId }`이며 비밀번호나 토큰을 넣지 않습니다. RequestIdMiddleware가 발급한 식별자를 이벤트와 X-Request-Id 응답 헤더에 연결합니다.

UserRegisteredListener는 이벤트를 받아 AuditLog에 사용자 식별자와 요청 식별자를 기록합니다. [Nest EventEmitter](https://docs.nestjs.com/techniques/events)를 사용하는 프로세스 내부 이벤트이며 외부 메시지 브로커 전송이나 장애 시 재전송까지 보장하는 outbox는 포함하지 않습니다.

현재 요청 제한은 프로세스 메모리 기반입니다(가입 5회/분, 로그인 10회/분, 갱신/로그아웃 60회/분, IP 기준). 여러 인스턴스에서 한도를 공유하려면 Redis 저장소를 연결하세요. Redis 세션과 jti 기록은 최초 세션 만료 시각에 TTL로 자동 제거됩니다.

## 검증

```sh
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

E2E는 DATABASE_URL의 PostgreSQL에 고유한 auth_test_<UUID> 스키마를 만들고 Redis에도 고유 prefix를 사용합니다. 종료 시 해당 테스트 스키마와 키만 제거합니다. 기존 사용자 데이터는 사용하지 않습니다. 테스트 계정에는 스키마 생성 권한이 필요합니다.

검증 항목: Argon2 해시, DTO/중복 가입, 사용자 식별 이벤트와 감사 로그, JWT 오류/만료, 회전/재사용/경합, 세션별 로그아웃, 즉시 권한 변경, 쿠키 속성, CSRF/CORS, 요청 제한, Swagger 문서.

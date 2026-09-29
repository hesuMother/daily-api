# 코디 · 신고 · 문의 API

모든 경로에 `/v1` 접두사를 사용합니다. 관리자 화면은 별도 프런트엔드에서 아래 ADMIN API를 연결합니다. 이 저장소는 NestJS 백엔드이며 Swagger는 `/docs`입니다.

## 코디 등록

`POST /v1/outfits`는 로그인한 사용자의 `multipart/form-data` 요청을 받습니다.

- `image`: JPEG/PNG/WebP 사진 1개, 최대 8MiB. 실제 이미지 디코딩 및 픽셀 수 검증 후 WebP로 변환합니다. 최대 2048px, EXIF/GPS 제거.
- `data`: 다음 JSON을 **문자열**로 전달합니다. 이름, 키(cm 정수), 몸무게(kg 정수), 착용 아이템 1~20개가 필수입니다.

```json
{
  "name": "주말 코디",
  "description": "편하게 입은 조합",
  "height": 175,
  "weight": 70,
  "items": [
    { "type": "TOP", "productId": "상품 UUID", "offerId": "해당 상품의 판매 정보 UUID" },
    { "type": "BOTTOM", "name": "소장 청바지", "link": "https://example.com/jeans" }
  ]
}
```

아이템 종류는 `TOP`, `BOTTOM`, `OUTER`, `SHOES`, `BAG`, `ACCESSORY`, `ETC`입니다. 카탈로그 상품은 `productId`와 선택적 `offerId`를 전달하고, 직접 입력은 `name`과 선택적 HTTP(S) `link`를 전달합니다. 두 방식을 한 아이템에 섞을 수 없습니다. 상품명과 판매 링크는 서버에서 조회한 값을 저장합니다. 직접 입력은 해당 코디의 아이템으로 저장되며 공용 상품 카탈로그를 생성하지 않습니다.

```ts
const body = new FormData();
body.append('image', file);
body.append('data', JSON.stringify(data));
await fetch('/v1/outfits', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
  body, // Content-Type은 브라우저가 boundary와 함께 설정합니다.
});
```

| 경로 | 동작 / 권한 |
| --- | --- |
| `GET /outfits` | 승인된 코디 목록, 공개 |
| `GET /outfits/mine` | 로그인 사용자 본인의 모든 상태 |
| `GET /outfits/:id` | 승인 건은 공개. 대기/반려는 작성자와 ADMIN만 |
| `GET /outfits/:id/image` | 상세와 동일한 접근 제한 |
| `GET /outfits/products?source=all&q=셔츠` | 로그인 사용자의 카탈로그 검색 |
| `GET /outfits/products?source=history` | 본인의 조회 기록에서 선택 (`historyId` 포함) |
| `GET /outfits/products?source=bookmarks` | 본인의 찜에서 선택 (`bookmarkId` 포함) |
| `POST /outfits/products/:id/view` | 상품 조회 기록 추가 |
| `POST /outfits/products/:id/bookmark` | 찜 추가/복구, 중복 생성 방지 |
| `DELETE /outfits/products/:id/bookmark` | 본인 찜 해제 |
| `GET /admin/outfits` | ADMIN 대기 검수 목록 |
| `POST /admin/outfits/:id/review` | ADMIN 승인/반려 |

검수 본문은 `{ "status": "APPROVED" }` 또는 `{ "status": "REJECTED", "reason": "반려 사유" }`입니다. 신규 업로드는 항상 `PENDING`이며, 상태와 작성자 ID를 클라이언트에서 지정할 수 없습니다. 중복 검수는 409입니다. `MODERATOR`는 대표/ADMIN 검수 권한이 없습니다.

사진은 `OUTFIT_UPLOAD_DIR`에 저장됩니다. 운영 시 영구 볼륨을 연결하고, 여러 서버는 동일한 저장소를 사용해야 합니다. 이 디렉터리를 정적 공개 경로로 노출하면 검수 전 사진이 유출될 수 있으므로 사진 API를 사용합니다. 비공개 사진은 Bearer 인증으로 fetch 후 Blob URL을 만들어 표시합니다. DB 저장 실패 시 파일을 정리하지만 프로세스 강제 종료 시 남을 수 있는 고아 파일은 별도 운영 정리 대상입니다.

검색은 DB에 수집된 카탈로그를 대상으로 합니다. 외부 쇼핑몰 실시간 검색은 아니며, 쿠팡 수집기의 공식 API 계약 연결은 기존 미완료 사항입니다.

## 신고

`GET /v1/reports/categories`로 분류 ID를 조회한 후 로그인 사용자가 등록합니다.

```json
{
  "categoryId": "신고 분류 UUID",
  "reason": "부적절한 사진",
  "description": "확인이 필요한 내용",
  "targetType": "OUTFIT",
  "targetId": "코디 UUID"
}
```

대상 종류는 `OUTFIT`, `USER`, `PRODUCT`, `PRODUCT_OFFER`, `PRODUCT_HISTORY`, `PRODUCT_BOOKMARK`입니다. 존재 여부와 접근 권한을 검증하며 타인의 비공개 코디, 조회 기록, 찜은 신고 대상으로 조회할 수 없습니다. 접수 상태는 항상 `PENDING`입니다.

| 경로 | 동작 / 권한 |
| --- | --- |
| `POST /reports` | 로그인 사용자 신고 접수 |
| `GET /reports/mine` | 본인의 신고 목록 |
| `GET /reports/:id` | 본인의 신고 상세, 내부 처리 메모 제외 |
| `GET /admin/reports` | ADMIN 전체 목록, `status`, `targetType` 필터 |
| `GET /admin/reports/:id` | ADMIN 상세, 신고자 이메일, 처리 이력, 알림 상태 |
| `PATCH /admin/reports/:id/status` | ADMIN 상태 변경 및 선택적 숨김 조치 |

```json
{
  "expectedStatus": "PENDING",
  "status": "RESOLVED",
  "note": "사진을 확인한 후 비공개 처리",
  "action": "HIDE_OUTFIT"
}
```

상태는 `PENDING → REVIEWING → RESOLVED/REJECTED` 또는 `PENDING → RESOLVED/REJECTED`로 변경합니다. 종료 상태는 다시 변경하지 않습니다. `expectedStatus`가 DB 상태와 다르면 409를 반환하므로 화면을 새로고침해야 합니다. `note`는 관리자 내부 처리 기록으로 필수입니다.

`action` 기본값은 `NONE`입니다. `RESOLVED`에서 `HIDE_OUTFIT`은 해당 코디를 비공개로 변경하고, `HIDE_PRODUCT`는 해당 상품을 검색/선택에서 제외합니다. 다른 대상 종류에는 적용할 수 없습니다. 상태 변경, 조치, 감사 기록은 하나의 트랜잭션으로 처리합니다. 사용자 계정 제재나 판매처 조치는 이 API가 자동 실행하지 않으며, 관리자가 별도로 처리한 뒤 `NONE`과 처리 메모로 종결할 수 있습니다.

## 문의

`GET /v1/contacts/categories`로 분류 ID를 조회한 후 접수합니다.

```json
{
  "categoryId": "문의 분류 UUID",
  "reason": "사진 업로드 문의",
  "description": "업로드 방법을 알려주세요.",
  "feature": "코디 업로드"
}
```

특정 요소 문의는 신고와 같은 `targetType`과 `targetId`를 **함께** 추가할 수 있습니다. 일반 기능 문의는 두 필드를 생략합니다. 회신 이메일은 로그인 계정의 이메일을 사용하며 임의 이메일을 본문으로 지정할 수 없습니다.

| 경로 | 동작 / 권한 |
| --- | --- |
| `POST /contacts` | 로그인 사용자 문의 접수 |
| `GET /contacts/mine` | 본인의 문의 목록 |
| `GET /contacts/:id` | 본인의 문의 상세 |
| `GET /admin/contacts?view=unread` | ADMIN 목록, `all/unread/read` 필터 |
| `GET /admin/contacts/:id` | ADMIN 문의 상세와 계정 이메일, 알림 상태 |
| `PATCH /admin/contacts/:id/read` | ADMIN 읽음 처리, 중복 호출 가능 |

단순 조회는 읽음 처리하지 않습니다. 화면에서 확인 후 read API를 호출하면 `readAt`이 한 번 기록됩니다. 별도 해결 처리 API나 이메일 발송은 없습니다. 관리자가 계정 이메일로 직접 회신합니다. DB의 기존 `ContactStatus`와 `completedAt`은 이전 데이터 호환용으로 보존하며 신규 문의는 `PENDING`, 읽음 확인 후 `IN_PROGRESS`입니다. 사용자 API는 읽음 여부를 기준으로 표시합니다.

목록은 공통 `page=1`, `limit=20`이며 `limit` 최대 50입니다. 응답은 `{ items, page, hasMore }` 형식입니다. 신고/문의 생성은 각각 IP당 분당 5회 제한입니다. 현재 제한은 프로세스 단위이므로 다중 서버 환경에서는 게이트웨이 또는 공유 rate limit이 필요합니다.

## 디스코드 설정과 장애 처리

`.env`와 `.env.example`에 다음 항목을 추가했습니다. 실제 URL을 설정한 뒤 활성화합니다.

```dotenv
DISCORD_NOTIFICATIONS_ENABLED=false
DISCORD_REPORT_WEBHOOK_URL=
DISCORD_CONTACT_WEBHOOK_URL=
OUTFIT_UPLOAD_DIR=.data/outfits
```

활성화 시 신고·문의 웹훅 URL 둘 다 필요합니다. 일반 텍스트 채널에서 생성한 `https://discord.com/api/webhooks/ID/TOKEN` URL을 사용합니다. 웹훅 URL은 비밀값이므로 저장소에 커밋하지 않습니다.

- 접수와 `discord_notifications` 알림 기록은 같은 DB 트랜잭션으로 생성됩니다. 디스코드 장애는 접수 성공을 취소하지 않습니다.
- 워커는 15초마다 최대 10건을 처리합니다. 비활성 상태에서는 대기 기록을 보존하고 전송하지 않습니다. 이후 활성화하면 기존 대기 건도 발송됩니다.
- 알림에는 접수 종류와 ID만 포함합니다. 이메일, 본문, 신고 사유는 외부 채널에 전송하지 않습니다.
- `wait=true`, 멘션 차단, 8초 타임아웃을 적용합니다. 429는 서버가 지정한 재시도 시각까지 대기하고, 네트워크/5xx는 지수 지연으로 최대 5회 시도합니다. 영구 4xx는 실패 처리합니다. 이 동작은 [Discord 웹훅 문서](https://docs.discord.com/developers/resources/webhook)와 [요청 제한 문서](https://docs.discord.com/developers/topics/rate-limits)를 기준으로 구현했습니다.
- DB의 30초 작업 잠금과 고유 토큰으로 여러 워커의 중복 선점을 막고 중단된 작업을 복구합니다. Discord 수신 후 DB 성공 기록 전에 프로세스가 종료되면 같은 알림이 다시 갈 수 있습니다. 외부 전송과 DB 저장의 원자성은 보장하지 않습니다.
- 실패 상태는 관리자 신고/문의 상세의 `notification`으로 확인합니다. URL 오류 등을 고친 후 `POST /v1/admin/notifications/:id/retry`로 재시도할 수 있습니다.
- 테스트는 HTTP를 모의 처리합니다. 실제 채널에 시험 메시지를 발송하지 않았습니다.

## 마이그레이션과 검증

2026-09-18 로컬 개발 DB를 백업 후 마이그레이션 9개까지 적용했습니다. 백업은 `.tmp/daily-before-support-20260918.dump`에 있습니다. 실제 DB와 `schema.prisma` 비교 및 테스트 스키마의 신규 설치 경로를 확인합니다.

최종 검증: 단위 테스트 64개, 실제 PostgreSQL/Redis E2E 38개 통과. 전체 lint, TypeScript 검사, Nest 빌드, Prisma validate 통과. 로컬 DB와 Prisma schema diff는 차이 없음이며 `/health`, `/health/ready`, `/v1/outfits` 실앱 요청은 모두 200을 반환했습니다.

이전 코디의 옷/링크는 `OutfitItem`으로 복사하고 기존 필드도 보존합니다. 작성자가 없던 코디는 작성자를 임의 지정하지 않고 비공개 대기로 유지합니다. URL만 있던 조회/찜은 직접 입력 선택지로 제공하며 상품 FK를 임의로 생성하지 않습니다. 이전 완료 신고/문의는 완료 상태와 시각을 보존하고 과거 기록에 디스코드 알림을 새로 생성하지 않습니다.

기존 `VERIFY` 감사 기록, 카테고리 이름, 평가자, 옵션 재고 원본도 보존합니다. 필요한 컬럼 변경은 삭제/재생성 대신 이름 변경과 값 채우기를 사용했습니다. 별도 DB 배포는 `npm run db:migrate` 후 `npm run prisma:generate`를 실행합니다.

```sh
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npx tsc --noEmit --incremental false
npx eslint "src/**/*.ts" "test/**/*.ts"
npx prisma validate --config prisma7.config.ts
```

# Daily API 명세서 (프런트엔드용)

> 기준: 2026-10-28 백엔드 코드. 요청 검증 규칙과 응답 필드는 소스 코드에서 직접 확인했습니다.
> 서버를 켜면 Swagger UI는 `/docs`, OpenAPI JSON은 `/docs-json`에서 볼 수 있습니다. 이 문서와 다르면 코드가 기준입니다.

## 0. 이 문서 읽는 법 (AI 도구에 넘길 때도 이 절부터)

- 각 API는 `### METHOD /path` 제목 아래에 **권한, 요청, 응답, 오류**를 같은 순서로 적었습니다.
- 타입은 TypeScript로 적었습니다. `?`는 생략 가능, `| null`은 값이 null일 수 있다는 뜻입니다.
- 날짜는 모두 ISO 8601 문자열(`"2026-10-28T05:00:00.000Z"`)이고 ID는 모두 UUID 문자열입니다.
- 공통 타입은 [3절](#3-공통-타입)에 한 번만 정의하고 이후에는 이름으로 참조합니다.

---

## 1. 공통 규칙

### 1.1 주소

| 항목 | 값 |
| --- | --- |
| 로컬 서버 | `http://localhost:3000` |
| 경로 접두사 | 모든 API는 `/v1`로 시작. 예외: 헬스 체크 `/health` |
| 요청 본문 | JSON (`Content-Type: application/json`). 예외: 코디 등록은 `multipart/form-data` |

### 1.2 권한 표기

| 표기 | 의미 |
| --- | --- |
| `공개` | 토큰 없이 호출 |
| `선택` | 토큰 없이도 되지만, 있으면 본인·관리자 전용 데이터까지 보임 |
| `로그인` | `Authorization: Bearer <accessToken>` 필수 |
| `ADMIN` | 로그인 + 역할이 `ADMIN` (`MODERATOR`는 관리자 API 불가) |

### 1.3 인증 흐름 (중요)

- **accessToken**: 로그인/가입/갱신 응답 JSON으로 받습니다. **메모리(변수, 상태)에만** 저장합니다. localStorage·sessionStorage 저장 금지. 유효 기간은 `expiresIn`초(기본 900초=15분).
- **refreshToken**: 서버가 `__Host-refresh_token` 쿠키(HttpOnly, Secure)로 내려줍니다. JS로 읽을 수 없고 읽을 필요도 없습니다. 유효 기간 7일이며 갱신해도 연장되지 않습니다.
- **인증 API 호출 조건**: `/v1/auth/*`의 모든 POST는 아래 두 가지가 필수입니다. 빠지면 403입니다.
  - 헤더 `X-Auth-Request: 1`
  - `fetch(..., { credentials: 'include' })` (쿠키 송수신)
- **deviceId**: 브라우저마다 한 번 `crypto.randomUUID()`로 만들어 localStorage에 저장하고, 가입·로그인에 항상 같은 값을 보냅니다. 비밀값이 아닙니다.
- **새로고침 시**: 메모리의 토큰이 사라지므로 앱 시작 때 `POST /v1/auth/refresh`를 호출해 accessToken을 복원합니다. 401이면 로그아웃 상태로 처리합니다.
- **401을 받으면**: refresh 한 번 → 성공 시 원래 요청 재시도 → 실패 시 로그인 화면.
- **refresh는 동시에 한 번만**: 여러 요청이 동시에 401을 받아도 refresh 요청은 하나만 보내고 결과를 공유해야 합니다. 이미 사용한 refresh 쿠키가 다시 오면 서버가 **그 기기의 세션을 폐기**합니다.
- 브라우저의 프런트 주소(Origin)가 서버 `CORS_ORIGINS` 환경변수에 등록돼 있어야 합니다. 프런트 주소를 백엔드 담당에게 알려주세요.

```ts
const API = 'http://localhost:3000';
let accessToken: string | null = null;
const deviceId = localStorage.getItem('deviceId') ?? crypto.randomUUID();
localStorage.setItem('deviceId', deviceId);

let refreshing: Promise<string> | undefined;
function refresh(): Promise<string> {
  refreshing ??= fetch(`${API}/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Auth-Request': '1' },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('LOGIN_REQUIRED');
      const body = (await res.json()) as AuthResponse;
      accessToken = body.accessToken;
      return body.accessToken;
    })
    .catch((error) => {
      accessToken = null;
      throw error;
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

/** 로그인 API 공통 호출. 401이면 한 번 갱신 후 재시도합니다. */
async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 401 && retry) {
    await refresh();
    return api<T>(path, init, false);
  }
  if (!res.ok) throw (await res.json()) as ApiError;
  return (res.status === 204 ? undefined : await res.json()) as T;
}
```

### 1.4 오류 응답

모든 오류는 같은 모양입니다.

```ts
interface ApiError {
  statusCode: number;          // 400, 401, 403, 404, 409, 429, 503
  message: string | string[];  // 입력 검증 실패(400)는 배열일 수 있음
  error: string;               // "Bad Request" 등
}
```

| 코드 | 의미 | 프런트 처리 |
| --- | --- | --- |
| 400 | 입력 검증 실패. **정의되지 않은 필드를 보내도 400** | `message`를 표시하거나 폼 오류로 매핑 |
| 401 | 토큰 없음/만료/폐기 | refresh 후 재시도, 실패 시 로그인 화면 |
| 403 | 권한 부족, 또는 인증 POST의 `X-Auth-Request` 누락 | 접근 불가 안내 |
| 404 | 대상 없음 또는 볼 권한 없음(비공개 코디 등) | 없음 화면 |
| 409 | 중복 가입, 이미 처리됨, 동시 수정 충돌 | 새로고침 안내 |
| 429 | 요청 횟수 초과 | 잠시 후 재시도 안내 |
| 503 | 서버 의존성(DB/Redis) 장애 | 잠시 후 재시도 안내 |

### 1.5 목록 페이지네이션

목록 API는 모두 쿼리 `page`, `limit`을 받고 같은 모양으로 응답합니다. 전체 개수는 주지 않으므로 "더 보기" 방식으로 구현합니다.

```ts
// 쿼리: page (기본 1, 1~10000), limit (기본 20, 1~50)
interface Page<T> {
  items: T[];
  page: number;
  hasMore: boolean;  // true면 page + 1 요청 가능
}
```

---

## 2. 전체 API 목록

| # | 메서드 | 경로 | 권한 | 설명 |
| --- | --- | --- | --- | --- |
| A1 | POST | `/v1/auth/register` | 공개 | 회원가입 + 로그인 |
| A2 | POST | `/v1/auth/login` | 공개 | 로그인 |
| A3 | POST | `/v1/auth/refresh` | 쿠키 | accessToken 재발급 |
| A4 | POST | `/v1/auth/logout` | 쿠키 | 로그아웃 |
| A5 | GET | `/v1/auth/me` | 로그인 | 내 정보 |
| O1 | POST | `/v1/outfits` | 로그인 | 코디 등록 (사진 업로드, 검수 대기) |
| O2 | GET | `/v1/outfits` | 공개 | 승인된 코디 목록 |
| O3 | GET | `/v1/outfits/mine` | 로그인 | 내 코디 목록 (모든 상태) |
| O4 | GET | `/v1/outfits/:id` | 선택 | 코디 상세 |
| O5 | GET | `/v1/outfits/:id/image` | 선택 | 코디 사진 (WebP 바이너리) |
| P1 | GET | `/v1/outfits/products` | 로그인 | 코디에 넣을 상품 검색 / 조회 기록 / 찜 |
| P2 | POST | `/v1/outfits/products/:id/view` | 로그인 | 상품 조회 기록 저장 |
| P3 | POST | `/v1/outfits/products/:id/bookmark` | 로그인 | 상품 찜 |
| P4 | DELETE | `/v1/outfits/products/:id/bookmark` | 로그인 | 상품 찜 해제 |
| R1 | GET | `/v1/reports/categories` | 로그인 | 신고 분류 목록 |
| R2 | POST | `/v1/reports` | 로그인 | 신고 접수 |
| R3 | GET | `/v1/reports/mine` | 로그인 | 내 신고 목록 |
| R4 | GET | `/v1/reports/:id` | 로그인 | 내 신고 상세 |
| C1 | GET | `/v1/contacts/categories` | 로그인 | 문의 분류 목록 |
| C2 | POST | `/v1/contacts` | 로그인 | 문의 접수 |
| C3 | GET | `/v1/contacts/mine` | 로그인 | 내 문의 목록 |
| C4 | GET | `/v1/contacts/:id` | 로그인 | 내 문의 상세 |
| AD1 | GET | `/v1/admin/outfits` | ADMIN | 검수 대기 코디 목록 |
| AD2 | POST | `/v1/admin/outfits/:id/review` | ADMIN | 코디 승인/반려 |
| AD3 | GET | `/v1/admin/reports` | ADMIN | 전체 신고 목록 |
| AD4 | GET | `/v1/admin/reports/:id` | ADMIN | 신고 상세 + 처리 이력 + 알림 상태 |
| AD5 | PATCH | `/v1/admin/reports/:id/status` | ADMIN | 신고 상태 변경 + 숨김 조치 |
| AD6 | GET | `/v1/admin/contacts` | ADMIN | 전체 문의 목록 |
| AD7 | GET | `/v1/admin/contacts/:id` | ADMIN | 문의 상세 + 알림 상태 |
| AD8 | PATCH | `/v1/admin/contacts/:id/read` | ADMIN | 문의 읽음 처리 |
| AD9 | POST | `/v1/admin/notifications/:id/retry` | ADMIN | 실패한 디스코드 알림 재시도 |
| AD10 | GET | `/v1/admin/products/providers` | ADMIN | 상품 수집처 목록 |
| AD11 | POST | `/v1/admin/products/providers/:provider/discover` | ADMIN | 새 상품 수집 (29CM 의류) |
| AD12 | POST | `/v1/admin/products/providers/:provider/refresh` | ADMIN | 상품 URL 하나 수집 |
| AD13 | POST | `/v1/admin/products/offers/:id/refresh` | ADMIN | 저장된 판매 정보 다시 수집 |
| H1 | GET | `/health` | 공개 | 서버 생존 확인 |
| H2 | GET | `/health/ready` | 공개 | DB·Redis 준비 확인 |

---

## 3. 공통 타입

```ts
type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';
type ModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';      // 코디 검수 상태
type OutfitItemType = 'TOP' | 'BOTTOM' | 'OUTER' | 'SHOES' | 'BAG' | 'ACCESSORY' | 'ETC';
type ReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'REJECTED';
type TargetType =
  | 'OUTFIT' | 'USER' | 'PRODUCT' | 'PRODUCT_OFFER' | 'PRODUCT_HISTORY' | 'PRODUCT_BOOKMARK';

interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isVerified: boolean;   // 이메일 인증 여부. 가입만으로는 false
  createdAt: string;
}

interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;     // 초. 이 시간이 지나면 401
  deviceId: string;
  user: User;
}

interface Outfit {
  id: string;
  authorId: string | null;
  name: string;
  description: string | null;
  height: number;        // cm
  weight: number;        // kg
  imageUrl: string;      // "/v1/outfits/{id}/image" — 상대 경로. API 주소를 앞에 붙여서 사용
  status: ModerationStatus;
  createdAt: string;
  updatedAt: string;
  author: { id: string; username: string; profileImageUrl: string | null } | null;
  items: OutfitItem[];   // sortOrder 오름차순
}

interface OutfitItem {
  id: string;
  type: OutfitItemType;
  name: string;
  link: string | null;       // 구매/참고 링크
  productId: string | null;  // 카탈로그 상품이면 값 있음
  offerId: string | null;
  sortOrder: number;
}

interface ProductSummary {
  id: string;
  name: string;
  images: { imageUrl: string }[];   // 최대 1개 (대표 이미지)
  offers: {                         // 최대 5개, 가격 낮은 순
    id: string;
    price: number | null;           // 원(KRW) 정수. null = 가격 미확인 → "0원"으로 표시 금지
    currency: string;               // "KRW"
    purchaseUrl: string | null;
    isSoldOut: boolean | null;      // null = 재고 미확인
    seller: { name: string };       // 예: "29CM"
  }[];
}

interface Category { id: string; name: string; slug: string; }
```

---

## 4. 인증 API

### A1. POST /v1/auth/register

- 권한: 공개. 헤더 `X-Auth-Request: 1`, `credentials: 'include'` 필수
- 요청 제한: IP당 분당 5회

```ts
// 요청
{
  username: string;   // 3~30자, 영문 소문자·숫자·밑줄(^[a-z0-9_]+$). 대문자는 소문자로 변환됨
  email: string;      // 이메일 형식, 최대 254자. 소문자로 변환됨
  password: string;   // 12~128자
  deviceId: string;   // UUID v4
}
// 응답 201: AuthResponse (+ refresh 쿠키 설정)
```

오류: 400 형식 오류, 409 이메일 또는 아이디 중복.

### A2. POST /v1/auth/login

- 권한: 공개. 헤더 `X-Auth-Request: 1`, `credentials: 'include'` 필수
- 요청 제한: IP당 분당 10회

```ts
// 요청
{ email: string; password: string; deviceId: string; }
// 응답 200: AuthResponse (+ refresh 쿠키 설정)
```

오류: 401 이메일 또는 비밀번호 틀림. 같은 기기(deviceId)로 다시 로그인하면 그 기기의 이전 세션은 끊기고, 다른 기기 로그인은 유지됩니다.

### A3. POST /v1/auth/refresh

- 권한: refresh 쿠키. 헤더 `X-Auth-Request: 1`, `credentials: 'include'` 필수. **본문 없음**
- 요청 제한: IP당 분당 60회

응답 200: `AuthResponse` (새 accessToken + 새 refresh 쿠키). 오류 401: 쿠키 없음/만료/재사용 → 로그인 화면으로.

### A4. POST /v1/auth/logout

- 권한: refresh 쿠키. 헤더 `X-Auth-Request: 1`, `credentials: 'include'` 필수. **본문 없음**

응답 200: `{ message: "로그아웃되었습니다." }`. 쿠키가 없어도 성공합니다. 호출 후 메모리의 accessToken을 지우세요.

### A5. GET /v1/auth/me

- 권한: 로그인

응답 200: `User`

---

## 5. 코디 API

코디는 등록하면 항상 `PENDING`(검수 대기)이고, 관리자가 `APPROVED`로 승인해야 공개 목록에 나옵니다.

| 상태 | 누가 볼 수 있나 |
| --- | --- |
| `APPROVED` | 모두 |
| `PENDING`, `REJECTED` | 작성자 본인, ADMIN |

### O1. POST /v1/outfits

- 권한: 로그인
- 요청 제한: 분당 10회
- Content-Type: `multipart/form-data` (브라우저가 자동 설정. **직접 Content-Type 헤더를 넣지 마세요**)

| 폼 필드 | 타입 | 설명 |
| --- | --- | --- |
| `image` | File | JPEG/PNG/WebP 1장, 최대 8MiB. 서버가 WebP로 변환, 최대 2048px, 위치정보(EXIF/GPS) 제거 |
| `data` | string | 아래 객체를 `JSON.stringify` 한 **문자열** |

```ts
// data 필드의 내용
{
  name: string;            // 1~100자
  description?: string;    // 최대 2000자
  height: number;          // 키(cm) 정수 50~250
  weight: number;          // 몸무게(kg) 정수 10~400
  items: Array<            // 1~20개. 아래 두 방식 중 하나, 한 아이템에 섞으면 400
    | { type: OutfitItemType; productId: string; offerId?: string }  // 카탈로그 상품 (P1에서 선택)
    | { type: OutfitItemType; name: string; link?: string }          // 직접 입력 (name 1~200자, link는 http/https)
  >;
}
// 응답 201: Outfit (status: "PENDING")
```

```ts
const form = new FormData();
form.append('image', file);
form.append('data', JSON.stringify({
  name: '주말 코디', height: 175, weight: 70,
  items: [
    { type: 'TOP', productId: '<상품 UUID>', offerId: '<판매정보 UUID>' },
    { type: 'BOTTOM', name: '소장 청바지', link: 'https://example.com/jeans' },
  ],
}));
await api<Outfit>('/v1/outfits', { method: 'POST', body: form });
```

카탈로그 상품을 선택하면 아이템 이름과 링크는 서버가 상품 정보로 채웁니다. 오류: 400 입력/이미지 오류, 존재하지 않는 상품, 판매 정보가 그 상품의 것이 아님.

### O2. GET /v1/outfits

- 권한: 공개
- 쿼리: `page`, `limit`

응답 200: `Page<Outfit>` (승인된 코디만, 최신순)

### O3. GET /v1/outfits/mine

- 권한: 로그인
- 쿼리: `page`, `limit`

응답 200: `Page<Outfit>` (내 코디 전체 상태, 최신순)

### O4. GET /v1/outfits/:id

- 권한: 선택 (비공개 코디는 작성자·ADMIN 토큰 필요)

```ts
// 응답 200
Outfit & {
  // 작성자 본인 또는 ADMIN이 볼 때만 포함. 최근 반려 사유 최대 10개, 최신순
  rejectionLog?: { reason: string; reviewedAt: string }[];
}
```

오류: 404 없음 또는 볼 권한 없음.

### O5. GET /v1/outfits/:id/image

- 권한: O4와 같음
- 응답: `image/webp` 바이너리

공개(승인) 코디는 `<img src={API + outfit.imageUrl}>`로 바로 표시할 수 있습니다. **비공개 코디(내 대기·반려 코디, 관리자 검수 화면)는 `<img>`로 토큰을 보낼 수 없으므로** fetch로 받아 Blob URL로 표시합니다.

```ts
const res = await fetch(API + outfit.imageUrl, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const src = URL.createObjectURL(await res.blob()); // 다 쓰면 URL.revokeObjectURL(src)
```

---

## 6. 코디용 상품 API

상품은 관리자가 수집한 카탈로그입니다(현재 29CM 의류). 사용자는 코디 등록 화면에서 상품을 검색해 선택합니다.

### P1. GET /v1/outfits/products

- 권한: 로그인
- 쿼리:

| 이름 | 값 | 설명 |
| --- | --- | --- |
| `source` | `all`(기본) / `history` / `bookmarks` | 전체 검색 / 내 조회 기록 / 내 찜 |
| `q` | string, 최대 100자 | 상품명 검색어 (부분 일치, 대소문자 무시) |
| `page`, `limit` | | 1.5절 |

```ts
// 응답 200: source에 따라 items 모양이 다름
// source=all
Page<{ productId: string; product: ProductSummary }>

// source=bookmarks
Page<{
  bookmarkId: string;
  productId: string | null;
  product: ProductSummary | null;
  manual?: { name: string; link: string | null };  // product가 null인 예전 데이터일 때만
}>

// source=history
Page<{
  historyId: string;
  productId: string | null;
  product: ProductSummary | null;
  viewedAt: string;
  manual?: { name: string; link: string | null };  // product가 null인 예전 데이터일 때만
}>
```

`manual`이 있는 항목은 카탈로그 상품이 아니므로, 코디 등록 시 `{ type, name: manual.name, link: manual.link }` 직접 입력 방식으로 보냅니다.

### P2. POST /v1/outfits/products/:id/view

- 권한: 로그인. 요청 제한 분당 60회. 본문 없음
- 상품 상세를 볼 때 호출하면 조회 기록(P1 `source=history`)에 쌓입니다.

응답 204 (본문 없음). 오류 404: 상품 없음.

### P3. POST /v1/outfits/products/:id/bookmark

- 권한: 로그인. 본문 없음. 여러 번 호출해도 하나만 유지됩니다.

응답 201: `{ productId: string; isDeleted: false }`. 오류 404: 상품 없음.

### P4. DELETE /v1/outfits/products/:id/bookmark

- 권한: 로그인. 찜이 없어도 성공합니다.

응답 204 (본문 없음).

---

## 7. 신고 API

신고가 접수되면 운영자 디스코드 채널로 알림이 갑니다(신고 ID만 전송).

### R1. GET /v1/reports/categories

- 권한: 로그인

응답 200: `Category[]` — 신고 화면의 분류 선택지. 접수 시 `id`를 `categoryId`로 보냅니다.

### R2. POST /v1/reports

- 권한: 로그인. 요청 제한 분당 5회

```ts
// 요청
{
  categoryId: string;      // R1의 id
  reason: string;          // 1~200자
  description?: string;    // 최대 5000자
  targetType: TargetType;  // 신고 대상 종류
  targetId: string;        // 대상 ID (예: 코디 ID)
}
// 응답 201: Report (status: "PENDING")
```

```ts
interface Report {
  id: string;
  reason: string;
  description: string | null;
  targetType: TargetType;
  targetId: string;
  status: ReportStatus;
  completedAt: string | null;  // 해결/반려된 시각
  createdAt: string;
  updatedAt: string;
  category: Category;
}
```

오류: 400 없는 분류, 404 대상이 없거나 볼 수 없는 대상(남의 비공개 코디·조회 기록·찜은 신고 불가).

### R3. GET /v1/reports/mine

- 권한: 로그인
- 쿼리: `page`, `limit`, `status?: ReportStatus`, `targetType?: TargetType`

응답 200: `Page<Report>`

### R4. GET /v1/reports/:id

- 권한: 로그인 (본인 신고만)

응답 200: `Report` (관리자 메모는 포함되지 않음). 오류 404.

---

## 8. 문의 API

문의도 접수 시 디스코드로 알림이 갑니다. 답변은 관리자가 가입 이메일로 직접 보냅니다(앱 안의 답변 기능 없음).

### C1. GET /v1/contacts/categories

- 권한: 로그인

응답 200: `Category[]`

### C2. POST /v1/contacts

- 권한: 로그인. 요청 제한 분당 5회

```ts
// 요청
{
  categoryId: string;       // C1의 id
  reason: string;           // 1~200자
  description?: string;     // 최대 5000자
  feature?: string;         // 문의 기능 이름 1~100자 (예: "코디 업로드")
  targetType?: TargetType;  // 특정 대상 문의일 때만. targetId와 반드시 함께
  targetId?: string;
}
// 응답 201: Contact
```

```ts
interface Contact {
  id: string;
  reason: string;
  description: string | null;
  feature: string | null;
  targetType: TargetType | null;
  targetId: string | null;
  readAt: string | null;   // 관리자가 읽은 시각. null이면 "확인 전"
  createdAt: string;
  updatedAt: string;
  category: Category;
}
```

### C3. GET /v1/contacts/mine

- 권한: 로그인
- 쿼리: `page`, `limit`, `view?: 'all' | 'unread' | 'read'` (기본 `all`)

응답 200: `Page<Contact>`

### C4. GET /v1/contacts/:id

- 권한: 로그인 (본인 문의만)

응답 200: `Contact`. 오류 404.

---

## 9. 관리자 API (모두 ADMIN)

### AD1. GET /v1/admin/outfits

쿼리 `page`, `limit`. 응답 200: `Page<Outfit>` (`PENDING` 코디만, 최신순). 사진은 O5의 Blob 방식으로 표시합니다.

### AD2. POST /v1/admin/outfits/:id/review

```ts
// 요청
{ status: 'APPROVED' }
{ status: 'REJECTED'; reason: string }   // 반려 시 사유 필수, 1~1000자
// 응답 201: Outfit (바뀐 상태)
```

오류 409: 이미 검수된 코디.

### AD3. GET /v1/admin/reports

쿼리 `page`, `limit`, `status?`, `targetType?`. 응답 200: `Page<AdminReport>`

```ts
interface AdminReport extends Report {
  adminNote: string | null;   // 관리자 내부 메모 (신고자에게 비공개)
  reporter: { id: string; username: string; email: string } | null;
}
```

### AD4. GET /v1/admin/reports/:id

```ts
// 응답 200
AdminReport & {
  history: {                  // 처리 이력, 오래된 순, 최대 100개
    id: string;
    actorId: string | null;
    action: string;           // CREATE, UPDATE, RESOLVE, REJECT 등
    metadata: unknown;        // 예: { from, to, note, action }
    createdAt: string;
  }[];
  notification: NotificationState | null;
}

interface NotificationState {
  id: string;                 // AD9 재시도에 사용
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
}
```

### AD5. PATCH /v1/admin/reports/:id/status

```ts
// 요청
{
  expectedStatus: 'PENDING' | 'REVIEWING';            // 화면에 보이던 현재 상태 (충돌 방지)
  status: 'REVIEWING' | 'RESOLVED' | 'REJECTED';      // 바꿀 상태
  note: string;                                       // 처리 메모 필수, 1~2000자
  action?: 'NONE' | 'HIDE_OUTFIT' | 'HIDE_PRODUCT';   // 기본 NONE
}
// 응답 200: AdminReport
```

- 상태 흐름: `PENDING → REVIEWING → RESOLVED/REJECTED` 또는 `PENDING → RESOLVED/REJECTED`. 끝난 신고는 다시 바꿀 수 없습니다.
- `action`은 `status: 'RESOLVED'`일 때만 가능합니다. `HIDE_OUTFIT`은 코디 신고에만(코디를 비공개로), `HIDE_PRODUCT`는 상품 신고에만(검색에서 제외) 쓸 수 있습니다.
- 오류: 400 같은 상태로 변경·잘못된 조치, 404 대상 삭제됨, **409 다른 관리자가 먼저 처리함 → 새로고침 안내**.

### AD6. GET /v1/admin/contacts

쿼리 `page`, `limit`, `view?: 'all' | 'unread' | 'read'`. 응답 200: `Page<AdminContact>`

```ts
interface AdminContact extends Contact {
  user: { id: string; username: string; email: string } | null;  // 회신할 이메일
}
```

### AD7. GET /v1/admin/contacts/:id

응답 200: `AdminContact & { notification: NotificationState | null }`. 상세를 열어도 자동으로 읽음 처리되지 않습니다.

### AD8. PATCH /v1/admin/contacts/:id/read

본문 없음. 응답 200: `AdminContact` (`readAt` 채워짐). 여러 번 호출해도 처음 읽은 시각이 유지됩니다.

### AD9. POST /v1/admin/notifications/:id/retry

`:id`는 AD4/AD7 응답의 `notification.id`. `FAILED` 상태일 때만 가능합니다.

응답 201: `{ id: string; status: 'PENDING' }`. 오류 409: 재시도할 수 없는 상태.

### AD10~AD13. 상품 수집 (요청 제한: 각 분당 3회)

상품 수집은 시간이 오래 걸립니다(상품 페이지당 수 초). 버튼을 누른 뒤 로딩 표시를 하고 타임아웃을 넉넉히(2분 이상) 잡으세요.

| API | 요청 | 설명 |
| --- | --- | --- |
| AD10 `GET /v1/admin/products/providers` | - | 응답 `{ id: string; name: string }[]`. 현재 `29cm`, `example`(개발용) |
| AD11 `POST .../providers/:provider/discover` | `{ limit?: number }` (1~100, 최대 30페이지로 제한) | 새 상품 찾기. 29CM은 의류만 저장 |
| AD12 `POST .../providers/:provider/refresh` | `{ url: string }` | 상품 URL 하나 수집. 예: `https://www.29cm.co.kr/products/4338738` |
| AD13 `POST /v1/admin/products/offers/:id/refresh` | 본문 없음 | 저장된 판매 정보의 URL을 다시 수집 |

```ts
// AD11~AD13 응답 201 (AD10은 200)
interface CollectResult {
  products: { name: string; price: number | null; productUrl: string; category?: string; brand?: string; imageUrl?: string }[];
  saved: { created: number; updated: number; unchanged: number };
  failures: { provider: string; url: string; code: string }[];  // 일부 실패해도 나머지는 저장됨
  visited?: number;   // AD11만: 방문한 상품 페이지 수
  skipped?: number;   // AD11만: 의류가 아니라서 건너뛴 수
}
```

`POST /v1/admin/products/providers/29cm/search`는 29CM에서 지원하지 않아 400을 반환합니다. 대신 AD11을 쓰세요.

---

## 10. 헬스 체크

| API | 응답 |
| --- | --- |
| H1 `GET /health` | 200이면 서버 프로세스 살아 있음 |
| H2 `GET /health/ready` | 200이면 DB·Redis까지 정상, 503이면 장애 |

---

## 11. 프런트 체크리스트

- [ ] 프런트 Origin을 백엔드 `CORS_ORIGINS`에 등록 요청했다
- [ ] 모든 요청에 `credentials: 'include'`를 넣었다
- [ ] 인증 POST(A1~A4)에 `X-Auth-Request: 1` 헤더를 넣었다
- [ ] accessToken은 메모리에만 두고, 앱 시작 시 refresh로 복원한다
- [ ] refresh 요청이 동시에 여러 번 나가지 않는다
- [ ] 비공개 코디 사진은 Blob URL로 표시한다
- [ ] `price: null`을 0원으로 표시하지 않는다 ("가격 정보 없음")
- [ ] 정의되지 않은 필드를 요청에 넣지 않는다 (400)
- [ ] 409 응답에서 "새로고침해 주세요"를 안내한다

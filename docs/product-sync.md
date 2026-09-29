# 상품 수집 및 동기화

## 구현 상태

현재 DB의 `Seller.slug`, `ProductOffer(sellerId, externalProductId)`,
`ProductImage`, `ProductOfferVariant` 구조를 기준으로 구현했습니다.
NestJS 12.0.1 / Prisma 7.10.0의 기존 ConfigService·PrismaService·Repository 패턴을 사용합니다.
공통 HTTP 클라이언트는 없으므로 Node의 fetch를 사용하고, 스케줄링에
`@nestjs/schedule`과 동적 Cron 등록에 필요한 `cron`을 추가했습니다.

**실제 쿠팡 API 연동은 아직 활성화할 수 없습니다.** 저장·갱신·이력·HTTP 전송·스케줄링
코드는 구현했지만 공식 Partners API 문서를 확인하지 못한 인증/응답 계약은 TODO입니다.
키만 입력해도 동작하는 완성된 API 연동으로 간주하면 안 됩니다.

확인한 공식 포털: https://partners.coupang.com/#/apidocument

2026-09-14 확인 시 포털은 JavaScript 문서 본문을 제공하지 않았고 공개 스크립트 요청도
접근 차단되었습니다. 판매자 Open API 문서나 비공식 예제를 Partners 규격으로 대신 사용하지 않았습니다.

## 1. 변경 파일 및 2. 역할

| 파일 | 역할과 선택 이유 |
| --- | --- |
| `src/products/collectors/collected-product.interface.ts` | 외부 API와 DB 사이의 내부 계약 및 가격·ID·URL 검증. 통화는 가격 이력 해석을 위해 추가합니다. |
| `src/products/collectors/product-collector.interface.ts` | 소스 식별자와 `collect()` 계약. 키워드는 설정에서 받아 스케줄러가 API 검색 규칙을 알 필요가 없습니다. |
| `src/products/collectors/coupang/coupang.types.ts` | 검증 전 API 응답은 unknown으로 유지하고 안전한 오류 타입만 정의합니다. |
| `src/products/collectors/coupang/coupang.protocol.ts` | 확인되지 않은 endpoint·HMAC·응답 매핑만 격리한 TODO 경계. 테스트 대체 구현은 실제 쿠팡 규격이 아닙니다. |
| `src/products/collectors/coupang/coupang.client.ts` | HTTP 요청, 타임아웃, 요청 직렬화, 429/5xx 유한 재시도. DB에 접근하지 않습니다. |
| `src/products/collectors/coupang/coupang.collector.ts` | 키워드 순회, 프로토콜을 통한 응답 매핑, 내부 모델 검증, 잘못된 항목 제외, ID 중복 제거. |
| `src/products/repository/product-sync.repository.ts` | 모든 Prisma 쓰기 및 트랜잭션을 한곳에 둡니다. |
| `src/products/sync/product-sync.service.ts` | 외부 타입에 의존하지 않는 단건/배치 동기화와 상품 오류·배치 장애 분류. |
| `src/products/scheduler/product.scheduler.ts` | 동적 Cron 등록과 실행 중복 방지만 담당합니다. |
| `src/products/products.module.ts`, `src/app.module.ts` | 기존 앱의 DI와 모듈에 등록합니다. |
| `src/config/product-sync.config.ts`, `src/config/environment.ts`, `.env.example` | 기존 ConfigService에 설정을 통합하고 활성화 시 키·키워드를 검사합니다. |
| `prisma/schema.prisma`, 신규 migration 2개 | 가격 이력 및 기존 마이그레이션에서 누락된 판매처 식별자를 추가합니다. |
| `src/products/**/*.spec.ts`, `src/config/product-sync.config.spec.ts` | 수집, 전송, 설정, 배치, 저장 계약, 스케줄러 단위 테스트. |
| `test/product-sync.e2e-spec.ts` | 독립 PostgreSQL 스키마에서 전체 마이그레이션, 중복 방지, 동시 생성, 원자적 롤백 검증. |
| `package.json`, `package-lock.json` | 스케줄러 의존성을 기록합니다. |

## 3. 데이터 흐름

```text
ProductScheduler
  → CoupangCollector.collect()
  → CoupangClient.search(keyword)
  → CoupangProtocol.buildSearchRequest() [공식 문서 필요]
  → Partners API HTTP 응답
  → Collector: protocol.toCandidates() [공식 문서 필요] + 내부 검증
  → ProductSyncService.syncMany(products, collector.source)
  → ProductSyncRepository
  → Seller / Product / ProductImage / ProductOffer / ProductPriceHistory
```

## 4. DB 변경 및 마이그레이션 조건

- `ProductPriceHistory`: offerId, price, currency, createdAt. Offer 삭제 시 Cascade.
- `ProductOffer.priceHistories` 역방향 관계와 `(offerId, createdAt)` 인덱스.
- `ProductHistory`는 기존 사용자 조회 기록으로 유지합니다.
- `20260914093000_seller_identity`: 현재 스키마에는 있지만 이전 마이그레이션에는 없던
  `Seller.slug`, `baseUrl`, 인덱스를 추가합니다. 기존 판매처에는 `legacy-<UUID>`를 부여해
  이름이 같은 판매처를 임의 병합하지 않습니다. 기존 쿠팡 판매처가 있다면 운영자가 그 행의
  식별자를 확인해 `slug = coupang`으로 지정한 뒤 수집을 활성화해야 합니다.
- `20260914100000_product_price_history`: 새 가격 이력 테이블과 외래 키를 추가합니다.
  기존 가격을 과거 수집 이력처럼 소급해 만들지 않습니다.

작업 시작 시 기존 마이그레이션과 현재 스키마가 이미 불일치했습니다. 이번 변경은
수집에 필요한 판매처/가격 이력만 보완합니다. 현재 스키마의 카테고리 계층,
ProductOfferVariant, 코디 작성자·검수 상태, 상품 북마크/조회 관계 등의 변경은
기존 마이그레이션에 없습니다. 전체 DB 스키마가 마이그레이션만으로 재현된다고 보장하지 않습니다.
그 변경은 기존 데이터의 소유자·연결 매핑이 필요하므로 임의의 파괴적 변환을 추가하지 않았습니다.

이미 `db push` 등으로 판매처 필드가 DB에 만들어졌다면 새 마이그레이션을 무조건 실행하지 말고,
실제 스키마와 이력을 먼저 대조해야 합니다. 이번 작업에서는 실제 DB에 마이그레이션을 적용하지 않았습니다.

## 5. 중복 방지 및 6. 가격 변경

판매처는 고유한 slug로 upsert합니다. Offer는 `(sellerId, externalProductId)`로 조회하며,
신규 외부 ID는 새 Product를 생성합니다. 서로 다른 상품을 이름만으로 매칭하지 않습니다.
향후 ProductMatcher는 Repository의 `createProduct` 지점에 연결할 수 있습니다.

최초 Offer 생성 시 최초 가격을 기록하고, 기존 Offer는 가격 또는 통화가 달라질 때만 이력을 추가합니다.
URL/품절 상태만 달라지면 가격 이력을 추가하지 않습니다. 누락된 URL/품절 정보는 기존 값을 보존합니다.
신규 Offer의 품절 기본값은 기존 스키마의 false를 사용합니다. 검색에서 사라진 상품을 품절로 추정하지 않습니다.
동일 이미지는 상품 ID와 URL로 조회한 뒤 없을 때만 추가합니다. 상품 이름·브랜드·카테고리 등
기존 공통 상품 메타데이터는 수집 가격 갱신 시 덮어쓰지 않습니다.

## 7. 트랜잭션

판매처 식별부터 신규 Product·Image·Offer·최초 이력 또는 기존 Offer·변경 이력·이미지까지
상품별 Serializable 트랜잭션으로 묶습니다. 이력 저장 실패 시 현재 가격도 롤백됩니다.
P2002(고유 키 충돌), P2034(직렬화 충돌)는 전체 상품 트랜잭션을 최대 2회 다시 시도합니다.
따라서 두 인스턴스가 같은 신규 ID를 수집해도 실패한 트랜잭션의 고아 Product가 남지 않습니다.

잘못된 입력과 일부 데이터 제약 오류는 해당 상품만 제외합니다. 연결 장애, 스키마 불일치,
재시도 소진, 알 수 없는 오류는 배치를 중단합니다. 이미 성공한 상품은 유지합니다.

## 8. 스케줄러 및 호출 제한

기본은 비활성화입니다. 활성화 시 서울 시간 매 6시간(`0 0 */6 * * *`)에 실행하고,
앱 시작 직후에는 실행하지 않습니다. 일정을 `COUPANG_SYNC_CRON`으로 바꿀 수 있습니다.
같은 프로세스에서 실행 중인 배치는 건너뜁니다.

다중 인스턴스에서는 **한 인스턴스만 COUPANG_SYNC_ENABLED=true**로 운영해야 합니다.
DB 트랜잭션은 중복 행을 막지만 API 중복 호출이나 오래된 수집 결과의 후속 갱신까지 막지는 않습니다.
분산 스케줄이 필요해지면 별도 작업자 또는 분산 잠금을 추가합니다.

클라이언트는 호출을 직렬화하고 요청 간격을 적용합니다. 429/5xx에만 설정된 횟수만큼
지수 backoff를 사용하며 Retry-After도 존중합니다. 허용 대기시간보다 긴 Retry-After는
짧게 잘라 재호출하지 않고 배치를 종료합니다. 네트워크/timeout, 401/403, 응답 파싱 실패는
자동 재시도하지 않습니다. 재시도마다 새 서명을 생성하는 경계가 있습니다.
기본 간격/재시도 숫자는 운영 설정 예시이며 쿠팡의 공식 rate limit이 아닙니다.
로그에는 키, 서명, 원본 응답, 구매 URL을 출력하지 않습니다.

## 9. 남은 정보와 TODO

공식 **Coupang Partners** 검색 문서에서 다음이 필요합니다. 비밀키를 문서나 채팅으로 전달할 필요는 없습니다.

1. 정확한 호스트, 경로, 메서드, keyword/category·limit·페이지네이션·subId 파라미터.
2. HMAC 입력 문자열, 쿼리 인코딩/정렬, 날짜 형식, 헤더 규격과 공식 서명 예제.
3. 성공·실패 응답 envelope와 실제 ID·이름·가격·이미지·구매 URL·품절 필드, 익명화한 샘플.
4. 검색 API 권한 및 호출 제한, Retry-After 지원 여부.

확인 후 `CoupangProtocol`의 세 메서드를 구현하고 실제 문서 기반 fixture 테스트를 추가해야 합니다.
`assertConfigured()`의 throw만 제거하는 것은 구현 완료가 아닙니다.
현재 프로토콜 테스트는 합성 응답으로 HTTP/수집 동작만 검사합니다.
상품 옵션·재고 수, 브랜드/카테고리 매핑, 동일상품 매칭, 전체 카탈로그 페이지 순회는
검증 가능한 API 정보가 없으므로 구현하지 않았습니다. 현재 배치는 키워드 결과를 메모리에 모아
순차 처리하며 대규모 수집에서는 collect → queue → sync 단건 작업자로 확장할 수 있습니다.

## 10. 실행과 검증

```sh
npm install
npm run prisma:generate
npx prisma validate --config prisma7.config.ts
npm run build
npm test -- --runInBand
npx eslint "src/products/**/*.ts" src/config/product-sync.config.ts src/config/product-sync.config.spec.ts src/config/environment.ts src/app.module.ts test/product-sync.e2e-spec.ts
```

PostgreSQL을 실행하고 DATABASE_URL을 지정한 뒤 상품 통합 테스트만 실행합니다.
이 테스트는 임의 이름의 독립 스키마를 만들고 종료 시 그 스키마만 제거하며 Redis는 사용하지 않습니다.

```sh
npm run test:e2e -- --runInBand --runTestsByPath test/product-sync.e2e-spec.ts
```

실제 DB와 마이그레이션 이력을 대조한 후 적용 명령은 `npm run db:migrate`입니다.
프로토콜 구현과 API 계약 테스트가 완료되면 `.env.example`의 키·검색어·스케줄을 설정하고
`COUPANG_SYNC_ENABLED=true`, `npm run start:dev`로 실행합니다.

후속 운영 리뷰에서 PostgreSQL과 Redis를 실행한 상태로 상품 통합 테스트 4개를 확인했습니다.
기존 인증 E2E도 Redis 세션 구조에 맞게 수정했습니다. 최신 전체 검증 결과는
[운영 리뷰](production-review.md)를 참고하세요.

종료 시에는 수집 HTTP/재시도 대기를 취소하고 다음 상품 처리를 중단합니다.
진행 중인 단건 트랜잭션은 마친 뒤 DB 연결 종료 단계로 넘어갑니다.

# 상품 크롤러 구현 및 실행 안내

기존 NestJS/Prisma 구조에 Crawlee + Lightpanda를 통합했습니다. Provider는 저장소의 HTTP fixture를 수집하는 `ExampleProvider`와 29CM 의류를 수집하는 `Cm29Provider`(2026-10-28 추가, [13절](#13-29cm-의류-provider-2026-10-28))입니다. 공식 API 연동은 없습니다. 쿠팡 파트너스 API는 제거한 상태를 유지합니다.

## 1. 생성한 파일

- `src/crawler/crawler.module.ts`, `crawler.service.ts`, `crawl-policy.ts`
- `src/crawler/browser/lightpanda.service.ts`
- `src/crawler/types/external-product.ts`
- `src/crawler/extractors/{json-ld.extractor,product.extractor,price.parser}.ts`
- `src/crawler/providers/product-provider.interface.ts`
- `src/crawler/providers/crawling/base-crawler.provider.ts`
- `src/crawler/providers/sites/example/{example.provider,example.parser}.ts`
- `src/config/crawler.config.ts`
- `src/products/{product.service,product-admin.controller}.ts`
- `src/products/repository/product-refresh.repository.ts`, `src/products/scheduler/product-refresh.scheduler.ts` 및 단위 테스트
- `test/product-refresh.e2e-spec.ts`, `prisma/migrations/20261007090000_product_refresh_schedule/migration.sql`
- 위 구성의 단위 테스트, `test/product-admin.e2e-spec.ts`, `test/crawler.smoke-spec.ts`, `test/fixtures/{fixture-shop,start-shop}.ts`
- `prisma/migrations/20261001090000_crawler_offer_metadata/migration.sql`

## 2. 수정한 파일

`package.json`, `package-lock.json`, `docker-compose.yml`, `.env`, `.env.example`, `prisma/schema.prisma`, `src/config/environment.ts`, `src/products/products.module.ts`, `src/products/collectors/collected-product.interface.ts`, `src/products/repository/product-sync.repository.ts`, 관련 저장 테스트 및 `test/database-fixture.ts`, `test/setup-env.cjs`, README와 관련 문서를 수정했습니다. `.env`는 Git 추적 대상이 아닙니다.

## 3. 의존성과 호환성

현재 프로젝트의 Node 24 환경에서 npm 안정 버전을 확인한 뒤 `crawlee@3.18.2`, `playwright-core@1.63.0`을 정확한 버전으로 설치했습니다. Chromium은 다운로드하거나 실행하지 않습니다. Lightpanda는 공식 nightly 이미지를 실제 검증한 digest로 고정합니다. npm 패키지는 RC/beta를 사용하지 않았지만 Lightpanda 이미지 자체는 nightly 기반입니다.

공식 이미지와 CDP 연결은 [Lightpanda 저장소](https://github.com/lightpanda-io/browser), [실행 명령 문서](https://lightpanda.io/docs/run-locally/commands)를 참고했습니다. 요청 큐·재시도·속도 제한은 [Crawlee BasicCrawler](https://crawlee.dev/js/api/basic-crawler/class/BasicCrawler)의 기능을 사용합니다.

## 4. 전체 흐름과 설계 이유

```text
ADMIN HTTP API → ProductService → ProductProvider
                                  ├─ ExampleProvider → CrawlerService/BasicCrawler
                                  │                    → LightpandaService
                                  │                    → playwright-core/CDP
                                  │                    → Lightpanda Docker
                                  │                    → HTTP 페이지
                                  └─ 향후 OfficialApiProvider
              ← ExternalProduct + failures
              → ProductSyncService → ProductSyncRepository → PostgreSQL
```

검색은 검색 페이지에서 URL을 발견한 후 별도의 상세 큐를 실행합니다. 상세 URL 또는 기존 offer ID를 지정하면 검색 없이 바로 갱신합니다. 반환값은 `{ products, saved: { created, updated, unchanged }, failures }`이며 부분 실패가 있어도 다른 상품을 처리합니다.

- **Crawlee**: 큐, URL 중복 제거, 재시도, 동시성, 시간 제한, 실패 처리를 검증된 라이브러리에 맡깁니다. 별도 크롤러 프레임워크를 만들지 않습니다.
- **Browser 재사용**: Nest lifecycle 동안 하나의 CDP 연결을 유지해 상품마다 연결하는 비용을 줄입니다. 연결이 끊어지면 다음 배치 시작 시 재연결합니다.
- **요청별 Context**: 쿠키와 페이지 상태를 분리합니다. Page와 Context는 성공·실패 모두 `finally`에서 닫습니다. 종료 시 큐를 중단하고 진행 중 작업 정리 후 Browser 연결을 닫습니다.
- **JSON-LD 우선**: 표현용 DOM 구조보다 상품 의미가 명확합니다. 단일 객체·배열·`@graph`·배열형 `@type`을 처리하며 깨진 script 하나는 건너뜁니다. 이후 사이트 state, DOM 순으로 확인합니다.
- **Product / 판매 정보 분리**: 내부 표준 상품과 판매처별 가격·URL·재고·원본 메타데이터의 수명이 다릅니다. 기존 `ProductOffer`를 재사용해 중복 모델을 만들지 않습니다.
- **Provider 인터페이스**: ProductService는 브라우저를 참조하지 않습니다. 같은 인터페이스를 구현한 API Provider로 바꿔도 저장 흐름을 유지할 수 있습니다. 부분 실패를 표현하기 위해 단순 배열 대신 `ProviderResult`를 반환합니다.

## 5. 클래스 역할

| 구성 | 책임 |
| --- | --- |
| ProductAdminController | ADMIN 권한, 입력 검증, 수집 요청별 분당 3회 제한 |
| ProductService | Provider 선택, 상품별 저장, 저장 결과와 부분 실패 반환 |
| ProductSyncService / Repository | 입력 검증, 판매처 식별, 트랜잭션·중복 충돌 처리·가격 이력 |
| CrawlerService | BasicCrawler 실행, 배치 직렬화, 실패 코드 로그, URL 정책·robots 확인 |
| LightpandaService | 단일 CDP 연결, 요청별 Page/Context 생성과 정리, 종료 처리 |
| BaseCrawlerProvider | 검색 URL 발견과 상세 추출 흐름 분리 |
| ExampleProvider / ExampleParser | fixture의 허용 경로·검색 링크·state·DOM selector |
| CrawlRobotsPolicy | 배치별 robots 캐시, Crawlee parser로 허용 확인 |
| extractProduct / normalizeProduct | JSON-LD → state → DOM 추출, 공통 데이터 정규화 |
| parseKrwPrice | KRW 정수 파싱, 잘못된 값·할인율·외화는 null |

## 6. Crawlee와 CDP 연결

`BasicCrawler.requestHandler`가 `LightpandaService.withPage()`를 사용합니다. 서비스는 `chromium.connectOverCDP(LIGHTPANDA_CDP_URL)`로 시작 시 연결하고 Browser를 재사용합니다. 연결 실패는 서비스 전체 시작을 막지 않고 `LIGHTPANDA_UNAVAILABLE`로 기록하며 수집 결과에 실패를 반환합니다.

**검증한 Lightpanda 빌드는 한 연결에서 BrowserContext를 하나만 허용합니다.** 두 번째 동시 생성은 `Target.createBrowserContext` 오류를 반환했습니다. 따라서 설정 기본값은 3이지만 실제 Crawlee 동시성은 `min(CRAWLER_MAX_CONCURRENCY, contextCapacity=1)`입니다. 같은 Context를 공유하거나 상품마다 CDP 연결을 만드는 방식은 사용하지 않았습니다. 해당 제한을 해소한 이미지로 교체할 때 병렬 smoke test 후 capacity를 변경해야 합니다.

로그는 provider, 쿼리·fragment·인증정보를 제거한 URL, 정해진 오류 코드만 기록합니다. `NAVIGATION_TIMEOUT`, `MALFORMED_JSON_LD`, `PRODUCT_NOT_FOUND`, `PRICE_MISSING`, `LIGHTPANDA_UNAVAILABLE`, `PAGE_CREATION_FAILED`, `HTTP_FAILURE`, `NAVIGATION_FAILED` 등을 구분합니다. 가격 누락은 저장 가능한 상태이므로 경고만 남깁니다.

## 7. DB 변경

기존 `Product`, `Seller`, `ProductOffer`, `ProductPriceHistory`를 유지합니다. `Seller.slug`가 Provider ID입니다.

- `ProductOffer`: `productUrl`, `originalPrice`, `sourceName`, `sourceBrand`, `sourceCategory`, `modelNumber`, `sku`, `imageUrl`, `lastCrawledAt` 추가.
- `price`, `isSoldOut`을 nullable로 변경. 가격·재고 미확인을 0원 또는 판매 중으로 단정하지 않습니다.
- 기존 `(sellerId, externalProductId)` 고유 키 유지, `(sellerId, productUrl)` 고유 키 추가. ID가 없는 상품도 URL로 중복 방지합니다.
- SKU/모델 번호 인덱스 추가. 표준 상품명과 판매처 원본 이름을 분리 보존합니다.
- 이름만 같은 상품을 자동 병합하지 않습니다. ID와 URL이 서로 다른 기존 offer를 가리키면 저장을 거절합니다.
- 늦게 도착한 과거 수집 결과는 최신 값을 덮어쓰지 않습니다. 누락된 선택 메타데이터는 보존합니다.
- 가격이 null이면 가격 이력을 생성하지 않습니다. 새 유효 가격이 들어오거나 가격·통화가 바뀔 때 기록합니다.
- 기존 `purchaseUrl`은 보존합니다. 과거 구매 URL을 새 고유 키로 일괄 복사하지 않으므로 레거시 중복 URL로 마이그레이션이 실패하지 않습니다.

클라이언트도 판매 가격과 품절 여부의 null을 처리해야 합니다. null 가격을 최저가 0원으로 표시하면 안 됩니다.

2026-10-01 로컬 public schema에 10번째 마이그레이션까지 적용했습니다. 적용 전 데이터는 `.tmp/daily-data-before-crawler-20261001.json`(PostgreSQL 행 JSON 문자열), 스키마 DDL은 `.tmp/daily-schema-before-crawler-20261001.sql`에 저장했습니다. 이는 pg_dump 형식의 백업은 아닙니다. 적용 후 기존 애플리케이션 행의 모든 기존 컬럼 값 보존과 Prisma schema diff의 차이 없음을 확인했습니다.

## 8. 환경변수

`.env`와 `.env.example` 모두 반영했습니다. 실제 `.env`는 자동 갱신을 위해 크롤러를 활성화했으며, 다음 예시는 `.env.example`의 기본값입니다.

```dotenv
CRAWLER_ENABLED=false
LIGHTPANDA_CDP_URL=ws://127.0.0.1:9222
CRAWLER_MAX_CONCURRENCY=3
CRAWLER_MAX_RETRIES=2
CRAWLER_REQUEST_TIMEOUT=30000
CRAWLER_MAX_PAGES=30
CRAWLER_MAX_REQUESTS_PER_MINUTE=30
CRAWLER_EXAMPLE_BASE_URL=http://host.docker.internal:9080
CRAWLER_REFRESH_ENABLED=true
CRAWLER_REFRESH_INTERVAL_MS=21600000
CRAWLER_REFRESH_RETRY_DELAY_MS=900000
CRAWLER_REFRESH_BATCH_SIZE=10
LIGHTPANDA_IMAGE=lightpanda/browser@sha256:2d29d32d5ae76771096e2e9ecf46d30947ea58f9966cd2235cf4526657a029d2
```

수집하려면 `CRAWLER_ENABLED=true`로 변경합니다. Compose에 NestJS를 추가해 실행할 경우 CDP 주소를 `ws://lightpanda:9222`로 지정합니다. `LIGHTPANDA_PORT`로 호스트 포트를 바꾸면 CDP URL도 맞춥니다. ConfigService의 검증된 `app.crawler` 설정을 사용합니다.

## 9. Docker와 개발 실행

저장소 루트(`daily_api`)에서 실행합니다.

```sh
docker compose up -d postgres redis lightpanda
npm run db:migrate
npm run prisma:generate
npm run crawler:fixture
```

fixture는 포트 9080에서 실행되며 `CRAWLER_EXAMPLE_BASE_URL=http://<현재 호스트 IP>:9080`을 출력합니다. Windows 호스트와 Docker 양쪽에서 접근 가능한 주소를 `.env`에 설정합니다. `host.docker.internal`이 호스트에서 오래된 IP로 해석되는 환경에서는 출력된 IP를 사용합니다. 여러 네트워크 인터페이스가 있다면 Docker에서도 접근 가능한 IP를 선택해야 합니다. fixture는 개발·테스트용이므로 운영에서 실행하지 않습니다.

별도 터미널에서 `npm run start:dev`를 실행하고 `/docs`의 ADMIN API를 호출합니다.

| 경로 (`/v1` 포함) | 본문 / 동작 |
| --- | --- |
| `GET /v1/admin/products/providers` | 등록된 Provider 조회 |
| `POST /v1/admin/products/providers/example/search` | `{ "keyword": "shirt" }` 검색 후 저장 |
| `POST /v1/admin/products/providers/example/refresh` | `{ "url": "<fixture base>/products/json-ld" }` 상세 갱신 |
| `POST /v1/admin/products/offers/:id/refresh` | 저장된 상품 URL로 직접 갱신 |

Bearer 토큰과 ADMIN 권한이 필요합니다. 일반 사용자 코디 상품 검색은 계속 DB만 조회합니다. 관리자가 검색으로 상품을 등록하면 주기 갱신 스케줄러가 저장된 상품 URL을 재방문합니다. Lightpanda의 9222는 `127.0.0.1`에만 노출합니다.

### 저장된 상품 주기 갱신 (2026-10-07 추가)

`ProductRefreshScheduler`는 NestJS ScheduleModule의 1분 간격 작업입니다. `CRAWLER_ENABLED`와 `CRAWLER_REFRESH_ENABLED`가 모두 true일 때 작동합니다. 실제 `.env`에서는 두 설정을 활성화하며 `.env.example`의 크롤러 기본값은 false입니다. 기본 성공 갱신 주기는 6시간, 실패 재시도 대기는 15분, 한 배치 최대 10개입니다. 서버를 시작한 뒤 첫 확인은 약 1분 후 진행합니다.

등록된 Provider의 URL 있는 판매 정보 중 미수집 또는 오래된 상품부터 선택합니다. 최근 수집된 상품, 삭제된 Product, 미등록 Provider, 다음 예약 시각이 남은 상품은 제외합니다. 품절 상품은 재입고 확인을 위해 계속 갱신합니다. 새 상품 발견이나 검색 페이지 순회는 수행하지 않습니다.

`ProductOffer`에 `nextRefreshAt`, `lastRefreshAttemptAt`, `lastRefreshError`, `refreshLockToken`, `refreshLockedUntil`을 추가합니다. DB 조건부 UPDATE로 한 상품의 작업을 선점하며 잠금은 90초, 진행 중에는 30초마다 연장합니다. 한 프로세스의 겹치는 tick은 같은 작업을 기다립니다. 서버 강제 종료로 남은 잠금은 만료 후 다시 선점할 수 있습니다. 완료 처리에는 선점 토큰을 확인해 이전 작업이 새 작업의 예약을 덮어쓰지 못하게 합니다.

상품별 실패는 다음 예약을 15분 뒤로 옮기고 다른 상품을 계속 처리합니다. Lightpanda 연결 실패면 현재 배치를 중단합니다. 실제 수집·저장은 기존 ProductService를 사용하므로 가격·재고·원본 메타데이터와 가격 이력의 기존 규칙이 적용됩니다. 성공은 기본 6시간 뒤 예약하며 가격 미확인은 null로 보존합니다. 수집 주기 변경은 이미 기록된 다음 예약 시각을 일괄 수정하지 않으며 이후 완료 시 새 주기로 예약합니다.

DB 또는 프로세스 장애가 잠금 연장과 겹치면 수집 요청이 중복될 가능성은 있으므로 정확히 한 번 실행을 보장하지 않습니다. 기존 판매 정보 고유 키·관측 시각·트랜잭션으로 중복 저장과 오래된 값의 덮어쓰기를 방지합니다. 여러 앱 인스턴스가 하나의 Lightpanda를 함께 사용하는 구성은 BrowserContext 제한 때문에 별도 검증이 필요합니다.

배포 전에 `npm run db:migrate`와 `npm run prisma:generate`로 새 스케줄러 컬럼을 반영합니다. 단위 테스트는 활성화 조건·tick 중복·종료 대기·재시도·잠금 연장·배치 제한을, PostgreSQL E2E는 실제 가격 이력·대상 필터·선점 경쟁·잠금 복구·재시도 예약 보존을 검사합니다.

## 10. 테스트 방법

```sh
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:crawler
npm run build
npx tsc --noEmit --incremental false
npx eslint "src/**/*.ts" "test/**/*.ts"
npx prisma validate --config prisma7.config.ts
```

Windows PowerShell 실행 정책이 npm.ps1을 막으면 `npm.cmd`, `npx.cmd`를 사용합니다. 기본 E2E에는 PostgreSQL·Redis가 필요하며 crawler smoke에는 Lightpanda도 필요합니다. smoke는 임시 DB schema와 실제 HTTP fixture를 만들고 정리합니다. `.env`의 비활성 기본값과 별개로 테스트 인스턴스에서만 크롤러를 켭니다. 네트워크 주소를 자동 선택하지 못하면 실행 전 `CRAWLER_FIXTURE_HOST`에 공유 가능한 호스트 IP를 지정합니다.

단위 테스트는 JSON-LD 형태·브랜드·offers 배열·가격 정규화·CDP 재사용·예외 정리·robots·설정·API Provider 대체 가능성을 확인합니다. 실제 smoke는 검색→상세→DB, JSON-LD/state/DOM, URL 중복, 503 재시도, robots 금지, 가격 null, URL 직접 갱신, 시간 초과 후 정리·후속 요청을 확인합니다. 기존 인증·코디·신고·문의 E2E도 유지합니다.

2026-10-01 검증: 단위 89개, 기존 PostgreSQL/Redis E2E 40개, 신규 관리자 API E2E 4개 통과. Nest build, 전체 TypeScript, lint, Prisma validate 및 실제 DB schema diff 통과. 초기 실제 Lightpanda smoke 4개는 통과했으나, 작업 재개 후 Docker 엔진 health API가 응답하지 않고 컨테이너에서 호스트 fixture 페이지로의 navigation이 실패했습니다. 시간 초과 정리 항목을 추가한 최신 smoke 5개의 재검증은 Docker 상태 복구 후 필요합니다. 이 결과를 전체 완료로 간주하지 않습니다.

## 11. 현재 한계

- ExampleProvider는 제어 가능한 fixture 전용입니다. 실제 쇼핑몰 구조와 정책은 별도로 검토해야 합니다. 모든 사이트 지원이나 운영 호환성을 검증했다는 의미가 아닙니다.
- Lightpanda nightly의 Context 동시성은 1이며 브라우저 호환성이 Chromium과 같지 않습니다. 이미지 변경 시 실제 smoke test를 다시 실행해야 합니다.
- Lightpanda는 일부 HTTP redirect hop을 CDP route로 노출하지 않습니다. 허용되지 않은 최종 URL의 추출·저장은 거절하지만 중간 요청 자체를 모두 차단한다고 보장할 수 없습니다. 실제 외부 사이트 Provider를 운영할 때는 컨테이너 egress에서 사설망·메타데이터 주소 접근을 제한해야 합니다. 로컬 fixture는 사설망 접근이 필요하므로 개발 Compose에는 이 차단을 넣지 않았습니다.
- robots는 plain fetch와 Crawlee parser로 확인합니다. 404는 미설정으로 처리하고 접근 오류·다른 실패 응답·redirect는 허용하지 않습니다. 브라우저에도 `--obey-robots`를 적용합니다. 사이트 이용약관 검토를 자동화하지는 않습니다.
- 큐는 배치마다 메모리에 생성하고 종료 시 버립니다. 프로세스 재시작 복원이나 분산 처리, 전체 사이트 페이지 순회는 없습니다. 검색은 한 페이지, 상세는 `CRAWLER_MAX_PAGES`까지입니다. 동시 관리자 배치는 한 프로세스 안에서 직렬 실행됩니다.
- 관리자 HTTP 요청 안에서 수집하므로 처리량이 커지면 작업 ID 기반 비동기 실행이 필요합니다. 요청 제한은 프로세스별이며 전체 분산 rate limit은 없습니다.
- 유효한 상품명만 있는 JSON-LD도 상품으로 받아들이며 가격 누락은 null로 보존합니다. 여러 출처의 필드를 임의로 섞거나 다른 옵션 가격을 합성하지 않습니다. offers 배열의 첫 유효 KRW offer를 사용하며 옵션별 최저가 비교는 하지 않습니다.
- 현재 자동 상품 매칭은 없으며 브랜드·이름·MPN·SKU를 향후 매칭에 사용할 수 있도록 보존합니다.

## 12. 다음 쇼핑몰 추가 방법

1. 대상 사이트 약관·robots와 수집 허용 범위를 확인합니다.
2. `providers/sites/<site>/`에 Provider와 Parser를 추가합니다. 허용 origin/상품 경로, 검색 URL, 검색 결과 URL 발견만 Provider에 둡니다.
3. JSON-LD는 공통 extractor를 사용합니다. 사이트 state/DOM fallback만 Parser에 작성합니다. 페이지 식별자나 추적 파라미터 제거 규칙은 사이트 계약을 확인해 구현합니다.
4. `CrawlerModule`의 `PRODUCT_PROVIDERS` 배열에 등록합니다. `id`는 기존 판매처 `Seller.slug`와 일관되게 유지합니다.
5. 공개 허용 페이지 또는 저장된 fixture로 상세·검색·차단·누락 값 테스트를 추가합니다. 저장과 중복 방지는 기존 ProductService를 사용합니다.
6. 공식 API 사용이 가능해지면 같은 ID와 `ProductProvider` 계약의 `search`/`getProduct`를 구현합니다. 공통 `ExternalProduct`로 정규화하면 CrawlerService 없이 같은 저장 흐름을 사용할 수 있습니다.

## 13. 29CM 의류 Provider (2026-10-28)

`src/crawler/providers/sites/cm29/cm29.provider.ts`, Provider ID는 `29cm`입니다. 여성의류(`categoryLargeCode=268100100`)와 남성의류(`272100100`)만 저장합니다.

### 사이트 선택 근거

무신사, W컨셉, 롯데온, 11번가, 지그재그 등은 robots.txt가 허용 명단의 봇만 받고 `User-agent: *`를 막습니다. 29CM은 `User-agent: *`에 `Allow: /`를 주고 `/embed/`, `/my-page/`, `/order/`, `/auth/`, `/inbox/`만 막습니다(2026-10-28 확인). 이용약관은 검토하지 않았으므로 운영 전에 확인해야 합니다.

### 동작

- **상세 수집**: 상품 페이지(`/products/<숫자>`)만 허용합니다. 서버가 렌더링한 JSON-LD `Product`에서 이름·가격·브랜드·이미지·재고를, `BreadcrumbList`에서 카테고리 경로를 읽습니다. 저장 카테고리는 `여성의류 > 상의 > 니트`처럼 경로 전체입니다. `externalId`는 URL의 상품 번호이며 URL의 쿼리·fragment는 제거합니다.
- **의류 필터**: 대분류 코드가 의류가 아니거나 카테고리 경로가 없으면 `OUT_OF_SCOPE`로 실패시키고 저장하지 않습니다.
- **신규 상품 탐색**: 검색·카테고리 목록은 클라이언트 API 호출로 채워지며 Lightpanda에서 상품 링크가 렌더링되지 않았습니다. 그래서 키워드 검색(`search`)은 제공하지 않고(400 응답), robots.txt가 안내하는 상품 사이트맵을 사용합니다. 번호가 가장 큰 `sitemap-item-N.xml`부터 최대 3개 파일을 읽고 상품 번호 내림차순(최신순)으로 후보를 만듭니다. 사이트맵 요청도 robots를 먼저 확인합니다.
- **중복 방문 방지**: 이미 저장된 판매 정보 URL과, 의류가 아니라서 건너뛴 URL(Redis 집합 `<REDIS_KEY_PREFIX>:crawler:out-of-scope:29cm`)은 후보에서 제외합니다. 최신 상품 표본 기준 의류 비율은 약 27%라서 의류 1개당 상세 페이지 약 4개를 방문합니다.
- **가격·재고 갱신**: 저장된 29CM 상품은 기존 `ProductRefreshScheduler`가 주기적으로 다시 수집합니다.

`ProductProvider` 인터페이스에 선택 메서드 `listProductUrls`, `getProducts`를 추가했고 `search`는 선택 메서드로 바꿨습니다. 탐색 로직은 `src/products/discovery/`의 `ProductDiscoveryService`와 `ProductDiscoveryScheduler`에 있습니다.

### API와 설정

| 경로 (`/v1` 포함) | 본문 / 동작 |
| --- | --- |
| `POST /v1/admin/products/providers/29cm/discover` | `{ "limit": 20 }`(선택). 상세 페이지를 최대 `limit`개(`CRAWLER_MAX_PAGES` 이하) 방문해 의류만 저장. 응답에 `visited`, `skipped`(의류 아님) 포함 |
| `POST /v1/admin/products/providers/29cm/refresh` | `{ "url": "https://www.29cm.co.kr/products/<번호>" }` 상품 하나 수집 |

```dotenv
CRAWLER_DISCOVERY_ENABLED=false      # true면 주기 탐색 (CRAWLER_ENABLED도 true여야 함)
CRAWLER_DISCOVERY_INTERVAL_MS=3600000  # 5분~24시간, 기본 1시간
CRAWLER_DISCOVERY_BATCH_SIZE=20      # 회당 방문 상세 페이지 수, CRAWLER_MAX_PAGES 이하로 제한
```

`.env.example` 기본값은 꺼져 있고 로컬 `.env`는 켰습니다. 주기 탐색은 서버 시작 약 1분 뒤 처음 실행됩니다. 프로세스 단위 실행이므로 여러 인스턴스는 같은 페이지를 방문할 수 있지만 판매 정보 고유 키가 중복 저장을 막습니다.

### 검증 (2026-10-28)

- 단위 테스트 16 suite 117개 통과(29CM 파서·의류 필터·URL 정책·사이트맵 파싱, 탐색 서비스의 방문 예산·건너뛰기 기억).
- 기존 E2E 8 suite 47개, 기존 Lightpanda smoke 5개 통과(10절의 미완료 재검증 해소).
- `npm run test:cm29`: 실제 29CM과 Lightpanda로 의류 저장, 액세서리 거부, 사이트맵 탐색과 재방문 방지 3개 통과. 실제 사이트의 상품 존재 여부와 네트워크에 의존하므로 CI 기본 테스트에는 넣지 않았습니다.

### 한계

- 키워드 검색이 없습니다. 사이트맵에 이름·카테고리가 없어서 의류가 아닌 페이지도 방문해야 합니다.
- 29CM 응답에 Cloudflare 쿠키(`__cf_bm`)가 있습니다. 요청량을 늘리면 차단될 수 있으므로 분당 요청 제한(`CRAWLER_MAX_REQUESTS_PER_MINUTE`)을 높이지 마세요.
- 카테고리 코드가 바뀌면 `CM29_CLOTHING_CATEGORIES`를 수정해야 합니다. 건너뛴 URL 기억은 만료가 없으므로 그때는 Redis 집합을 삭제합니다.
- 상품 옵션(사이즈·색상)별 가격과 재고는 수집하지 않습니다.

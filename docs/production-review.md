# 운영 코드 리뷰 — 2026-10-01

쿠팡 파트너스 API 연동을 제거하고 [Crawlee + Lightpanda 수집](crawler.md)을 추가했습니다. 현재 ExampleProvider는 HTTP fixture를 대상으로 하며 관리자가 상품을 수집하면 주기 갱신 스케줄러가 저장된 URL의 가격·재고를 확인합니다. 상업 쇼핑몰 Provider는 없습니다. 기존 공통 상품 저장과 코디의 DB 상품 검색은 유지합니다. [상품 저장 문서](product-sync.md), [코디·신고·문의 문서](outfits-support.md)를 참고하세요.

## 반영한 사항

- AppController는 `/health`와 `/health/ready`를 제공합니다. readiness는 실제 PostgreSQL `SELECT 1`과 Redis `PING`을 확인하며 장애·종료 중에는 503을 반환합니다.
- 동시 readiness 요청은 점검 Promise를 공유하고 응답 시간을 제한합니다. 접속 정보나 오류 원문은 노출하지 않습니다.
- 디스코드 워커는 종료 시 전송을 취소하고 진행 중 작업을 기다립니다. Prisma/Redis 연결 해제는 `onApplicationShutdown`에서 수행합니다.
- 인증은 Redis 기기 세션을 사용합니다. 토큰 회전·재사용·동시 갱신·만료·재로그인을 통합 테스트합니다.
- 통합 테스트는 임의 PostgreSQL schema와 Redis prefix를 사용하며 생성한 테스트 영역만 정리합니다. 디스코드 실제 발송은 비활성화합니다.
- 로컬 DB는 2026-10-01 크롤러 메타데이터를 포함한 마이그레이션 10개 적용 및 Prisma 스키마 일치를 확인했습니다. 이번 적용 전 데이터·스키마 스냅샷을 `.tmp`에 저장했고 기존 애플리케이션 행의 기존 컬럼 값 보존을 확인했습니다. 이전 코디·카테고리·신고·문의 보존도 통합 테스트합니다.

## 운영 환경에서 필요한 구성

1. 사진 업로드 디렉터리에 영구 볼륨을 연결합니다. 여러 서버는 같은 저장소를 사용하고 사진은 권한 검사가 있는 API로 제공합니다.
2. 인증·업로드·신고·문의 요청 제한은 프로세스별로 적용됩니다. 여러 서버에서는 공유 저장소 또는 게이트웨이 제한이 필요합니다.
3. 개발용 compose 대신 운영 비밀값, DB·Redis 네트워크 제한, HTTPS와 신뢰할 프록시를 구성합니다.
4. 디스코드는 실제 웹훅 URL을 설정하고 활성화해야 합니다. 실패 알림은 관리자 API에서 확인·재시도합니다.
5. 실제 쇼핑몰 Provider는 약관과 robots를 검토한 뒤 등록합니다. Lightpanda의 Context 동시 생성 제한, HTTP redirect 차단 한계, 컨테이너 egress 격리 조건은 [크롤러 문서](crawler.md#11-현재-한계)를 확인합니다. 운영 외부 수집을 검증한 상태로 간주하면 안 됩니다.

헬스 체크는 의존성 연결 상태를 확인하며 마이그레이션 적용 여부나 업무 데이터 정합성을 대신 보장하지 않습니다.

## 검증 명령

2026-10-01 크롤러 추가 후 단위 테스트 89개(13 suite), 기존 PostgreSQL/Redis 통합 테스트 40개(6 suite)와 새 관리자 상품 API 4개(1 suite)가 통과했습니다. Nest 빌드, 전체 TypeScript 검사, lint도 통과했습니다. 실제 Lightpanda smoke의 최신 재검증은 Docker 엔진 응답 및 호스트 페이지 접근 장애로 미완료입니다. 상세 상태는 [크롤러 검증 기록](crawler.md#10-테스트-방법)을 참고하세요.

```sh
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npx tsc --noEmit --incremental false
npx eslint "src/**/*.ts" "test/**/*.ts"
```

통합 테스트에는 PostgreSQL과 Redis가 필요합니다. 외부 API 인증 정보는 필요하지 않습니다.

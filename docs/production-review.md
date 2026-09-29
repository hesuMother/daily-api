# 운영 코드 리뷰 — 2026-09-14

> 2026-09-18 업데이트: 아래 DB 미적용/스키마 불일치 항목은 후속 작업에서 해결했습니다.
> 로컬 개발 DB에 9개 마이그레이션을 적용했고 기존 데이터 보존을 통합 테스트했습니다.
> 코디·신고·문의 구현, 알림 설정 및 남은 저장소/배포 조건은 [최신 API 문서](outfits-support.md)를 참고하세요.
> 쿠팡 공식 API 계약 연결과 다중 서버 운영 조건은 계속 남아 있습니다.

현재 구현한 인증·상품 저장 경로는 실제 PostgreSQL/Redis를 사용해 검증했습니다.
아래 미해결 DB 배포 조건과 쿠팡 API 계약이 남아 있으므로 전체 서비스를 운영 준비 완료로 판정하지 않습니다.

## 수정한 문제

| 중요도 | 발견 내용 | 반영 및 검증 |
| --- | --- | --- |
| 높음 | 기본 컨트롤러가 Hello World만 반환해 의존성 장애를 감지할 수 없음 | AppController를 공개·버전 중립 `/health`, `/health/ready`로 교체. 실제 PostgreSQL SELECT 1과 Redis PING 확인. 장애/종료는 503, 응답 캐시 금지. |
| 높음 | 종료 시 작업이 DB 연결 해제 후에도 계속 실행될 수 있음 | 스케줄러는 종료 시 HTTP/대기 취소, 배치의 다음 항목 차단, 진행 중 작업 완료 대기. Prisma/Redis 연결 해제는 onApplicationShutdown으로 이동. |
| 높음 | 기존 인증 E2E가 삭제된 DB 세션 모델을 검사하고 필수 deviceId를 보내지 않음 | Redis 기기 세션에 맞게 수정. 회전·재사용·동시 갱신·만료·동일 기기 재로그인·이전 세션의 로그아웃까지 검증. |
| 중간 | 테스트가 실제 인증 키 네임스페이스를 사용할 수 있음 | 무작위 Redis prefix와 PostgreSQL schema를 사용. 정리 시 해당 테스트 영역만 제거. 외부 수집은 테스트 설정에서 비활성화. |
| 중간 | 의존성 지연 중 probe 요청이 연결 풀을 계속 소비할 수 있음 | 동시 readiness 요청은 점검 Promise를 공유하고 응답은 3초로 제한. DB 점검 트랜잭션·쿼리도 제한. 오류 원문/접속정보 미노출. |
| 중간 | 서버 listen/configure 실패 후 열린 자원이 남을 수 있음 | 초기화 실패 시 app.close로 연결과 작업을 정리. |
| 중간 | 전체 lint와 타입 검사가 기존 오류로 실패 | 기존 코드 형식 및 테스트의 오래된 타입 참조를 수정. |
| 중간 | 인증 문서가 DB 세션과 토큰 지문 저장을 안내함 | Redis Lua 회전, 필수 deviceId, DB/Redis 보상 처리와 실제 구현으로 문서 수정. |

종료 단계는 [NestJS lifecycle 정의](https://docs.nestjs.com/fundamentals/lifecycle-events)와 설치된 Nest 코드를 확인했습니다.
작업 종료를 기다리는 단계 이후 HTTP 연결을 닫고, 마지막 단계에서 저장소 연결을 해제합니다.
강제 프로세스 종료는 별개이며 이 경우에도 상품 단건 트랜잭션의 원자성이 적용됩니다.

## 헬스 체크 계약

- `GET /health`: DB·Redis에 접근하지 않는 생존 확인. HTTP 200, `{ "status": "ok" }`.
- `GET /health/ready`: 실제 PostgreSQL/Redis 준비 확인. 성공 시 HTTP 200과 각 의존성의 up 상태.
- 의존성 실패/점검 시간 초과/종료 중: HTTP 503. 원본 오류·DB 주소·인증정보는 포함하지 않음.
- 두 경로는 인증 없이 접근하고 `/v1` 접두사가 없으며 `Cache-Control: no-store`를 반환.
- readiness는 연결 상태를 점검합니다. 마이그레이션 적용 여부, 쿠팡 API 계약, 데이터의 업무 정합성을 대신 보장하지 않습니다.

## 운영 배포 전 남은 조건

1. **기존 개발 DB에 미적용 마이그레이션 4개.** 확인 당시 마지막 적용은
   `20260908100000_auth_sessions`입니다. 이후 Redis 전환, 상품 카탈로그, 판매처 식별자,
   가격 이력이 미적용입니다. 테스트는 별도 스키마에 마이그레이션 6개를 적용했으며 기존 public 데이터는 변경하지 않았습니다.
2. **현재 schema.prisma와 마이그레이션 이력의 차이.** 카테고리 계층, ProductOfferVariant,
   코디 작성자/검수 상태, 조회·북마크의 상품 FK 등은 이력에 완전히 반영되어 있지 않습니다.
   작성자 없는 기존 코디와 URL만 있는 기존 상품 기록을 연결할 데이터 정책이 필요합니다.
   자동 생성된 파괴적 SQL을 실행하지 않았습니다. 실제 DB와의 읽기 전용 비교 결과는
   `.tmp/review-schema-drift.sql`에 저장했습니다. 이 파일은 실행용 마이그레이션이 아닙니다.
3. **쿠팡 API 공식 계약 미확인.** `CoupangProtocol` TODO와 기본 비활성화 상태를 유지합니다.
   실제 키만 설정해도 수집되는 상태는 아닙니다.
4. **여러 인스턴스 운영.** 상품 스케줄러는 한 인스턴스만 활성화해야 합니다. 인증 rate limit은
   현재 프로세스별 메모리를 사용하므로 다중 서버 배포 시 공유 저장소 또는 게이트웨이의 제한이 필요합니다.
5. **배포 환경.** 현재 compose는 개발용 기본 계정과 호스트 포트 공개를 사용합니다.
   운영에서는 별도 비밀값, DB/Redis 네트워크 제한, HTTPS 및 지정된 프록시 구성이 필요합니다.

## 재현 명령

최종 실행 결과: 단위 테스트 54개(9 suite), E2E 21개(3 suite), 전체 TypeScript 검사,
Nest 빌드, 전체 src/test lint, Prisma 스키마 검증 통과. E2E는 PostgreSQL 18과 Redis 7을 실제 사용했습니다.

```sh
docker compose ps
npm run prisma:generate
npx prisma validate --config prisma7.config.ts
npx tsc --noEmit --incremental false
npm run build
npx eslint "src/**/*.ts" "test/**/*.ts"
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

상품 통합 테스트는 중복/가격 이력, 다른 외부 ID, 동시 최초 수집, 신규 생성과 갱신의 롤백을 검사합니다.
헬스 HTTP 테스트는 장애를 주입하고 실제 전체 앱 E2E에서도 PostgreSQL·Redis 준비 성공을 확인합니다.

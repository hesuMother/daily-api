# 상품 저장 및 가격 이력

2026-10-01 사용자 요청으로 쿠팡 파트너스 API 연동과 전용 스케줄러를 제거했습니다. 이후 Crawlee + Lightpanda의 Provider 기반 수집을 추가했습니다. 설정·실행·관리자 API·한계는 [크롤러 문서](crawler.md)를 참고하세요.

## 현재 제공 기능

- `ProductService`: 등록된 Provider로 검색 또는 URL 상세를 수집하고 저장합니다. 현재 ExampleProvider는 HTTP fixture를 대상으로 합니다.
- `ProductRefreshScheduler`: 저장된 URL의 가격·재고를 주기적으로 갱신합니다. 기본 6시간 간격이며 실패한 상품은 15분 후 재시도합니다. 실행 조건·설정은 [크롤러 문서](crawler.md#저장된-상품-주기-갱신-2026-10-07-추가)를 참고하세요.
- `ProductSyncService`: 정규화된 상품 데이터 검증과 단건/배치 저장을 담당하는 내부 서비스입니다.
- `ProductSyncRepository`: 판매처별 상품 중복 방지, 판매 정보 갱신, 이미지 추가, 가격 이력을 저장합니다.
- 상품·판매처·판매 정보·가격 이력 DB 모델과 기존 데이터는 유지합니다.
- 코디 상품 선택은 DB 검색, 본인 조회 이력·찜 목록 및 코디 아이템 직접 입력을 지원합니다. [코디 API 문서](outfits-support.md)를 참고하세요.

## 저장 규칙

판매처는 `slug`, 판매 정보는 `(sellerId, externalProductId)` 또는 `(sellerId, productUrl)`로 식별합니다. ID 없는 상품도 URL로 중복을 막으며 이름만으로 상품을 합치지 않습니다. 두 식별자가 서로 다른 기존 판매 정보를 가리키면 병합하지 않고 거절합니다.

가격이 확인된 최초 판매 정보 생성 시 가격을 기록하고, 이후 가격 또는 통화가 달라질 때 이력을 추가합니다. 미확인 가격은 null이며 이력을 만들지 않습니다. 누락된 선택 메타데이터는 보존하고 동일 이미지 URL은 중복 추가하지 않습니다. 크롤러의 미확인 재고는 null로 저장합니다. 원본 브랜드·이름·모델·SKU·최종 수집 시각은 ProductOffer에 저장하며 오래된 관측으로 최신 정보를 덮어쓰지 않습니다.

상품별 Serializable 트랜잭션으로 저장하며 가격 이력 저장 실패 시 가격 갱신도 롤백합니다. 고유 키 충돌과 직렬화 충돌은 최대 2회 재시도합니다. 배치의 잘못된 상품은 제외하지만 연결 장애·스키마 오류·알 수 없는 오류는 배치를 중단합니다.

## 테스트

`collected-product.spec.ts`, `product-sync.service.spec.ts`, `product-sync.repository.spec.ts`에서 검증·오류 처리·중복 충돌을 검사합니다. `test/product-sync.e2e-spec.ts`는 실제 PostgreSQL에서 중복 방지, 가격 이력, 동시 저장과 롤백을 확인합니다. 판매처는 가상의 `test-shop`을 사용합니다.

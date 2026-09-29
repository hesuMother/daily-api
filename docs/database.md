# 데이터베이스 스키마

스키마 원본은 `prisma/schema.prisma`입니다. PostgreSQL 연결은
`prisma7.config.ts`에서 `DATABASE_URL`을 읽습니다.

## 모델 관계

- `Brand`와 `Category`는 각각 여러 `Product`에 연결됩니다.
- `Product`에는 판매처별 `ProductOffer`, 이미지 `ProductImage`, 색상·사이즈·재고를 담는 `ProductVariant`가 연결됩니다.
- `Seller`는 여러 `ProductOffer`를 가집니다. 외부 상품 ID는 판매처 내에서 고유하며, ID가 없는 판매 정보는 여러 개 저장할 수 있습니다.
- 외부 상품의 조회 이력과 북마크는 기존처럼 URL을 저장합니다. `ProductBookmark`는 `Category`로 분류합니다.
- `Outfit`과 `OutfitCategory`는 다대다 관계입니다. 사용자별 별점과 코디 북마크는 복합 고유 키로 중복을 방지합니다.
- 신고 대상은 `targetType`과 `targetId`로 식별하므로 대상 존재 여부는 서비스에서 검증해야 합니다.

상품 모델의 테이블과 컬럼은 기존 DB와 같은 snake_case 규칙을 사용합니다.
Prisma 코드에서는 `productId`, `createdAt` 등의 필드명을 그대로 사용합니다.
가격은 기존 설계의 정수형이며, 소수 통화를 지원하려면 별도의 단위 정책이 필요합니다.

## 마이그레이션 적용

```sh
npm run prisma:generate
npm run db:migrate
```

`20260914090000_complete_catalog_schema`는 기존 세 마이그레이션 이후에 적용합니다.
브랜드·상품·판매처·가격·이미지·옵션 테이블, 프로필 이미지, 코디 신체 정보와
누락된 외래 키 조회 인덱스를 추가합니다.

기존 코디 이름은 선택 필드 `name`으로 유지하며, 설명은 기존 `outfit_description`
컬럼을 그대로 사용합니다. 기존 카테고리 연결을 다대다 테이블로 복사한 후
단일 카테고리 컬럼을 제거합니다. 이 마이그레이션은 트랜잭션으로 실행됩니다.

## 검증

```sh
npx prisma validate --config prisma7.config.ts
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

E2E 테스트는 PostgreSQL과 Redis가 실행 중이어야 합니다. DB 테스트 픽스처는
독립된 테스트 스키마에 마이그레이션 디렉터리를 이름순으로 모두 적용합니다.

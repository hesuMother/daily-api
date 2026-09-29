-- 현재 schema.prisma의 Seller.slug/baseUrl이 이전 마이그레이션에서 빠져 있습니다.
-- 이름으로 판매처를 임의 병합하지 않고 기존 행마다 충돌 없는 식별자를 부여합니다.
BEGIN;

ALTER TABLE "sellers" ADD COLUMN "slug" TEXT,
                      ADD COLUMN "base_url" TEXT;

UPDATE "sellers" SET "slug" = 'legacy-' || "id"::text;
ALTER TABLE "sellers" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "sellers_slug_key" ON "sellers"("slug");
CREATE INDEX "sellers_name_idx" ON "sellers"("name");

COMMIT;

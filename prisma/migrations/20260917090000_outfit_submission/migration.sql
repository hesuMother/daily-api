ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'APPROVE';

BEGIN;
CREATE TYPE "moderation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "outfit_item_type" AS ENUM ('TOP', 'BOTTOM', 'OUTER', 'SHOES', 'BAG', 'ACCESSORY', 'ETC');

-- 작성자 정보가 없던 코디는 임의의 사용자에게 연결하거나 자동 공개하지 않습니다.
ALTER TABLE "outfits" ADD COLUMN "author_id" UUID,
    ADD COLUMN "status" "moderation_status" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "outfits_author_id_idx" ON "outfits"("author_id");
CREATE INDEX "outfits_status_created_at_idx" ON "outfits"("status", "created_at");

CREATE TABLE "outfit_items" (
    "id" UUID NOT NULL PRIMARY KEY,
    "outfit_id" UUID NOT NULL,
    "type" "outfit_item_type" NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT,
    "product_id" UUID,
    "offer_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outfit_items_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "outfit_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outfit_items_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "product_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "outfit_items_outfit_id_sort_order_idx" ON "outfit_items"("outfit_id", "sort_order");
CREATE INDEX "outfit_items_product_id_idx" ON "outfit_items"("product_id");
CREATE INDEX "outfit_items_offer_id_idx" ON "outfit_items"("offer_id");
INSERT INTO "outfit_items" ("id", "outfit_id", "type", "name", "link", "sort_order")
SELECT gen_random_uuid(), o."id", i.kind::"outfit_item_type", i.name, i.link, i.position
FROM "outfits" o CROSS JOIN LATERAL (VALUES
    ('TOP', o."shirt", o."shirt_link", 0), ('BOTTOM', o."pants", o."pants_link", 1),
    ('SHOES', o."shoes", o."shoes_link", 2), ('ETC', o."ext", o."ext_link", 3)
) AS i(kind, name, link, position) WHERE i.name IS NOT NULL AND btrim(i.name) <> '';

ALTER TABLE "rejected_outfits" RENAME COLUMN "verified_at" TO "reviewed_at";
ALTER TABLE "rejected_outfits" ALTER COLUMN "reviewed_at" SET DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "reviewer_id" UUID,
    ADD COLUMN "reason" TEXT NOT NULL DEFAULT '기존 반려 기록';
ALTER TABLE "rejected_outfits" ALTER COLUMN "reason" DROP DEFAULT;
ALTER TABLE "rejected_outfits" ADD CONSTRAINT "rejected_outfits_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "rejected_outfits_outfit_id_reviewed_at_idx" ON "rejected_outfits"("outfit_id", "reviewed_at");
CREATE INDEX "rejected_outfits_reviewer_id_idx" ON "rejected_outfits"("reviewer_id");

-- URL 기반의 기존 기록도 남겨 상품 선택 시 직접 입력 항목으로 제공할 수 있게 합니다.
ALTER TABLE "product_histories" ALTER COLUMN "product_link" DROP NOT NULL,
    ADD COLUMN "product_id" UUID, ADD COLUMN "offer_id" UUID;
ALTER TABLE "product_histories" ADD CONSTRAINT "product_histories_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_histories" ADD CONSTRAINT "product_histories_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "product_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "product_histories_user_id_created_at_idx" ON "product_histories"("user_id", "created_at");
CREATE INDEX "product_histories_product_id_idx" ON "product_histories"("product_id");
CREATE INDEX "product_histories_offer_id_idx" ON "product_histories"("offer_id");

ALTER TABLE "product_bookmarks" RENAME COLUMN "product_bookmark_user_id" TO "user_id";
ALTER TABLE "product_bookmarks" RENAME COLUMN "product_bookmark_product_name" TO "legacy_product_name";
ALTER TABLE "product_bookmarks" RENAME COLUMN "product_bookmark_product_link" TO "legacy_product_link";
ALTER TABLE "product_bookmarks" ALTER COLUMN "legacy_product_name" DROP NOT NULL,
    ALTER COLUMN "legacy_product_link" DROP NOT NULL,
    ADD COLUMN "product_id" UUID,
    ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "product_bookmarks" ADD CONSTRAINT "product_bookmarks_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "product_bookmarks_user_id_product_id_key" ON "product_bookmarks"("user_id", "product_id");
CREATE INDEX "product_bookmarks_product_id_idx" ON "product_bookmarks"("product_id");
CREATE INDEX "product_bookmarks_user_id_is_deleted_idx" ON "product_bookmarks"("user_id", "is_deleted");
COMMIT;

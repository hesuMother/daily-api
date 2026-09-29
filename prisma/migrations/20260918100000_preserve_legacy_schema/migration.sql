-- Preserve historical names, relationships and stock while aligning the schema.
BEGIN;
-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_contact_user_id_fkey";

-- DropForeignKey
ALTER TABLE "outfit_bookmarks" DROP CONSTRAINT "outfit_bookmarks_bookmark_user_id_fkey";

-- DropForeignKey
ALTER TABLE "outfit_bookmarks" DROP CONSTRAINT "outfit_bookmarks_outfit_id_fkey";

-- DropForeignKey
ALTER TABLE "outfit_stars" DROP CONSTRAINT "outfit_stars_evaluator_fkey";

-- DropForeignKey
ALTER TABLE "outfit_stars" DROP CONSTRAINT "outfit_stars_outfit_id_fkey";

-- DropForeignKey
ALTER TABLE "product_bookmarks" DROP CONSTRAINT "product_bookmarks_product_bookmark_user_id_fkey";

-- DropForeignKey
ALTER TABLE "product_histories" DROP CONSTRAINT "product_histories_user_id_fkey";

-- DropForeignKey
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_product_id_fkey";

-- DropForeignKey
ALTER TABLE "product_offers" DROP CONSTRAINT "product_offers_product_id_fkey";

-- DropForeignKey
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_product_id_fkey";

-- DropForeignKey
ALTER TABLE "rejected_outfits" DROP CONSTRAINT "rejected_outfits_outfit_id_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_reporter_id_fkey";

-- DropIndex
DROP INDEX "outfit_bookmarks_bookmark_user_id_idx";

-- DropIndex
DROP INDEX "outfit_stars_evaluator_idx";

-- DropIndex
DROP INDEX "outfit_stars_outfit_id_evaluator_key";

-- DropIndex
DROP INDEX "product_bookmarks_product_bookmark_user_id_idx";

-- DropIndex
DROP INDEX "product_histories_user_id_idx";

-- DropIndex
DROP INDEX "product_images_product_id_idx";

-- DropIndex
DROP INDEX "rejected_outfits_outfit_id_idx";

-- AlterTable
ALTER TABLE "categories" RENAME COLUMN "category_name" TO "name";
ALTER TABLE "categories" ADD COLUMN "parent_id" UUID, ADD COLUMN "slug" TEXT, ADD COLUMN "updated_at" TIMESTAMPTZ(6);
UPDATE "categories" SET "slug" = 'legacy-' || "id"::text, "updated_at" = "created_at";
ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL, ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "outfit_bookmarks" ADD COLUMN "updated_at" TIMESTAMPTZ(6);
UPDATE "outfit_bookmarks" SET "updated_at" = "created_at";
ALTER TABLE "outfit_bookmarks" ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "outfit_categories" RENAME COLUMN "outfit_category_name" TO "name";
ALTER TABLE "outfit_categories" ADD COLUMN "slug" TEXT;
UPDATE "outfit_categories" SET "slug" = 'legacy-' || "id"::text;
ALTER TABLE "outfit_categories" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
ALTER TABLE "outfit_stars" RENAME COLUMN "evaluator" TO "evaluator_id";

-- AlterTable
ALTER TABLE "product_bookmarks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "product_offers" ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3);

-- CreateTable
CREATE TABLE "product_offer_variants" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "external_variant_id" TEXT,
    "price" INTEGER NOT NULL,
    "stock" INTEGER,
    "is_sold_out" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_offer_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_offer_variants_variant_id_idx" ON "product_offer_variants"("variant_id");

-- CreateIndex
CREATE INDEX "product_offer_variants_price_idx" ON "product_offer_variants"("price");

-- CreateIndex
CREATE UNIQUE INDEX "product_offer_variants_offer_id_variant_id_key" ON "product_offer_variants"("offer_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_offer_variants_offer_id_external_variant_id_key" ON "product_offer_variants"("offer_id", "external_variant_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "brands_is_deleted_idx" ON "brands"("is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_name_idx" ON "categories"("name");

-- CreateIndex
CREATE INDEX "outfit_bookmarks_bookmark_user_id_is_deleted_idx" ON "outfit_bookmarks"("bookmark_user_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_categories_slug_key" ON "outfit_categories"("slug");

-- CreateIndex
CREATE INDEX "outfit_categories_name_idx" ON "outfit_categories"("name");

-- CreateIndex
CREATE INDEX "outfit_stars_evaluator_id_idx" ON "outfit_stars"("evaluator_id");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_stars_outfit_id_evaluator_id_key" ON "outfit_stars"("outfit_id", "evaluator_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_offers_is_sold_out_idx" ON "product_offers"("is_sold_out");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offer_variants" ADD CONSTRAINT "product_offer_variants_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "product_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offer_variants" ADD CONSTRAINT "product_offer_variants_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_histories" ADD CONSTRAINT "product_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bookmarks" ADD CONSTRAINT "product_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_outfits" ADD CONSTRAINT "rejected_outfits_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_stars" ADD CONSTRAINT "outfit_stars_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_stars" ADD CONSTRAINT "outfit_stars_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_bookmarks" ADD CONSTRAINT "outfit_bookmarks_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_bookmarks" ADD CONSTRAINT "outfit_bookmarks_bookmark_user_id_fkey" FOREIGN KEY ("bookmark_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

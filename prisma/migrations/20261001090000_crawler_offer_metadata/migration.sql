BEGIN;
-- Preserve legacy purchase URLs. A new canonical product URL identifies crawler offers.
ALTER TABLE "product_offers"
  ALTER COLUMN "price" DROP NOT NULL,
  ALTER COLUMN "is_sold_out" DROP NOT NULL,
  ADD COLUMN "product_url" TEXT,
  ADD COLUMN "original_price" INTEGER,
  ADD COLUMN "source_name" TEXT,
  ADD COLUMN "source_brand" TEXT,
  ADD COLUMN "source_category" TEXT,
  ADD COLUMN "model_number" TEXT,
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "image_url" TEXT,
  ADD COLUMN "last_crawled_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "product_offers_seller_id_product_url_key" ON "product_offers"("seller_id", "product_url");
CREATE INDEX "product_offers_model_number_idx" ON "product_offers"("model_number");
CREATE INDEX "product_offers_sku_idx" ON "product_offers"("sku");
COMMIT;

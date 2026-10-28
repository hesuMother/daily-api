BEGIN;
ALTER TABLE "product_offers"
  ADD COLUMN "next_refresh_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_refresh_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_refresh_error" TEXT,
  ADD COLUMN "refresh_lock_token" UUID,
  ADD COLUMN "refresh_locked_until" TIMESTAMPTZ(6);
CREATE INDEX "product_offers_next_refresh_at_last_crawled_at_idx"
  ON "product_offers"("next_refresh_at", "last_crawled_at");
COMMIT;

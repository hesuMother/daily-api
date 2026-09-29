CREATE TABLE "product_price_histories" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KRW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_price_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_price_histories_offer_id_created_at_idx"
    ON "product_price_histories"("offer_id", "created_at");

ALTER TABLE "product_price_histories"
    ADD CONSTRAINT "product_price_histories_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "product_offers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

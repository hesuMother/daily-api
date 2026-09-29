ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RESOLVE';
ALTER TYPE "report_target_type" ADD VALUE IF NOT EXISTS 'PRODUCT';
ALTER TYPE "report_target_type" ADD VALUE IF NOT EXISTS 'PRODUCT_OFFER';

BEGIN;
CREATE TYPE "report_status" AS ENUM ('PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED');
CREATE TYPE "contact_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');
ALTER TABLE "report_categories" RENAME COLUMN "report_category_name" TO "name";
ALTER TABLE "contact_categories" RENAME COLUMN "contact_category_name" TO "name";
ALTER TABLE "report_categories" ADD COLUMN "slug" TEXT;
ALTER TABLE "contact_categories" ADD COLUMN "slug" TEXT;
UPDATE "report_categories" SET "slug" = 'legacy-' || "id"::text;
UPDATE "contact_categories" SET "slug" = 'legacy-' || "id"::text;
ALTER TABLE "report_categories" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "contact_categories" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "report_categories_slug_key" ON "report_categories"("slug");
CREATE UNIQUE INDEX "contact_categories_slug_key" ON "contact_categories"("slug");
INSERT INTO "report_categories" ("id", "name", "slug") VALUES
  (gen_random_uuid(), '부적절한 콘텐츠', 'inappropriate'),
  (gen_random_uuid(), '스팸 또는 광고', 'spam'),
  (gen_random_uuid(), '기타', 'other');
INSERT INTO "contact_categories" ("id", "name", "slug") VALUES
  (gen_random_uuid(), '코디', 'outfit'),
  (gen_random_uuid(), '상품', 'product'),
  (gen_random_uuid(), '계정', 'account'),
  (gen_random_uuid(), '오류 및 기능 제안', 'feedback'),
  (gen_random_uuid(), '기타', 'other');
ALTER TABLE "reports"
  ADD COLUMN "status" "report_status" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "admin_note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "reports" SET "status" = 'RESOLVED' WHERE "complete" = true;
UPDATE "reports" SET "updated_at" = COALESCE("completed_at", "created_at");
ALTER TABLE "reports" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "reports" DROP COLUMN "complete";
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
ALTER TABLE "contacts"
  ADD COLUMN "status" "contact_status" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "feature" TEXT,
  ADD COLUMN "target_type" "report_target_type",
  ADD COLUMN "target_id" UUID,
  ADD COLUMN "read_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "contacts_target_pair_check" CHECK (("target_type" IS NULL) = ("target_id" IS NULL));
UPDATE "contacts" SET "status" = 'RESOLVED', "read_at" = COALESCE("completed_at", "created_at") WHERE "complete" = true;
UPDATE "contacts" SET "updated_at" = COALESCE("completed_at", "created_at");
ALTER TABLE "contacts" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "contacts" DROP COLUMN "complete";
CREATE INDEX "contacts_status_created_at_idx" ON "contacts"("status", "created_at");
CREATE INDEX "contacts_read_at_created_at_idx" ON "contacts"("read_at", "created_at");

CREATE TYPE "discord_notification_kind" AS ENUM ('REPORT', 'CONTACT');
CREATE TYPE "discord_notification_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
CREATE TABLE "discord_notifications" (
  "id" UUID PRIMARY KEY,
  "kind" "discord_notification_kind" NOT NULL,
  "target_id" UUID NOT NULL,
  "status" "discord_notification_status" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMPTZ(6),
  "lock_token" UUID,
  "delivered_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX "discord_notifications_kind_target_id_key" ON "discord_notifications"("kind", "target_id");
CREATE INDEX "discord_notifications_status_available_at_idx" ON "discord_notifications"("status", "available_at");
COMMIT;

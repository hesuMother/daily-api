-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "report_target_type" AS ENUM ('OUTFIT', 'USER', 'PRODUCT_HISTORY', 'PRODUCT_BOOKMARK');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'VERIFY', 'REJECT', 'LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'ROLE_CHANGE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password" VARCHAR(256) NOT NULL,
    "email" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'USER',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_histories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_link" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "category_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_bookmarks" (
    "id" UUID NOT NULL,
    "product_bookmark_user_id" UUID NOT NULL,
    "product_bookmark_product_name" TEXT NOT NULL,
    "product_bookmark_product_link" TEXT NOT NULL,
    "category_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_categories" (
    "id" UUID NOT NULL,
    "outfit_category_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfit_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfits" (
    "id" UUID NOT NULL,
    "outfit_name" TEXT NOT NULL,
    "outfit_description" TEXT,
    "outfit_category_id" UUID NOT NULL,
    "shirt" TEXT,
    "shirt_link" TEXT,
    "pants" TEXT,
    "pants_link" TEXT,
    "shoes" TEXT,
    "shoes_link" TEXT,
    "ext" TEXT,
    "ext_link" TEXT,
    "image_url" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_outfits" (
    "id" UUID NOT NULL,
    "outfit_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_stars" (
    "id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "outfit_id" UUID NOT NULL,
    "evaluator" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfit_stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_bookmarks" (
    "id" UUID NOT NULL,
    "outfit_id" UUID NOT NULL,
    "bookmark_user_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfit_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_categories" (
    "id" UUID NOT NULL,
    "contact_category_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "contact_category_id" UUID NOT NULL,
    "contact_user_id" UUID NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_categories" (
    "id" UUID NOT NULL,
    "report_category_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "target_type" "report_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "report_category_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "product_histories_user_id_idx" ON "product_histories"("user_id");

-- CreateIndex
CREATE INDEX "product_bookmarks_product_bookmark_user_id_idx" ON "product_bookmarks"("product_bookmark_user_id");

-- CreateIndex
CREATE INDEX "product_bookmarks_category_id_idx" ON "product_bookmarks"("category_id");

-- CreateIndex
CREATE INDEX "outfits_outfit_category_id_idx" ON "outfits"("outfit_category_id");

-- CreateIndex
CREATE INDEX "rejected_outfits_outfit_id_idx" ON "rejected_outfits"("outfit_id");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_stars_outfit_id_evaluator_key" ON "outfit_stars"("outfit_id", "evaluator");

-- CreateIndex
CREATE INDEX "outfit_bookmarks_bookmark_user_id_idx" ON "outfit_bookmarks"("bookmark_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_bookmarks_outfit_id_bookmark_user_id_key" ON "outfit_bookmarks"("outfit_id", "bookmark_user_id");

-- CreateIndex
CREATE INDEX "contacts_contact_user_id_idx" ON "contacts"("contact_user_id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "product_histories" ADD CONSTRAINT "product_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bookmarks" ADD CONSTRAINT "product_bookmarks_product_bookmark_user_id_fkey" FOREIGN KEY ("product_bookmark_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_bookmarks" ADD CONSTRAINT "product_bookmarks_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_outfit_category_id_fkey" FOREIGN KEY ("outfit_category_id") REFERENCES "outfit_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_outfits" ADD CONSTRAINT "rejected_outfits_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_stars" ADD CONSTRAINT "outfit_stars_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_stars" ADD CONSTRAINT "outfit_stars_evaluator_fkey" FOREIGN KEY ("evaluator") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_bookmarks" ADD CONSTRAINT "outfit_bookmarks_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_bookmarks" ADD CONSTRAINT "outfit_bookmarks_bookmark_user_id_fkey" FOREIGN KEY ("bookmark_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_category_id_fkey" FOREIGN KEY ("contact_category_id") REFERENCES "contact_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_report_category_id_fkey" FOREIGN KEY ("report_category_id") REFERENCES "report_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

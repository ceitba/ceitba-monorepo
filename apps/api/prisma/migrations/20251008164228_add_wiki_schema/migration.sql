/*
  Warnings:

  - Made the column `year` on table `plan_subject` required. This step will fail if there are existing NULL values in that column.
  - Made the column `semester` on table `plan_subject` required. This step will fail if there are existing NULL values in that column.
  - Made the column `credits_required` on table `plan_subject` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "wiki";

-- CreateEnum
CREATE TYPE "wiki"."vote_type" AS ENUM ('LIKE', 'DISLIKE');

-- CreateEnum
CREATE TYPE "wiki"."proposal_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "public"."plan_subject" ALTER COLUMN "year" SET NOT NULL,
ALTER COLUMN "year" SET DEFAULT 0,
ALTER COLUMN "semester" SET NOT NULL,
ALTER COLUMN "semester" SET DEFAULT 0,
ALTER COLUMN "credits_required" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."subject" ALTER COLUMN "credits" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "wiki"."subject_difficulty" (
    "subject_id" VARCHAR(25) NOT NULL,
    "user_id" UUID NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subject_difficulty_pkey" PRIMARY KEY ("subject_id","user_id")
);

-- CreateTable
CREATE TABLE "wiki"."subject_comment" (
    "id" UUID NOT NULL,
    "subject_id" VARCHAR(25) NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subject_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki"."subject_comment_vote" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "wiki"."vote_type" NOT NULL,

    CONSTRAINT "subject_comment_vote_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateTable
CREATE TABLE "wiki"."subject_note" (
    "id" UUID NOT NULL,
    "subject_id" VARCHAR(25) NOT NULL,
    "owner_name" VARCHAR(255) NOT NULL,
    "link" VARCHAR(1024) NOT NULL,
    "uploader_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subject_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki"."subject_note_vote" (
    "note_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "wiki"."vote_type" NOT NULL,

    CONSTRAINT "subject_note_vote_pkey" PRIMARY KEY ("note_id","user_id")
);

-- CreateTable
CREATE TABLE "wiki"."career_note" (
    "id" UUID NOT NULL,
    "career_id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "owner_name" VARCHAR(255) NOT NULL,
    "link" VARCHAR(1024) NOT NULL,
    "uploader_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "career_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki"."career_note_vote" (
    "note_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "wiki"."vote_type" NOT NULL,

    CONSTRAINT "career_note_vote_pkey" PRIMARY KEY ("note_id","user_id")
);

-- CreateTable
CREATE TABLE "wiki"."subject_wiki_page" (
    "subject_id" VARCHAR(25) NOT NULL,
    "content" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_wiki_page_pkey" PRIMARY KEY ("subject_id")
);

-- CreateTable
CREATE TABLE "wiki"."subject_wiki_edit_proposal" (
    "id" UUID NOT NULL,
    "subject_id" VARCHAR(25) NOT NULL,
    "proposed_by" UUID NOT NULL,
    "proposed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposed_content" TEXT NOT NULL,
    "status" "wiki"."proposal_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_comment" VARCHAR(1024),

    CONSTRAINT "subject_wiki_edit_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki"."Subject_Bookmarks" (
    "subject_id" VARCHAR(25) NOT NULL,
    "user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_Bookmarks_pkey" PRIMARY KEY ("subject_id","user_id")
);

-- CreateIndex
CREATE INDEX "subject_difficulty_subject_id_idx" ON "wiki"."subject_difficulty"("subject_id");

-- CreateIndex
CREATE INDEX "subject_difficulty_user_id_idx" ON "wiki"."subject_difficulty"("user_id");

-- CreateIndex
CREATE INDEX "subject_comment_subject_id_idx" ON "wiki"."subject_comment"("subject_id");

-- CreateIndex
CREATE INDEX "subject_comment_user_id_idx" ON "wiki"."subject_comment"("user_id");

-- CreateIndex
CREATE INDEX "subject_comment_vote_user_id_idx" ON "wiki"."subject_comment_vote"("user_id");

-- CreateIndex
CREATE INDEX "subject_note_subject_id_idx" ON "wiki"."subject_note"("subject_id");

-- CreateIndex
CREATE INDEX "subject_note_uploader_id_idx" ON "wiki"."subject_note"("uploader_id");

-- CreateIndex
CREATE INDEX "subject_note_vote_user_id_idx" ON "wiki"."subject_note_vote"("user_id");

-- CreateIndex
CREATE INDEX "career_note_career_id_idx" ON "wiki"."career_note"("career_id");

-- CreateIndex
CREATE INDEX "career_note_uploader_id_idx" ON "wiki"."career_note"("uploader_id");

-- CreateIndex
CREATE INDEX "career_note_vote_user_id_idx" ON "wiki"."career_note_vote"("user_id");

-- CreateIndex
CREATE INDEX "subject_wiki_edit_proposal_subject_id_idx" ON "wiki"."subject_wiki_edit_proposal"("subject_id");

-- CreateIndex
CREATE INDEX "subject_wiki_edit_proposal_proposed_by_idx" ON "wiki"."subject_wiki_edit_proposal"("proposed_by");

-- CreateIndex
CREATE INDEX "subject_wiki_edit_proposal_reviewed_by_idx" ON "wiki"."subject_wiki_edit_proposal"("reviewed_by");

-- CreateIndex
CREATE INDEX "Subject_Bookmarks_subject_id_idx" ON "wiki"."Subject_Bookmarks"("subject_id");

-- CreateIndex
CREATE INDEX "Subject_Bookmarks_user_id_idx" ON "wiki"."Subject_Bookmarks"("user_id");

-- AddForeignKey
ALTER TABLE "wiki"."subject_difficulty" ADD CONSTRAINT "subject_difficulty_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_difficulty" ADD CONSTRAINT "subject_difficulty_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_comment" ADD CONSTRAINT "subject_comment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_comment" ADD CONSTRAINT "subject_comment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_comment_vote" ADD CONSTRAINT "subject_comment_vote_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "wiki"."subject_comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_comment_vote" ADD CONSTRAINT "subject_comment_vote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_note" ADD CONSTRAINT "subject_note_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_note" ADD CONSTRAINT "subject_note_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_note_vote" ADD CONSTRAINT "subject_note_vote_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "wiki"."subject_note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_note_vote" ADD CONSTRAINT "subject_note_vote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."career_note" ADD CONSTRAINT "career_note_career_id_fkey" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."career_note" ADD CONSTRAINT "career_note_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."career_note_vote" ADD CONSTRAINT "career_note_vote_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "wiki"."career_note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."career_note_vote" ADD CONSTRAINT "career_note_vote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_wiki_page" ADD CONSTRAINT "subject_wiki_page_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_wiki_page" ADD CONSTRAINT "subject_wiki_page_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_wiki_edit_proposal" ADD CONSTRAINT "subject_wiki_edit_proposal_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_wiki_edit_proposal" ADD CONSTRAINT "subject_wiki_edit_proposal_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."subject_wiki_edit_proposal" ADD CONSTRAINT "subject_wiki_edit_proposal_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."Subject_Bookmarks" ADD CONSTRAINT "Subject_Bookmarks_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki"."Subject_Bookmarks" ADD CONSTRAINT "Subject_Bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

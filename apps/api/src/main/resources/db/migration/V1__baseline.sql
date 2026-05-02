-- =============================================================================
-- V1__baseline.sql
--
-- Baseline of the production schema as it exists at the time of migration
-- from Prisma to Flyway. Equivalent to running every Prisma migration in
-- prisma/migrations/ in order, with ONE intentional change:
--
--   * public."user".career_id was UUID with no FK; careers.id is VARCHAR(25).
--     The types were incompatible and any join silently returned nothing.
--     This baseline corrects the column type and adds the missing FK.
--
-- Everything else is a verbatim consolidation of the existing schema.
--
-- For an EMPTY DB this file produces the full schema in one shot. On the
-- production DB, run `flyway baseline -baselineVersion=1` once before
-- running any new migrations (see docs/MIGRATION-RUNBOOK.md).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schemas
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "public";
CREATE SCHEMA IF NOT EXISTS "wiki";

-- -----------------------------------------------------------------------------
-- Enums (public)
-- -----------------------------------------------------------------------------
CREATE TYPE "public"."subject_type" AS ENUM ('ANNUAL', 'SEMESTRAL', 'SAMINARY');

CREATE TYPE "public"."day_of_week" AS ENUM (
    'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'
);

CREATE TYPE "public"."ceitba_branch" AS ENUM (
    'IT', 'MEDIA', 'INFRASTRUCTURE', 'NAUTICAL', 'EVENTS', 'DIRECTIVES'
);

CREATE TYPE "public"."ceitba_staff_role" AS ENUM (
    'PRESIDENT', 'VICEPRESIDENT', 'SECRETARY', 'TREASURER', 'LEADER', 'MEMBER'
);

-- -----------------------------------------------------------------------------
-- Enums (wiki)
-- -----------------------------------------------------------------------------
CREATE TYPE "wiki"."vote_type" AS ENUM ('LIKE', 'DISLIKE');

CREATE TYPE "wiki"."proposal_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- -----------------------------------------------------------------------------
-- Tables (public)
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."careers" (
    "id"         VARCHAR(25)  NOT NULL,
    "name"       VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "careers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "careers_id_idx" ON "public"."careers" ("id");

CREATE TABLE "public"."plan" (
    "id"         VARCHAR(25)  NOT NULL,
    "career_id"  VARCHAR(25)  NOT NULL,
    "name"       VARCHAR(255),
    "updated_at" TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "plan_career_id_idx" ON "public"."plan" ("career_id");
ALTER TABLE "public"."plan"
    ADD CONSTRAINT "plan_career_id_fkey"
    FOREIGN KEY ("career_id") REFERENCES "public"."careers" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "public"."user" (
    "id"                UUID         NOT NULL,
    "email"             VARCHAR(255) NOT NULL,
    "file_number"       INTEGER,
    "career_id"         VARCHAR(25),                       -- corrected: was UUID
    "plan"              VARCHAR(255),
    "name"              VARCHAR(255),
    "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ  NOT NULL,
    "prefered_language" VARCHAR(5)            DEFAULT 'es',
    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_email_key"       ON "public"."user" ("email");
CREATE UNIQUE INDEX "user_file_number_key" ON "public"."user" ("file_number");
CREATE INDEX "user_email_idx"       ON "public"."user" ("email");
CREATE INDEX "user_file_number_idx" ON "public"."user" ("file_number");
CREATE INDEX "user_career_id_idx"   ON "public"."user" ("career_id");
CREATE INDEX "user_plan_idx"        ON "public"."user" ("plan");
CREATE INDEX "user_name_idx"        ON "public"."user" ("name");
ALTER TABLE "public"."user"
    ADD CONSTRAINT "user_career_id_fkey"
    FOREIGN KEY ("career_id") REFERENCES "public"."careers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."subject" (
    "id"         VARCHAR(25)  NOT NULL,
    "name"       VARCHAR(255) NOT NULL,
    "credits"    INTEGER      NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subject_id_idx" ON "public"."subject" ("id");

CREATE TABLE "public"."plan_subject" (
    "dependencies"     VARCHAR(255)[],
    "section"          VARCHAR(255) NOT NULL,
    "subject_id"       VARCHAR(32)  NOT NULL,
    "plan_id"          VARCHAR(32)  NOT NULL,
    "year"             INTEGER      NOT NULL DEFAULT 0,
    "semester"         INTEGER      NOT NULL DEFAULT 0,
    "credits_required" INTEGER      NOT NULL,
    CONSTRAINT "plan_subject_pkey" PRIMARY KEY ("subject_id", "plan_id")
);

CREATE TABLE "public"."commission" (
    "id"                VARCHAR(20)             NOT NULL,
    "subject_code"      VARCHAR(10)             NOT NULL,
    "commission_name"   VARCHAR(50)             NOT NULL,
    "course_start"      DATE                    NOT NULL,
    "course_end"        DATE                    NOT NULL,
    "enrolled_students" INTEGER                 NOT NULL,
    "quota"             INTEGER                 NOT NULL,
    "subject_type"      "public"."subject_type" NOT NULL DEFAULT 'SEMESTRAL',
    CONSTRAINT "commission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."commission_time" (
    "course_id" VARCHAR(20)            NOT NULL,
    "day"       "public"."day_of_week" NOT NULL,
    "classroom" VARCHAR(50)            NOT NULL,
    "building"  VARCHAR(50)            NOT NULL,
    "hour_from" TIME                   NOT NULL,
    "hour_to"   TIME                   NOT NULL,
    CONSTRAINT "commission_time_pkey" PRIMARY KEY ("course_id", "day", "hour_from")
);
ALTER TABLE "public"."commission_time"
    ADD CONSTRAINT "commission_time_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "public"."commission" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."ceitba_staff" (
    "user_id" UUID                          NOT NULL,
    "branch"  "public"."ceitba_branch"      NOT NULL,
    "role"    "public"."ceitba_staff_role"  NOT NULL DEFAULT 'MEMBER',
    "start"   TIMESTAMPTZ                   NOT NULL,
    "end"     TIMESTAMPTZ                   NOT NULL,
    CONSTRAINT "ceitba_staff_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "public"."ceitba_staff"
    ADD CONSTRAINT "ceitba_staff_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Tables (wiki)
-- -----------------------------------------------------------------------------
CREATE TABLE "wiki"."subject_difficulty" (
    "subject_id" VARCHAR(25) NOT NULL,
    "user_id"    UUID        NOT NULL,
    "value"      INTEGER     NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "subject_difficulty_pkey" PRIMARY KEY ("subject_id", "user_id")
);
CREATE INDEX "subject_difficulty_subject_id_idx" ON "wiki"."subject_difficulty" ("subject_id");
CREATE INDEX "subject_difficulty_user_id_idx"    ON "wiki"."subject_difficulty" ("user_id");
ALTER TABLE "wiki"."subject_difficulty"
    ADD CONSTRAINT "subject_difficulty_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_difficulty"
    ADD CONSTRAINT "subject_difficulty_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."subject_comment" (
    "id"         UUID        NOT NULL,
    "subject_id" VARCHAR(25) NOT NULL,
    "user_id"    UUID        NOT NULL,
    "content"    TEXT        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "subject_comment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subject_comment_subject_id_idx" ON "wiki"."subject_comment" ("subject_id");
CREATE INDEX "subject_comment_user_id_idx"    ON "wiki"."subject_comment" ("user_id");
ALTER TABLE "wiki"."subject_comment"
    ADD CONSTRAINT "subject_comment_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_comment"
    ADD CONSTRAINT "subject_comment_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."subject_comment_vote" (
    "comment_id" UUID                NOT NULL,
    "user_id"    UUID                NOT NULL,
    "type"       "wiki"."vote_type"  NOT NULL,
    CONSTRAINT "subject_comment_vote_pkey" PRIMARY KEY ("comment_id", "user_id")
);
CREATE INDEX "subject_comment_vote_user_id_idx" ON "wiki"."subject_comment_vote" ("user_id");
ALTER TABLE "wiki"."subject_comment_vote"
    ADD CONSTRAINT "subject_comment_vote_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "wiki"."subject_comment" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_comment_vote"
    ADD CONSTRAINT "subject_comment_vote_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."subject_note" (
    "id"          UUID          NOT NULL,
    "subject_id"  VARCHAR(25)   NOT NULL,
    "owner_name"  VARCHAR(255)  NOT NULL,
    "link"        VARCHAR(1024) NOT NULL,
    "uploader_id" UUID          NOT NULL,
    "created_at"  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ   NOT NULL,
    CONSTRAINT "subject_note_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subject_note_subject_id_idx"  ON "wiki"."subject_note" ("subject_id");
CREATE INDEX "subject_note_uploader_id_idx" ON "wiki"."subject_note" ("uploader_id");
ALTER TABLE "wiki"."subject_note"
    ADD CONSTRAINT "subject_note_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_note"
    ADD CONSTRAINT "subject_note_uploader_id_fkey"
    FOREIGN KEY ("uploader_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."subject_note_vote" (
    "note_id" UUID                NOT NULL,
    "user_id" UUID                NOT NULL,
    "type"    "wiki"."vote_type"  NOT NULL,
    CONSTRAINT "subject_note_vote_pkey" PRIMARY KEY ("note_id", "user_id")
);
CREATE INDEX "subject_note_vote_user_id_idx" ON "wiki"."subject_note_vote" ("user_id");
ALTER TABLE "wiki"."subject_note_vote"
    ADD CONSTRAINT "subject_note_vote_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "wiki"."subject_note" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_note_vote"
    ADD CONSTRAINT "subject_note_vote_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."career_note" (
    "id"          UUID          NOT NULL,
    "career_id"   VARCHAR(25)   NOT NULL,
    "name"        VARCHAR(255)  NOT NULL,
    "owner_name"  VARCHAR(255)  NOT NULL,
    "link"        VARCHAR(1024) NOT NULL,
    "uploader_id" UUID          NOT NULL,
    "created_at"  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ   NOT NULL,
    CONSTRAINT "career_note_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "career_note_career_id_idx"   ON "wiki"."career_note" ("career_id");
CREATE INDEX "career_note_uploader_id_idx" ON "wiki"."career_note" ("uploader_id");
ALTER TABLE "wiki"."career_note"
    ADD CONSTRAINT "career_note_career_id_fkey"
    FOREIGN KEY ("career_id") REFERENCES "public"."careers" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."career_note"
    ADD CONSTRAINT "career_note_uploader_id_fkey"
    FOREIGN KEY ("uploader_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."career_note_vote" (
    "note_id" UUID                NOT NULL,
    "user_id" UUID                NOT NULL,
    "type"    "wiki"."vote_type"  NOT NULL,
    CONSTRAINT "career_note_vote_pkey" PRIMARY KEY ("note_id", "user_id")
);
CREATE INDEX "career_note_vote_user_id_idx" ON "wiki"."career_note_vote" ("user_id");
ALTER TABLE "wiki"."career_note_vote"
    ADD CONSTRAINT "career_note_vote_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "wiki"."career_note" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."career_note_vote"
    ADD CONSTRAINT "career_note_vote_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."subject_wiki_page" (
    "subject_id" VARCHAR(25) NOT NULL,
    "content"    TEXT        NOT NULL,
    "updated_by" UUID        NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_wiki_page_pkey" PRIMARY KEY ("subject_id")
);
ALTER TABLE "wiki"."subject_wiki_page"
    ADD CONSTRAINT "subject_wiki_page_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_wiki_page"
    ADD CONSTRAINT "subject_wiki_page_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wiki"."subject_wiki_edit_proposal" (
    "id"               UUID                       NOT NULL,
    "subject_id"       VARCHAR(25)                NOT NULL,
    "proposed_by"      UUID                       NOT NULL,
    "proposed_at"      TIMESTAMPTZ                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposed_content" TEXT                       NOT NULL,
    "status"           "wiki"."proposal_status"   NOT NULL DEFAULT 'PENDING',
    "reviewed_by"      UUID,
    "reviewed_at"      TIMESTAMPTZ,
    "review_comment"   VARCHAR(1024),
    CONSTRAINT "subject_wiki_edit_proposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subject_wiki_edit_proposal_subject_id_idx"  ON "wiki"."subject_wiki_edit_proposal" ("subject_id");
CREATE INDEX "subject_wiki_edit_proposal_proposed_by_idx" ON "wiki"."subject_wiki_edit_proposal" ("proposed_by");
CREATE INDEX "subject_wiki_edit_proposal_reviewed_by_idx" ON "wiki"."subject_wiki_edit_proposal" ("reviewed_by");
ALTER TABLE "wiki"."subject_wiki_edit_proposal"
    ADD CONSTRAINT "subject_wiki_edit_proposal_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_wiki_edit_proposal"
    ADD CONSTRAINT "subject_wiki_edit_proposal_proposed_by_fkey"
    FOREIGN KEY ("proposed_by") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."subject_wiki_edit_proposal"
    ADD CONSTRAINT "subject_wiki_edit_proposal_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."user" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Mixed-case table name preserved intentionally — Prisma references it this way
-- and the dual-run window during cutover requires bit-for-bit compatibility.
CREATE TABLE "wiki"."Subject_Bookmarks" (
    "subject_id" VARCHAR(25) NOT NULL,
    "user_id"    UUID        NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subject_Bookmarks_pkey" PRIMARY KEY ("subject_id", "user_id")
);
CREATE INDEX "Subject_Bookmarks_subject_id_idx" ON "wiki"."Subject_Bookmarks" ("subject_id");
CREATE INDEX "Subject_Bookmarks_user_id_idx"    ON "wiki"."Subject_Bookmarks" ("user_id");
ALTER TABLE "wiki"."Subject_Bookmarks"
    ADD CONSTRAINT "Subject_Bookmarks_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wiki"."Subject_Bookmarks"
    ADD CONSTRAINT "Subject_Bookmarks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

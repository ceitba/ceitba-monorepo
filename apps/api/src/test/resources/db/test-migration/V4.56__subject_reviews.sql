-- =============================================================================
-- V4.56__subject_reviews.sql (test mirror of V67)
--
-- Subject reviews (docs/SUBJECT-REVIEWS.md): a student's short opinion of a
-- subject they took in a term and commission (recommend yes/no, difficulty
-- 1-3, optional comment), with the professors they say taught it. ITBA's
-- data has no professors, so they come from students: a professor is added by
-- their ITBA email and named from the Google directory, never by hand.
-- Reviews are anonymous to readers; user_id is kept for "one per term",
-- editing and moderation. Reports work like Apuntes: one per user, three hide
-- the review until staff restores or deletes it.
-- =============================================================================

CREATE TABLE "public"."professor" (
    "id"         UUID         NOT NULL,
    "email"      VARCHAR(255) NOT NULL,
    "name"       VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "professor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "professor_email_lowercase_check" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "professor_email_idx" ON "public"."professor" ("email");

CREATE TABLE "public"."subject_review" (
    "id"           UUID         NOT NULL,
    "subject_id"   VARCHAR(25)  NOT NULL,
    "user_id"      UUID         NOT NULL,
    "year"         INTEGER      NOT NULL,
    "period"       INTEGER      NOT NULL,
    "commission"   VARCHAR(20)  NOT NULL,
    "recommend"    BOOLEAN      NOT NULL,
    "difficulty"   SMALLINT     NOT NULL,
    "comment"      TEXT,
    "report_count" INTEGER      NOT NULL DEFAULT 0,
    "hidden"       BOOLEAN      NOT NULL DEFAULT FALSE,
    -- When the third report hid it (the staff queue order); NULL while shown.
    "hidden_at"    TIMESTAMPTZ,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_review_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subject_review_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE CASCADE,
    CONSTRAINT "subject_review_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "subject_review_period_check" CHECK ("period" IN (1, 2)),
    CONSTRAINT "subject_review_difficulty_check" CHECK ("difficulty" BETWEEN 1 AND 3),
    CONSTRAINT "subject_review_report_count_non_negative" CHECK ("report_count" >= 0)
);

-- One review per student, subject and term.
CREATE UNIQUE INDEX "subject_review_user_term_idx"
    ON "public"."subject_review" ("subject_id", "user_id", "year", "period");
-- Reader: a subject's reviews in list order (newest term, then newest first).
CREATE INDEX "subject_review_subject_idx"
    ON "public"."subject_review" ("subject_id", "year" DESC, "period" DESC, "created_at" DESC, "id");
-- Staff queue of hidden reviews, most recently hidden first.
CREATE INDEX "subject_review_hidden_idx"
    ON "public"."subject_review" ("hidden_at" DESC) WHERE "hidden";
-- Account deletion.
CREATE INDEX "subject_review_user_idx" ON "public"."subject_review" ("user_id");

CREATE TABLE "public"."subject_review_professor" (
    "review_id"    UUID NOT NULL,
    "professor_id" UUID NOT NULL,
    CONSTRAINT "subject_review_professor_pkey" PRIMARY KEY ("review_id", "professor_id"),
    CONSTRAINT "subject_review_professor_review_id_fkey"
        FOREIGN KEY ("review_id") REFERENCES "public"."subject_review" ("id") ON DELETE CASCADE,
    CONSTRAINT "subject_review_professor_professor_id_fkey"
        FOREIGN KEY ("professor_id") REFERENCES "public"."professor" ("id") ON DELETE CASCADE
);

CREATE INDEX "subject_review_professor_professor_idx"
    ON "public"."subject_review_professor" ("professor_id");

-- "Me sirvió": one per user and review.
CREATE TABLE "public"."subject_review_helpful" (
    "review_id"  UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_review_helpful_pkey" PRIMARY KEY ("review_id", "user_id"),
    CONSTRAINT "subject_review_helpful_review_id_fkey"
        FOREIGN KEY ("review_id") REFERENCES "public"."subject_review" ("id") ON DELETE CASCADE,
    CONSTRAINT "subject_review_helpful_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE
);

CREATE INDEX "subject_review_helpful_user_idx" ON "public"."subject_review_helpful" ("user_id");

-- One report per user and review; subject_review.report_count is recounted
-- from these rows on every change.
CREATE TABLE "public"."subject_review_report" (
    "review_id"  UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "reason"     VARCHAR(16) NOT NULL,
    "comment"    TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_review_report_pkey" PRIMARY KEY ("review_id", "user_id"),
    CONSTRAINT "subject_review_report_review_id_fkey"
        FOREIGN KEY ("review_id") REFERENCES "public"."subject_review" ("id") ON DELETE CASCADE,
    CONSTRAINT "subject_review_report_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "subject_review_report_reason_check" CHECK ("reason" IN ('OFFENSIVE', 'PERSONAL_DATA', 'FALSE', 'SPAM', 'OTHER'))
);

CREATE INDEX "subject_review_report_user_idx" ON "public"."subject_review_report" ("user_id");

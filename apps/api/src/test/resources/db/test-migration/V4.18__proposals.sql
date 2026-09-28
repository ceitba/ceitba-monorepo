-- Student proposals board ("Propuestas"): users post proposals, moderators
-- (ROLE_MODERATOR) approve or reject them, everyone votes up/down and
-- comments under a per-proposal pseudonym. Replaces the Firestore
-- `Propuestas` collection. Unrelated to wiki.subject_wiki_edit_proposal.
--
-- Enums are VARCHAR + CHECK (not Postgres enum types) so adding a topic is a
-- one-line constraint change.
--
-- Authorship survives account deletion only for approved proposals and as
-- tombstoned comments, so author_id FKs are nullable ON DELETE SET NULL;
-- AccountDeletionRepository removes the rest (and fixes the counters) first.

CREATE TABLE "public"."proposal" (
    "id"               UUID          NOT NULL DEFAULT gen_random_uuid(),
    "author_id"        UUID,
    "title"            VARCHAR(100)  NOT NULL,
    "description"      TEXT          NOT NULL,
    "topic"            VARCHAR(32)   NOT NULL,
    -- Moderation: PENDING -> APPROVED | REJECTED (once).
    "status"           VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
    -- Outcome of an approved proposal, set by moderators.
    "lifecycle"        VARCHAR(16)   NOT NULL DEFAULT 'ABIERTO',
    "rejection_reason" VARCHAR(1024),
    "moderated_by"     UUID,
    "moderated_at"     TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Denormalized counters, maintained in the same transaction as the
    -- vote/comment rows (the proposal row is locked while doing so).
    "up_count"         INTEGER       NOT NULL DEFAULT 0,
    "down_count"       INTEGER       NOT NULL DEFAULT 0,
    "comment_count"    INTEGER       NOT NULL DEFAULT 0,
    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_author_id_fkey"
        FOREIGN KEY ("author_id") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "proposal_moderated_by_fkey"
        FOREIGN KEY ("moderated_by") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "proposal_topic_check" CHECK ("topic" IN
        ('VIDA_UNIVERSITARIA', 'CEITBA', 'EVENTOS', 'CURSOS', 'OTROS')),
    CONSTRAINT "proposal_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT "proposal_lifecycle_check" CHECK ("lifecycle" IN ('ABIERTO', 'ACEPTADO', 'CERRADO')),
    CONSTRAINT "proposal_description_length" CHECK (char_length("description") <= 5000),
    CONSTRAINT "proposal_counts_non_negative"
        CHECK ("up_count" >= 0 AND "down_count" >= 0 AND "comment_count" >= 0)
);

-- Public feed (status = APPROVED, newest first) and moderation queue.
CREATE INDEX "proposal_status_created_idx" ON "public"."proposal" ("status", "created_at" DESC, "id" DESC);
CREATE INDEX "proposal_author_created_idx" ON "public"."proposal" ("author_id", "created_at" DESC);

CREATE TABLE "public"."proposal_attachment" (
    "proposal_id"  UUID         NOT NULL,
    "position"     INTEGER      NOT NULL,
    "object_key"   VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(64)  NOT NULL,
    CONSTRAINT "proposal_attachment_pkey" PRIMARY KEY ("proposal_id", "position"),
    CONSTRAINT "proposal_attachment_object_key_key" UNIQUE ("object_key"),
    CONSTRAINT "proposal_attachment_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal" ("id") ON DELETE CASCADE,
    CONSTRAINT "proposal_attachment_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "public"."proposal_vote" (
    "proposal_id" UUID        NOT NULL,
    "user_id"     UUID        NOT NULL,
    "value"       VARCHAR(4)  NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proposal_vote_pkey" PRIMARY KEY ("proposal_id", "user_id"),
    CONSTRAINT "proposal_vote_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal" ("id") ON DELETE CASCADE,
    CONSTRAINT "proposal_vote_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "proposal_vote_value_check" CHECK ("value" IN ('UP', 'DOWN'))
);

CREATE INDEX "proposal_vote_user_idx" ON "public"."proposal_vote" ("user_id");

-- One level of replies: parent_id points at a top-level comment of the same
-- proposal. Deletion is soft (deleted_at, body cleared) so replies keep
-- their parent.
CREATE TABLE "public"."proposal_comment" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "proposal_id" UUID        NOT NULL,
    "author_id"   UUID,
    "parent_id"   UUID,
    "body"        TEXT,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMPTZ,
    CONSTRAINT "proposal_comment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_comment_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal" ("id") ON DELETE CASCADE,
    CONSTRAINT "proposal_comment_author_id_fkey"
        FOREIGN KEY ("author_id") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "proposal_comment_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "public"."proposal_comment" ("id") ON DELETE CASCADE,
    CONSTRAINT "proposal_comment_body_check"
        CHECK (("deleted_at" IS NULL AND "body" IS NOT NULL AND char_length("body") <= 1000)
            OR "deleted_at" IS NOT NULL)
);

CREATE INDEX "proposal_comment_thread_idx"
    ON "public"."proposal_comment" ("proposal_id", "parent_id", "created_at");
CREATE INDEX "proposal_comment_parent_idx" ON "public"."proposal_comment" ("parent_id");
CREATE INDEX "proposal_comment_author_idx" ON "public"."proposal_comment" ("author_id");

-- Per-proposal pseudonym ("Alfa Rojo"), generated server-side the first time
-- a user authors or comments on a proposal, stable afterwards. Responses show
-- only the alias, never the user.
CREATE TABLE "public"."proposal_alias" (
    "proposal_id" UUID        NOT NULL,
    "user_id"     UUID        NOT NULL,
    "alias"       VARCHAR(40) NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proposal_alias_pkey" PRIMARY KEY ("proposal_id", "user_id"),
    CONSTRAINT "proposal_alias_alias_key" UNIQUE ("proposal_id", "alias"),
    CONSTRAINT "proposal_alias_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal" ("id") ON DELETE CASCADE,
    CONSTRAINT "proposal_alias_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE
);

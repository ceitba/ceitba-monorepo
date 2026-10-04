-- "La semana en ITBA" weekly digest email (docs/WEEKLY-DIGEST.md).
--
-- user.digest_email_enabled: per-user opt-out of the digest email, separate
-- from following (follows also drive push notifications).
-- digest_issues: one issue per covered week (week_start is that week's
-- Monday). Articles published in [week_start, week_start + 6] and events on
-- [week_start + 7, week_start + 13] are its candidates; staff may exclude
-- some (excluded_*_ids hold article/event ids, which are TEXT).
-- status: draft -> sending -> sent, or draft -> cancelled.
-- auto_send_at: when a draft is sent automatically (NULL = only by hand).
-- digest_deliveries: the recipient snapshot taken when sending starts. Sending
-- is at-most-once: before the SMTP call a row is claimed (pending -> sending,
-- claimed_at, its own committed transaction), then it becomes sent | failed.
-- A row still `sending` after a crash has an unknown outcome and is marked
-- failed, never resent. attempts counts the TRANSIENT (recipient-scoped
-- temporary) failures; last_error is the latest one. sent_at is the time of
-- the (last) attempt, also for failed rows: it backs the rolling 24h quota.

ALTER TABLE "public"."user"
    ADD COLUMN "digest_email_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "public"."digest_issues" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "week_start"           DATE        NOT NULL,
    "subject"              TEXT        NOT NULL,
    "intro"                TEXT,
    "excluded_article_ids" TEXT[]      NOT NULL DEFAULT '{}',
    "excluded_event_ids"   TEXT[]      NOT NULL DEFAULT '{}',
    "status"               TEXT        NOT NULL DEFAULT 'draft',
    "auto_send_at"         TIMESTAMPTZ,
    "sent_at"              TIMESTAMPTZ,
    "sent_by"              UUID,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "digest_issues_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "digest_issues_week_start_key" UNIQUE ("week_start"),
    CONSTRAINT "digest_issues_week_start_monday" CHECK (EXTRACT(ISODOW FROM "week_start") = 1),
    CONSTRAINT "digest_issues_status_check" CHECK ("status" IN ('draft', 'sending', 'sent', 'cancelled')),
    CONSTRAINT "digest_issues_sent_by_fkey"
        FOREIGN KEY ("sent_by") REFERENCES "public"."user" ("id") ON DELETE SET NULL
);

CREATE INDEX "digest_issues_auto_send_idx"
    ON "public"."digest_issues" ("auto_send_at") WHERE "status" = 'draft';

CREATE TABLE "public"."digest_deliveries" (
    "issue_id" UUID        NOT NULL,
    "user_id"  UUID        NOT NULL,
    "email"    TEXT        NOT NULL,
    "status"   TEXT        NOT NULL DEFAULT 'pending',
    "error"    TEXT,
    "sent_at"  TIMESTAMPTZ,
    "claimed_at" TIMESTAMPTZ,
    "attempts" INT         NOT NULL DEFAULT 0,
    "last_error" TEXT,
    CONSTRAINT "digest_deliveries_pkey" PRIMARY KEY ("issue_id", "user_id"),
    CONSTRAINT "digest_deliveries_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed')),
    CONSTRAINT "digest_deliveries_issue_fkey"
        FOREIGN KEY ("issue_id") REFERENCES "public"."digest_issues" ("id") ON DELETE CASCADE,
    CONSTRAINT "digest_deliveries_user_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE
);

CREATE INDEX "digest_deliveries_issue_status_idx"
    ON "public"."digest_deliveries" ("issue_id", "status");
CREATE INDEX "digest_deliveries_sent_at_idx"
    ON "public"."digest_deliveries" ("sent_at") WHERE "sent_at" IS NOT NULL;
CREATE INDEX "digest_deliveries_user_idx"
    ON "public"."digest_deliveries" ("user_id");
CREATE INDEX "digest_deliveries_claimed_idx"
    ON "public"."digest_deliveries" ("claimed_at") WHERE "status" = 'sending';

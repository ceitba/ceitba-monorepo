-- Gmail sending-quota ledger + open/click tracking of the weekly digest
-- (docs/WEEKLY-DIGEST.md, "Sending quota" and "Open and click tracking").
--
-- mail_send_log: one row per SMTP attempt made through service/mail's
-- MailSendService, whoever the caller (digest, test sends, later org
-- emails). account = the From address. The rolling 24h quota counts the
-- recipients of rows whose outcome reached Gmail ('sent', 'rejected').
-- mail_account_state: per sending account, a persisted pause (Gmail's own
-- daily-limit error, or the exponential backoff after transport errors), so
-- it survives restarts.
-- digest_deliveries.tracking_id: random opaque id of a sent delivery (never
-- the user id), the key of the open pixel and the click redirects; plus the
-- first/last open, open and click counts and the first click (unflagged
-- events only).
-- digest_issue_links: the links shared by every email of an issue, by id.
-- digest_delivery_links: the per-reader links of one delivery (unsubscribe,
-- "Tu cuatrimestre"). Click redirects resolve their target only from these
-- two tables (no open redirect). url_key = the URL without its token, used
-- to group clicks per link.
-- mail_tracking_event: every open/click (flagged ones too: scanners, bots,
-- or within seconds of sending). No IP and no full user agent are stored,
-- only a coarse client class.

CREATE TABLE "public"."mail_send_log" (
    "id"           BIGSERIAL   NOT NULL,
    "account"      TEXT        NOT NULL,
    "kind"         TEXT        NOT NULL,
    "recipients"   INTEGER     NOT NULL DEFAULT 1,
    "outcome"      TEXT        NOT NULL,
    "error"        TEXT,
    "attempted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "mail_send_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_send_log_recipients_check" CHECK ("recipients" > 0),
    CONSTRAINT "mail_send_log_outcome_check"
        CHECK ("outcome" IN ('sent', 'rejected', 'quota', 'transient'))
);

CREATE INDEX "mail_send_log_account_at_idx" ON "public"."mail_send_log" ("account", "attempted_at");

CREATE TABLE "public"."mail_account_state" (
    "account"              TEXT        NOT NULL,
    "paused_until"         TIMESTAMPTZ,
    "pause_reason"         TEXT,
    "consecutive_failures" INTEGER     NOT NULL DEFAULT 0,
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "mail_account_state_pkey" PRIMARY KEY ("account"),
    CONSTRAINT "mail_account_state_reason_check"
        CHECK ("pause_reason" IS NULL OR "pause_reason" IN ('quota', 'transport'))
);

ALTER TABLE "public"."digest_deliveries"
    ADD COLUMN "tracking_id"      TEXT,
    ADD COLUMN "first_opened_at"  TIMESTAMPTZ,
    ADD COLUMN "last_opened_at"   TIMESTAMPTZ,
    ADD COLUMN "open_count"       INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "first_clicked_at" TIMESTAMPTZ,
    ADD COLUMN "click_count"      INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "digest_deliveries_tracking_id_key" UNIQUE ("tracking_id");

CREATE TABLE "public"."digest_issue_links" (
    "issue_id" UUID    NOT NULL,
    "link_id"  INTEGER NOT NULL,
    "url"      TEXT    NOT NULL,
    "url_key"  TEXT    NOT NULL,
    "label"    TEXT    NOT NULL,
    CONSTRAINT "digest_issue_links_pkey" PRIMARY KEY ("issue_id", "link_id"),
    CONSTRAINT "digest_issue_links_url_key" UNIQUE ("issue_id", "url"),
    CONSTRAINT "digest_issue_links_issue_fkey"
        FOREIGN KEY ("issue_id") REFERENCES "public"."digest_issues" ("id") ON DELETE CASCADE
);

CREATE TABLE "public"."digest_delivery_links" (
    "tracking_id" TEXT    NOT NULL,
    "link_id"     INTEGER NOT NULL,
    "url"         TEXT    NOT NULL,
    "url_key"     TEXT    NOT NULL,
    "label"       TEXT    NOT NULL,
    CONSTRAINT "digest_delivery_links_pkey" PRIMARY KEY ("tracking_id", "link_id"),
    CONSTRAINT "digest_delivery_links_delivery_fkey"
        FOREIGN KEY ("tracking_id") REFERENCES "public"."digest_deliveries" ("tracking_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "public"."mail_tracking_event" (
    "id"          BIGSERIAL   NOT NULL,
    "tracking_id" TEXT        NOT NULL,
    "type"        TEXT        NOT NULL,
    "link_id"     INTEGER,
    "at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "flagged"     BOOLEAN     NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "ua_class"    TEXT        NOT NULL,
    CONSTRAINT "mail_tracking_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_tracking_event_type_check" CHECK ("type" IN ('open', 'click')),
    CONSTRAINT "mail_tracking_event_delivery_fkey"
        FOREIGN KEY ("tracking_id") REFERENCES "public"."digest_deliveries" ("tracking_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "mail_tracking_event_tracking_idx" ON "public"."mail_tracking_event" ("tracking_id", "type");

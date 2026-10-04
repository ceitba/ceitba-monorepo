-- Connected Gmail sender accounts (Gmail API over OAuth,
-- docs/WEEKLY-DIGEST.md, "Sending through the Gmail API").
--
-- One row per Google account allowed to send mail on behalf of an owner:
-- today only the CEITBA account (owner_type 'ceitba', owner_ref NULL); later
-- one per organization (owner_type 'organization', owner_ref = org slug).
-- refresh_token_enc: the OAuth refresh token, AES-GCM encrypted with
-- MAIL_TOKEN_ENCRYPTION_KEY (never stored or logged in clear).
-- status: connected | broken (Google rejected the token: reconnect) | revoked.

CREATE TABLE "public"."mail_sender_account" (
    "id"                BIGSERIAL   NOT NULL,
    "email"             TEXT        NOT NULL,
    "owner_type"        TEXT        NOT NULL,
    "owner_ref"         TEXT,
    "refresh_token_enc" TEXT        NOT NULL,
    "scopes"            TEXT        NOT NULL,
    "status"            TEXT        NOT NULL DEFAULT 'connected',
    "connected_by"      UUID,
    "connected_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_error"        TEXT,
    "last_used_at"      TIMESTAMPTZ,
    CONSTRAINT "mail_sender_account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_sender_account_owner_type_check" CHECK ("owner_type" IN ('ceitba', 'organization')),
    CONSTRAINT "mail_sender_account_status_check" CHECK ("status" IN ('connected', 'broken', 'revoked')),
    CONSTRAINT "mail_sender_account_owner_ref_check"
        CHECK (("owner_type" = 'ceitba' AND "owner_ref" IS NULL)
            OR ("owner_type" = 'organization' AND "owner_ref" IS NOT NULL))
);

CREATE UNIQUE INDEX "mail_sender_account_email_key" ON "public"."mail_sender_account" (lower("email"));
CREATE UNIQUE INDEX "mail_sender_account_owner_key"
    ON "public"."mail_sender_account" ("owner_type", COALESCE("owner_ref", ''));

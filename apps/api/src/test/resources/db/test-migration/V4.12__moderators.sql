-- MODERATOR: a narrow grant, separate from STAFF, for users who moderate
-- user-generated content (e.g. proposals, study groups) without getting any
-- other staff power. Active STAFF implies MODERATOR in code
-- (StaffAwareJwtAuthenticationConverter), so staff need no row here.
--
-- One row per user. Revoking sets revoked_at/revoked_by and keeps the row for
-- audit; granting again reactivates it. Rows follow the user on hard delete.
CREATE TABLE "public"."ceitba_moderators" (
    "user_id"    UUID        NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    CONSTRAINT "ceitba_moderators_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "ceitba_moderators_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "ceitba_moderators_granted_by_fkey"
        FOREIGN KEY ("granted_by") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "ceitba_moderators_revoked_by_fkey"
        FOREIGN KEY ("revoked_by") REFERENCES "public"."user" ("id") ON DELETE SET NULL
);

-- Active grants are looked up on every authenticated request.
CREATE INDEX "ceitba_moderators_active_idx"
    ON "public"."ceitba_moderators" ("user_id") WHERE "revoked_at" IS NULL;

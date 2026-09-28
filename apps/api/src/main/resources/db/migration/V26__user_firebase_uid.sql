-- Firebase Auth uid of users imported from the legacy Firestore 'Usuarios'
-- collection (POST /v1/sync/import/firestore). Lets a re-run of the import
-- find the same row even if the email changed, and records which accounts
-- came from the old app. Nullable: users who first sign in to the new API
-- never had one. Firebase uids are at most 128 characters.
ALTER TABLE "public"."user"
    ADD COLUMN "firebase_uid" VARCHAR(128);

ALTER TABLE "public"."user"
    ADD CONSTRAINT "user_firebase_uid_key" UNIQUE ("firebase_uid");

-- Firebase uids of accounts deleted through DELETE /v1/me, as SHA-256 hex
-- (AccountDeletionService). The Firestore import consults it and does not
-- re-create those users (or their proposals that were removed with them), so
-- a re-run of the import cannot resurrect a deleted account. Only the hash is
-- kept: Firebase uids are random, so it identifies nobody without the legacy
-- export, which holds the uid anyway.
CREATE TABLE "public"."deleted_firebase_accounts" (
    "firebase_uid_sha256" CHAR(64)    NOT NULL,
    "deleted_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "deleted_firebase_accounts_pkey" PRIMARY KEY ("firebase_uid_sha256")
);

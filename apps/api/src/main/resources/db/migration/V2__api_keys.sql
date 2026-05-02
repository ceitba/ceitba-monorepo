-- Per-user API keys with optional expiry.
-- Raw keys are NEVER stored; only the SHA-256 hex digest is kept.
-- Key format: ceitba_<base64url-random-32-bytes>
CREATE TABLE "public"."api_keys" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       UUID         NOT NULL,
    "name"          VARCHAR(255) NOT NULL,
    "key_hash"      CHAR(64)     NOT NULL,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"    TIMESTAMPTZ  NOT NULL,
    "last_used_at"  TIMESTAMPTZ,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_keys_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "public"."api_keys" ("key_hash");
CREATE INDEX         "api_keys_user_id_idx"  ON "public"."api_keys" ("user_id");

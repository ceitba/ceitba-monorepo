-- Test mirror of V17__refresh_tokens (DDL only). See README.md.
CREATE TABLE "public"."refresh_tokens" (
    "id"          UUID         NOT NULL,
    "user_id"     UUID         NOT NULL,
    "family_id"   UUID         NOT NULL,
    "token_hash"  VARCHAR(64)  NOT NULL,
    "device_name" VARCHAR(120),
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"  TIMESTAMPTZ  NOT NULL,
    "revoked_at"  TIMESTAMPTZ,
    "replaced_by" UUID,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "refresh_tokens_replaced_by_fkey"
        FOREIGN KEY ("replaced_by") REFERENCES "public"."refresh_tokens" ("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_idx" ON "public"."refresh_tokens" ("token_hash");
CREATE INDEX        "refresh_tokens_family_id_idx"  ON "public"."refresh_tokens" ("family_id");
CREATE INDEX        "refresh_tokens_user_id_idx"    ON "public"."refresh_tokens" ("user_id");

-- Test mirror of V54__api_key_scopes.sql (DDL only).
ALTER TABLE "public"."api_keys"
    ADD COLUMN "scopes" VARCHAR(64) NOT NULL DEFAULT 'read,write,staff';

-- Test mirror of V62__api_key_scopes.sql (DDL only).
ALTER TABLE "public"."api_keys"
    ADD COLUMN "scopes" VARCHAR(64) NOT NULL DEFAULT 'read,report,write,staff,keys';

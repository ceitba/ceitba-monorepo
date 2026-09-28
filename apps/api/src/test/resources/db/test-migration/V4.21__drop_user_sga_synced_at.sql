-- Mirrors prod V28 (DDL-only). Tests cap Flyway at target=4.x.
ALTER TABLE "public"."user"
    DROP COLUMN IF EXISTS "sga_synced_at";

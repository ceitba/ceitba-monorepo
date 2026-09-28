-- Mirrors prod V27 (DDL-only). Tests cap Flyway at target=4.x.
ALTER TABLE "public"."articles"
    ADD COLUMN "push_sent_at" TIMESTAMPTZ;

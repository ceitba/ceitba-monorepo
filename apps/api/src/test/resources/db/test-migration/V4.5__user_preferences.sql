-- Mirrors prod V13 (DDL-only): rename prefered_language → preferred_language
-- and add theme column. Tests cap Flyway at target=4.x to skip production
-- seeds; this re-applies the schema change that V13 makes in prod so
-- entity validation and queries see the right column names.

ALTER TABLE "public"."user"
    RENAME COLUMN "prefered_language" TO "preferred_language";

ALTER TABLE "public"."user"
    ADD COLUMN "theme" VARCHAR(8);

ALTER TABLE "public"."user"
    ADD CONSTRAINT user_theme_check CHECK (theme IS NULL OR theme IN ('light', 'dark'));

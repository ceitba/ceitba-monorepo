-- Per-user preferences synced across all CEITBA SPAs (CeitbaPage, ItbaNews,
-- Scheduler). theme + language live on the user row so a sign-in on any of
-- the SPAs reproduces the same look-and-feel everywhere; logged-out users
-- still keep localStorage-only state inside each app.

-- The original column had a typo ("prefered_") — fix it now while we're
-- already touching the user table.
ALTER TABLE "public"."user"
    RENAME COLUMN "prefered_language" TO "preferred_language";

ALTER TABLE "public"."user"
    ADD COLUMN "theme" VARCHAR(8);

-- 'light' | 'dark'. Null means "not set yet" → SPA falls back to system
-- preference / its own default. Cheap CHECK keeps junk out.
ALTER TABLE "public"."user"
    ADD CONSTRAINT user_theme_check CHECK (theme IS NULL OR theme IN ('light', 'dark'));

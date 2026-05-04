-- =============================================================================
-- V8__drop_founded_year.sql
--
-- Drops organizations.founded_year. Product no longer surfaces a "founded in"
-- field, and the column was always NULL in the V7 seed.
-- =============================================================================

ALTER TABLE public.organizations
    DROP COLUMN IF EXISTS founded_year;

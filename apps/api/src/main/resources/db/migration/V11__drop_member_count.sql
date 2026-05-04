-- =============================================================================
-- V11__drop_member_count.sql
--
-- Drops organizations.member_count. The column was never written to and the
-- API now derives a live "follower" count from user_follows on read.
-- =============================================================================

ALTER TABLE public.organizations
    DROP COLUMN IF EXISTS member_count;

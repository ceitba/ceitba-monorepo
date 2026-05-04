-- Test mirror of V11. The original column was added in V3 (which runs in
-- tests up to target=4.x), so this drop is required for entity validation
-- to pass once memberCount is removed from the Organization entity.

ALTER TABLE public.organizations
    DROP COLUMN IF EXISTS member_count;

-- Test mirror of V59.
ALTER TABLE public.organizations
    ADD COLUMN attendees_visible_to_members BOOLEAN NOT NULL DEFAULT TRUE;

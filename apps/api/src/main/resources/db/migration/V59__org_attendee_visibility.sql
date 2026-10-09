-- =============================================================================
-- V59__org_attendee_visibility.sql
--
-- Who sees an event's RSVP list (names, emails) is the org admins' call
-- (docs/ORGANIZATIONS.md): every member (default) or only the admins.
-- =============================================================================

ALTER TABLE public.organizations
    ADD COLUMN attendees_visible_to_members BOOLEAN NOT NULL DEFAULT TRUE;

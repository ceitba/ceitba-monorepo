-- =============================================================================
-- V54__org_self_service.sql
--
-- Organizations manage themselves (docs/ORGANIZATIONS.md):
--   * org_invites: an org admin invites an email that has never signed in;
--     the invite becomes a user_organizations row on that email's first login
--     (UserProvisioningService). Emails of existing users are added directly.
--   * user_organizations: who added the member, and the member's board
--     position (title) shown on the public portal when show_on_portal.
--   * organizations: public contact and recruiting fields. instagram is a
--     bare handle (SocialHandles); linkedin and website are http(s) URLs
--     (an org's LinkedIn is a /company/ page, not an /in/ handle).
-- =============================================================================

CREATE TABLE public.org_invites (
    org_slug   TEXT        NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    email      TEXT        NOT NULL CHECK (email = lower(email)),
    role       TEXT        NOT NULL DEFAULT 'member',
    invited_by UUID        REFERENCES public."user"(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_slug, email)
);

CREATE INDEX org_invites_email_idx ON public.org_invites(email);

ALTER TABLE public.user_organizations
    ADD COLUMN added_by       UUID    REFERENCES public."user"(id) ON DELETE SET NULL,
    ADD COLUMN title          TEXT,
    ADD COLUMN show_on_portal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.organizations
    ADD COLUMN instagram       TEXT,
    ADD COLUMN linkedin_url    TEXT,
    ADD COLUMN website_url     TEXT,
    ADD COLUMN contact_email   TEXT,
    ADD COLUMN recruiting_open BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN recruiting_url  TEXT,
    ADD COLUMN recruiting_text TEXT;

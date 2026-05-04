-- =============================================================================
-- V9__user_organizations.sql
--
-- Adds the user ↔ organization membership relation and two new descriptive
-- columns on organizations (logo + background image URLs) so org admins can
-- edit their profile from the newsletter UI.
--
-- Membership is many-to-many: a user can belong to multiple organizations.
-- The `role` column carries an opaque string ('member', 'admin', etc.) so we
-- can scope future capabilities without another migration.
-- =============================================================================

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS logo_url       TEXT,
    ADD COLUMN IF NOT EXISTS background_url TEXT;

CREATE TABLE public.user_organizations (
    user_id    UUID         NOT NULL REFERENCES public."user"(id)         ON DELETE CASCADE,
    org_slug   TEXT         NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    role       TEXT         NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_slug)
);

CREATE INDEX user_organizations_org_idx  ON public.user_organizations(org_slug);
CREATE INDEX user_organizations_user_idx ON public.user_organizations(user_id);

-- Test-only mirror of the production V9 migration.
--
-- Production runs V8 (drop founded_year) + V9 (memberships + logo/background)
-- after V7 seeds organizations. Tests cap Flyway at the V4.x range to skip
-- the V5+ production seeds, so the same schema changes are reapplied here
-- under the V4.2 slot via spring.flyway.locations.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS logo_url       TEXT,
    ADD COLUMN IF NOT EXISTS background_url TEXT;

CREATE TABLE IF NOT EXISTS public.user_organizations (
    user_id    UUID         NOT NULL REFERENCES public."user"(id)         ON DELETE CASCADE,
    org_slug   TEXT         NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    role       TEXT         NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_slug)
);

CREATE INDEX IF NOT EXISTS user_organizations_org_idx  ON public.user_organizations(org_slug);
CREATE INDEX IF NOT EXISTS user_organizations_user_idx ON public.user_organizations(user_id);

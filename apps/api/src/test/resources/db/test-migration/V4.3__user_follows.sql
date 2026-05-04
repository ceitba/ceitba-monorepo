-- Test-only mirror of the production V10 migration. Skips the backfill
-- because the test DB has no seeded ceitba organisation; tests insert
-- follow rows explicitly via the repository.

CREATE TABLE IF NOT EXISTS public.user_follows (
    user_id    UUID         NOT NULL REFERENCES public."user"(id)         ON DELETE CASCADE,
    org_slug   TEXT         NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_slug)
);

CREATE INDEX IF NOT EXISTS user_follows_org_idx  ON public.user_follows(org_slug);
CREATE INDEX IF NOT EXISTS user_follows_user_idx ON public.user_follows(user_id);

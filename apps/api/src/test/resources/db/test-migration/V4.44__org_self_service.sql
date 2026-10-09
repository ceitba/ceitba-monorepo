-- Test mirror of V54.
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

-- Test mirror of V39 (DDL only). Per-user and per-org capabilities (docs/CAPABILITIES.md).

CREATE TABLE public.capability_settings (
    capability      TEXT        PRIMARY KEY,
    enabled_for_all BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID
);

-- Keyed by (lowercased) email so staff can pre-grant people who never logged in.
CREATE TABLE public.capability_user_grants (
    capability TEXT        NOT NULL,
    email      TEXT        NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by UUID,
    PRIMARY KEY (capability, email)
);

CREATE INDEX capability_user_grants_email_idx ON public.capability_user_grants(email);

CREATE TABLE public.capability_org_grants (
    capability TEXT        NOT NULL,
    org_slug   TEXT        NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by UUID,
    PRIMARY KEY (capability, org_slug)
);

CREATE INDEX capability_org_grants_org_idx ON public.capability_org_grants(org_slug);

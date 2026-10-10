-- Test mirror of V57.
CREATE TABLE public.push_log (
    id         BIGSERIAL   PRIMARY KEY,
    org_slug   TEXT        REFERENCES public.organizations(slug) ON DELETE CASCADE,
    kind       TEXT,
    ref_id     TEXT,
    targeted   INTEGER     NOT NULL,
    sent       INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_log_org_idx ON public.push_log(org_slug, created_at DESC) WHERE org_slug IS NOT NULL;

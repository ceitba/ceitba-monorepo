-- =============================================================================
-- V56__push_log.sql
--
-- One row per push fan-out (PushTriggerListener), so organizations can see
-- how many devices their articles, events and reminders reached
-- (OrgAnalyticsService). org_slug comes from the message's "org" data key;
-- null for pushes that aren't about an organization.
-- =============================================================================

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

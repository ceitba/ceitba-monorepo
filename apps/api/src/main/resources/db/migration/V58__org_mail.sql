-- =============================================================================
-- V58__org_mail.sql
--
-- Organizations email their followers from their own connected Gmail account
-- (mail_sender_account owner_type 'organization', docs/ORGANIZATIONS.md):
--   * org_announcements: one email an org admin writes (draft) and sends.
--   * org_announcement_deliveries: the recipients snapshot at send time,
--     worked through one by one by OrgAnnouncementSender (same lifecycle as
--     digest_deliveries).
--   * org_mail_optouts: followers who don't want an org's emails (one-click
--     unsubscribe or the portal switch). Survives unfollowing.
-- =============================================================================

CREATE TABLE public.org_announcements (
    id              BIGSERIAL   PRIMARY KEY,
    org_slug        TEXT        NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    subject         TEXT        NOT NULL,
    body            TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'draft'
        CONSTRAINT org_announcements_status_check CHECK (status IN ('draft', 'sending', 'sent')),
    sender_email    TEXT,
    recipient_count INTEGER,
    created_by      UUID        REFERENCES public."user"(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ
);

CREATE INDEX org_announcements_org_idx ON public.org_announcements(org_slug, created_at DESC);

CREATE TABLE public.org_announcement_deliveries (
    announcement_id BIGINT      NOT NULL REFERENCES public.org_announcements(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    email           TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
        CONSTRAINT org_announcement_deliveries_status_check CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts        INTEGER     NOT NULL DEFAULT 0,
    last_error      TEXT,
    claimed_at      TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX org_announcement_deliveries_pending_idx
    ON public.org_announcement_deliveries(announcement_id) WHERE status = 'pending';

CREATE TABLE public.org_mail_optouts (
    user_id    UUID        NOT NULL REFERENCES public."user"(id)          ON DELETE CASCADE,
    org_slug   TEXT        NOT NULL REFERENCES public.organizations(slug) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_slug)
);

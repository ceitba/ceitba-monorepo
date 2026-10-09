-- =============================================================================
-- V55__event_signup.sql
--
-- Events with sign-ups (docs/ORGANIZATIONS.md):
--   * news_events: a cover image, an optional online link and how people sign
--     up: 'none', 'external' (signup_url, e.g. a Google Form) or 'rsvp'
--     (built-in, optional capacity). reminder_sent_at marks the day-before
--     push to the RSVPs as sent (EventReminderService claims it once).
--   * event_rsvps: who is going.
--   * analytics_events.event_id: event detail page views ('event_view').
-- =============================================================================

ALTER TABLE public.news_events
    ADD COLUMN cover_image      TEXT,
    ADD COLUMN online_url       TEXT,
    ADD COLUMN signup_mode      TEXT NOT NULL DEFAULT 'none'
        CONSTRAINT news_events_signup_mode_check CHECK (signup_mode IN ('none', 'external', 'rsvp')),
    ADD COLUMN signup_url       TEXT,
    ADD COLUMN capacity         INTEGER CONSTRAINT news_events_capacity_check CHECK (capacity > 0),
    ADD COLUMN reminder_sent_at TIMESTAMPTZ;

CREATE TABLE public.event_rsvps (
    event_id   TEXT        NOT NULL REFERENCES public.news_events(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES public."user"(id)      ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX event_rsvps_user_idx ON public.event_rsvps(user_id);

ALTER TABLE public.analytics_events ADD COLUMN event_id TEXT;

CREATE INDEX ae_event_idx ON public.analytics_events(event_id, ts DESC)
    WHERE event_id IS NOT NULL;

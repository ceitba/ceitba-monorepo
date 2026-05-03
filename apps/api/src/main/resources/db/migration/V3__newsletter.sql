-- =============================================================================
-- V3__newsletter.sql
--
-- Newsletter domain: organizations, articles, events, votes, analytics.
-- Also adds google_sub + avatar_url to the user table for /auth/me.
-- =============================================================================

-- User additions
ALTER TABLE public."user"
    ADD COLUMN IF NOT EXISTS google_sub  TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS avatar_url  TEXT;

-- Organizations
CREATE TABLE public.organizations (
    slug         TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    full_name    TEXT NOT NULL,
    description  TEXT,
    category     TEXT,
    color        TEXT,
    member_count INT  DEFAULT 0,
    founded_year INT
);

-- Articles
CREATE TABLE public.articles (
    id            TEXT        PRIMARY KEY,
    title         TEXT        NOT NULL,
    excerpt       TEXT        NOT NULL,
    body          JSONB       NOT NULL DEFAULT '[]',
    category      TEXT        NOT NULL,
    organization  TEXT        REFERENCES public.organizations(slug),
    author        TEXT        NOT NULL,
    published_at  DATE,
    reading_time  TEXT,
    featured      BOOLEAN     DEFAULT false,
    color_scheme  TEXT        DEFAULT 'blue',
    cover_image   TEXT,
    status        TEXT        NOT NULL DEFAULT 'published',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    created_by    UUID        REFERENCES public."user"(id)
);

CREATE INDEX articles_category_idx ON public.articles(category);
CREATE INDEX articles_org_idx      ON public.articles(organization);
CREATE INDEX articles_status_idx   ON public.articles(status);
CREATE INDEX articles_featured_idx ON public.articles(featured) WHERE featured = true;

-- At most one featured published article per organisation.
CREATE UNIQUE INDEX one_featured_per_org
    ON public.articles(organization)
    WHERE featured = true AND status = 'published';

-- News Events (table name avoids collisions with PostgreSQL reserved words)
CREATE TABLE public.news_events (
    id           TEXT        PRIMARY KEY,
    title        TEXT        NOT NULL,
    event_date   DATE        NOT NULL,
    start_time   TIME        NOT NULL,
    end_time     TIME        NOT NULL,
    location     TEXT        NOT NULL,
    category     TEXT        NOT NULL,
    organization TEXT        REFERENCES public.organizations(slug),
    description  TEXT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    created_by   UUID        REFERENCES public."user"(id)
);

CREATE INDEX news_events_date_idx ON public.news_events(event_date);
CREATE INDEX news_events_org_idx  ON public.news_events(organization);

-- Vote aggregates (one row per article, updated on every vote)
CREATE TABLE public.article_votes (
    article_id TEXT        PRIMARY KEY REFERENCES public.articles(id) ON DELETE CASCADE,
    up_count   INT         NOT NULL DEFAULT 0,
    down_count INT         NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Vote deduplication: one vote per (fingerprint, article).
-- Fingerprint = SHA-256(IP + User-Agent) — no PII stored.
CREATE TABLE public.vote_records (
    article_id  TEXT NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    vote_type   TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (article_id, fingerprint)
);

-- Analytics (Phase 1 — PostgreSQL)
CREATE TABLE public.analytics_events (
    id         BIGSERIAL   PRIMARY KEY,
    type       TEXT        NOT NULL,
    session_id TEXT        NOT NULL,
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    article_id TEXT,
    category   TEXT,
    path       TEXT,
    ip_hash    TEXT
);

CREATE INDEX ae_ts_idx      ON public.analytics_events(ts DESC);
CREATE INDEX ae_article_idx ON public.analytics_events(article_id, ts DESC)
    WHERE article_id IS NOT NULL;
CREATE INDEX ae_type_ts_idx ON public.analytics_events(type, ts DESC);

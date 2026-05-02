-- ============================================================
-- 001_schema.sql  —  initial schema for itbanews
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (populated on first Google login)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  role        TEXT NOT NULL DEFAULT 'community_manager',  -- 'community_manager' | 'admin'
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Organizations (seeded once; slug is the stable PK)
CREATE TABLE IF NOT EXISTS organizations (
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
CREATE TABLE IF NOT EXISTS articles (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  excerpt       TEXT NOT NULL,
  body          JSONB NOT NULL DEFAULT '[]',
  category      TEXT NOT NULL,
  organization  TEXT REFERENCES organizations(slug),
  author        TEXT NOT NULL,
  published_at  DATE,
  reading_time  TEXT,
  featured      BOOLEAN DEFAULT false,
  color_scheme  TEXT DEFAULT 'blue',
  cover_image   TEXT,
  status        TEXT NOT NULL DEFAULT 'published',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  created_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS articles_category_idx ON articles(category);
CREATE INDEX IF NOT EXISTS articles_org_idx      ON articles(organization);
CREATE INDEX IF NOT EXISTS articles_status_idx   ON articles(status);
CREATE INDEX IF NOT EXISTS articles_featured_idx ON articles(featured) WHERE featured = true;

-- At most one featured+published article per org
CREATE UNIQUE INDEX IF NOT EXISTS one_featured_per_org
  ON articles(organization)
  WHERE featured = true AND status = 'published';

-- Events
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  event_date    DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  location      TEXT NOT NULL,
  category      TEXT NOT NULL,
  organization  TEXT REFERENCES organizations(slug),
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  created_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS events_date_idx ON events(event_date);
CREATE INDEX IF NOT EXISTS events_org_idx  ON events(organization);

-- Aggregated vote counts (one row per article)
CREATE TABLE IF NOT EXISTS article_votes (
  article_id  TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  up_count    INT NOT NULL DEFAULT 0,
  down_count  INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Deduplication: one vote per (fingerprint, article)
-- fingerprint = sha256(ip | userAgent) — no PII stored
CREATE TABLE IF NOT EXISTS vote_records (
  article_id   TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL,
  vote_type    TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (article_id, fingerprint)
);

-- Analytics events (Phase 1 — Postgres)
CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  article_id  TEXT,
  category    TEXT,
  path        TEXT,
  ip_hash     TEXT
);

CREATE INDEX IF NOT EXISTS ae_ts_idx      ON analytics_events(ts DESC);
CREATE INDEX IF NOT EXISTS ae_article_idx ON analytics_events(article_id, ts DESC) WHERE article_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ae_type_ts_idx ON analytics_events(type, ts DESC);

-- Migration bookkeeping
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename  TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT now()
);

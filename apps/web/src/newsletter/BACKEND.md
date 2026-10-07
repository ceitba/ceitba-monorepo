# ITBA News — Backend Implementation Guide

This document specifies the backend contracts required to replace the current
localStorage mock layer. The frontend is already structured to swap each module
with a real API call; the notes in each `src/api/` file point to the exact lines.

---

## Stack recommendation

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 22 + Fastify (or Python + FastAPI) | Fast JSON serialization, native async |
| Primary DB | **PostgreSQL 16** | Structured relational data, strong JSON support for body paragraphs |
| Analytics DB | **PostgreSQL → ClickHouse** (see migration path) | Start simple; migrate when event volume > 100k/day |
| Cache | Redis 7 | Session tokens, rate limiting, hot article cache |
| Object storage | **Cloudflare R2** (or AWS S3) | Images and any binary assets |
| Auth | Google OIDC via `passport-google-oauth20` / `authlib` | Matches `src/store/authStore.js` stub |
| Hosting | Railway / Render (simple) or ECS Fargate (production) | |

---

## Authentication

### Google OIDC flow (replaces hardcoded credentials)

```
GET  /auth/google            → redirect to Google consent screen
GET  /auth/google/callback   → exchange code, create session, redirect to /admin
POST /auth/logout            → destroy session
GET  /auth/me                → { id, name, email, role, avatarUrl }
```

**Session storage:** JWT in an httpOnly cookie, signed with `JWT_SECRET`.
Payload: `{ sub: userId, role: 'community_manager' | 'admin', exp }`.

**Role assignment:** On first Google login, create a `users` row. Role defaults
to `community_manager`; promote to `admin` manually in the DB or via a future
admin UI.

**Frontend migration:** In `src/store/authStore.js`, replace `signInWithCredentials`
with a redirect to `GET /auth/google`. Replace `getSession()` with a call to
`GET /auth/me` using the cookie.

---

## Database schema (PostgreSQL)

```sql
-- Users
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  role        TEXT NOT NULL DEFAULT 'community_manager',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Organizations
CREATE TABLE organizations (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  description  TEXT,
  category     TEXT,
  color        TEXT,
  member_count INT DEFAULT 0,
  founded_year INT
);

-- Articles
CREATE TABLE articles (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  excerpt       TEXT NOT NULL,
  body          JSONB NOT NULL DEFAULT '[]',   -- string[]
  category      TEXT NOT NULL,
  organization  TEXT REFERENCES organizations(slug),
  author        TEXT NOT NULL,
  published_at  DATE,
  reading_time  TEXT,
  featured      BOOLEAN DEFAULT false,
  color_scheme  TEXT DEFAULT 'blue',
  cover_image   TEXT,                          -- S3/R2 key or URL
  status        TEXT NOT NULL DEFAULT 'published',  -- 'published' | 'draft'
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  created_by    UUID REFERENCES users(id)
);

CREATE INDEX articles_category_idx   ON articles(category);
CREATE INDEX articles_org_idx        ON articles(organization);
CREATE INDEX articles_status_idx     ON articles(status);
CREATE INDEX articles_featured_idx   ON articles(featured) WHERE featured = true;

-- Events
CREATE TABLE events (
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

CREATE INDEX events_date_idx ON events(event_date);
CREATE INDEX events_org_idx  ON events(organization);

-- Votes (one row per article, aggregated)
CREATE TABLE article_votes (
  article_id  TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  up_count    INT NOT NULL DEFAULT 0,
  down_count  INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Vote deduplication: one vote per (fingerprint, article)
-- Fingerprint = hashed (IP + user-agent) — no PII stored
CREATE TABLE vote_records (
  article_id   TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL,
  vote_type    TEXT NOT NULL,  -- 'up' | 'down'
  created_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (article_id, fingerprint)
);
```

**Note on `featured`:** enforce at most one featured article per org via a
partial unique index or an application-level transaction:

```sql
CREATE UNIQUE INDEX one_featured_per_org
  ON articles(organization)
  WHERE featured = true AND status = 'published';
```

---

## REST API contract

All endpoints return `Content-Type: application/json`.
Admin endpoints require the session cookie. Public endpoints are unauthenticated.

### Articles

```
GET  /api/articles
  query: category?, organization?, status?, page=1, limit=20
  public: returns only status=published
  admin (with cookie): can pass status=draft or status=all
  → { data: Article[], meta: { total, page, limit } }

GET  /api/articles/:id
  public: 404 if draft
  admin: returns drafts too
  → Article

POST /api/articles              [admin]
  body: ArticleInput
  → Article (201)

PATCH /api/articles/:id         [admin]
  body: Partial<ArticleInput>
  → Article

DELETE /api/articles/:id        [admin]
  → 204
```

### Events

```
GET  /api/events
  query: category?, organization?, from?, to?, page=1, limit=50
  → { data: Event[], meta: { total, page, limit } }

GET  /api/events/:id
  → Event

POST /api/events                [admin]
  → Event (201)

PATCH /api/events/:id           [admin]
  → Event

DELETE /api/events/:id          [admin]
  → 204
```

### Organizations

```
GET  /api/organizations
  → { data: Organization[] }

GET  /api/organizations/:slug
  → Organization
```

### Votes

```
POST /api/articles/:id/votes
  body: { type: 'up' | 'down' }
  rate limited: 1 vote per fingerprint per article
  → { up: number, down: number }   (public, counts only)

DELETE /api/articles/:id/votes
  Retract a vote (same fingerprint)
  → 204
```

**Important:** Vote count response is intentionally public so the client can
confirm the operation succeeded. The admin analytics endpoint returns the full
breakdown.

### Analytics

```
POST /api/analytics/events      [no auth required, rate limited]
  body: AnalyticsEventBatch
  {
    events: Array<{
      type:       'article_view' | 'page_view' | 'category_filter'
      sessionId:  string   (client-generated, opaque)
      timestamp:  number   (Unix ms)
      articleId?: string
      category?:  string
      path?:      string
    }>
  }
  → 202 Accepted

GET /api/analytics/summary      [admin]
  query: days=30
  → {
      totalArticleViews: number,
      uniqueVisitors:    number,
      topArticles:       { articleId, title, views }[],
      categoryViews:     { category, views }[],
      dailyViews:        { date, views }[],
      voteBreakdown:     { articleId, title, up, down }[]
    }
```

---

## Image upload (S3 / Cloudflare R2)

Never upload images through the API server — use presigned URLs:

```
POST /api/media/sign-upload     [admin]
  body: { filename: string, contentType: string, sizeBytes: number }
  → {
      uploadUrl:  string,   // presigned PUT URL (expires in 5 min)
      publicUrl:  string,   // final CDN URL to store in article.coverImage
      key:        string    // S3/R2 object key
    }
```

**Frontend flow:**

1. Admin selects a file → client calls `POST /api/media/sign-upload`
2. Client PUTs the file directly to `uploadUrl` (no server proxy)
3. Client saves `publicUrl` as `article.coverImage`

**Bucket config:**

- Bucket: `itbanews-media` (private by default)
- Public CDN: Cloudflare R2 custom domain or CloudFront distribution
- Object key pattern: `articles/{articleId}/{uuid}.jpg`
- Max size enforced server-side via the presigned URL condition: `ContentLengthRange: [1, 5242880]` (5 MB)
- Accepted types: `image/jpeg`, `image/png`, `image/webp`

---

## Analytics architecture

### Phase 1 — PostgreSQL only (current scale: < 10k events/day)

```sql
CREATE TABLE analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  article_id  TEXT,
  category    TEXT,
  path        TEXT,
  -- No PII. IP is hashed before storage.
  ip_hash     TEXT
);

CREATE INDEX ae_ts_idx         ON analytics_events(ts DESC);
CREATE INDEX ae_article_idx    ON analytics_events(article_id, ts DESC) WHERE article_id IS NOT NULL;
CREATE INDEX ae_type_ts_idx    ON analytics_events(type, ts DESC);
```

Ingest: batch-insert up to 50 events per POST request. Use a background queue
(BullMQ or pg-boss) if you need to decouple ingestion from inserts.

Summary queries run on-demand; add a materialized view refreshed every 5 min
when query times grow:

```sql
CREATE MATERIALIZED VIEW mv_article_views_daily AS
  SELECT
    article_id,
    date_trunc('day', ts) AS day,
    COUNT(*)              AS views
  FROM analytics_events
  WHERE type = 'article_view'
  GROUP BY 1, 2;
```

### Phase 2 — ClickHouse (> 100k events/day)

Migrate the `analytics_events` table to ClickHouse:

```sql
CREATE TABLE analytics_events (
  type        LowCardinality(String),
  session_id  String,
  ts          DateTime64(3, 'UTC'),
  article_id  Nullable(String),
  category    Nullable(LowCardinality(String)),
  path        Nullable(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (type, ts)
TTL ts + INTERVAL 2 YEAR;
```

PostgreSQL remains the source of truth for articles, users, and votes.
ClickHouse is append-only analytics. Use the same `POST /api/analytics/events`
endpoint; the handler writes to ClickHouse asynchronously.

---

## Rate limiting and abuse prevention

| Endpoint | Limit |
|---|---|
| `POST /api/analytics/events` | 60 req/min per IP |
| `POST /api/articles/:id/votes` | 10 req/min per IP |
| `POST /auth/login` | 5 req/min per IP |
| All admin write endpoints | 120 req/min per authenticated user |

Use Redis (sliding window counter) or a middleware like `@fastify/rate-limit`.

---

## Environment variables

```
DATABASE_URL        postgres://user:pass@host:5432/itbanews
REDIS_URL           redis://localhost:6379
R2_ACCOUNT_ID       ...
R2_ACCESS_KEY_ID    ...
R2_SECRET_KEY       ...
R2_BUCKET           itbanews-media
R2_PUBLIC_URL       https://media.itbanews.ar
GOOGLE_CLIENT_ID    ...
GOOGLE_CLIENT_SECRET ...
GOOGLE_CALLBACK_URL https://api.itbanews.ar/auth/google/callback
JWT_SECRET          (32+ random bytes)
CORS_ORIGINS        https://itbanews.ar,https://www.itbanews.ar
```

---

## Frontend migration checklist

When the API is live, these are the only files that need to change:

- [ ] `src/store/authStore.js` — replace `signInWithCredentials` with OAuth redirect; replace `getSession` with `GET /auth/me`
- [ ] `src/api/client.js` — replace `apiRequest(resolver)` with `fetch(BASE_URL + path, opts)` and handle 401 → redirect to `/admin/login`
- [ ] `src/api/articles.js` — delete store import; call the REST endpoints
- [ ] `src/api/events.js` — same
- [ ] `src/api/organizations.js` — same
- [ ] `src/store/voteStore.js` — replace `castVote` with `POST /api/articles/:id/votes`
- [ ] `src/store/analyticsStore.js` — replace `saveEvents` with `POST /api/analytics/events` (batched flush every 10s or on page unload)
- [ ] `src/components/ImageUploader.jsx` — replace base64 storage with presigned URL flow
- [ ] Remove `src/store/articleStore.js` and `src/store/eventStore.js` (localStorage no longer needed)

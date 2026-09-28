# ITBA News SPA — Backend Migration Guide

This document specifies every change needed in the newsletter SPA to move from the
localStorage mock layer to the CEITBA-API.

---

## Base URL

All endpoints are prefixed with `/v1/`, not `/api/`.

```
// src/api/client.js
const BASE_URL = 'https://api.ceitba.org.ar/v1'  // production
const BASE_URL = 'http://localhost:8080/v1'        // dev
```

---

## Authentication

### Flow (unchanged from BACKEND.md)

```
GET  /v1/auth/google?redirect_uri=<frontend>   → redirects to Google
GET  /v1/auth/callback                         → handled server-side, redirects back to frontend
GET  /v1/auth/me                               → returns logged-in user (replaces getSession)
```

After `GET /v1/auth/google` completes, the API redirects to your `redirect_uri`
with `?token=<jwt>`. Store the token in memory or sessionStorage; send it as
`Authorization: Bearer <token>` on every authenticated request.

### `GET /v1/auth/me` response

```json
{
  "id":        "uuid",
  "name":      "Jane Doe",
  "email":     "jane@itba.edu.ar",
  "role":      "staff" | "user",
  "avatarUrl": "https://lh3.googleusercontent.com/..."
}
```

**Role mapping from BACKEND.md:**

| BACKEND.md role      | CEITBA-API role |
|----------------------|-----------------|
| `admin`              | `"staff"`       |
| `community_manager`  | `"staff"`       |

Right now all newsletter write operations require `role === "staff"`. A future
`community_manager` tier can be added to the API without changing the SPA contract.

### `src/store/authStore.js` changes

```js
// BEFORE
signInWithCredentials(email, password)

// AFTER — redirect to Google
window.location.href = `${BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(window.location.origin + '/admin/callback')}`

// On the /admin/callback page, grab the token from the query string:
const token = new URLSearchParams(window.location.search).get('token')
sessionStorage.setItem('auth_token', token)
window.location.replace('/admin')

// getSession() replacement
async function getSession() {
  const res = await apiRequest('GET', '/auth/me')
  return res.ok ? res.json() : null
}
```

---

## API client

Replace the resolver-based mock in `src/api/client.js`:

```js
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/v1'

async function apiRequest(method, path, body) {
  const token = sessionStorage.getItem('auth_token')
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    sessionStorage.removeItem('auth_token')
    window.location.replace('/admin/login')
    return
  }
  return res
}
```

---

## Articles — `src/api/articles.js`

### List

```
GET /v1/articles?category=&organization=&status=&page=1&limit=20
```

- Public callers always get `status=published` regardless of the `status` param.
- Staff (with Bearer token) may pass `status=draft` or `status=all` (null).

Response:
```json
{
  "data": [ Article ],
  "meta": { "total": 42, "page": 1, "limit": 20 }
}
```

### Get one

```
GET /v1/articles/:id
```

Returns 404 for drafts when called without a staff token.

### Create (staff only)

```
POST /v1/articles
Authorization: Bearer <token>
Content-Type: application/json
```

Body (`ArticleInput`):
```json
{
  "id":           "optional-client-id",
  "title":        "...",
  "excerpt":      "...",
  "body":         ["paragraph 1", "paragraph 2"],
  "category":     "tech",
  "organization": "it",
  "author":       "Jane Doe",
  "publishedAt":  "2026-05-01",
  "readingTime":  "3 min",
  "featured":     false,
  "colorScheme":  "blue",
  "coverImage":   "https://...",
  "status":       "published"
}
```

If `id` is omitted the server generates a UUID.

### Update (PATCH, staff only)

```
PATCH /v1/articles/:id
Authorization: Bearer <token>
```

All fields optional. Only supplied fields are updated.

### Delete (staff only)

```
DELETE /v1/articles/:id
Authorization: Bearer <token>
→ 204
```

---

## Events — `src/api/events.js`

### Route change

> **Important:** The endpoint is `/v1/news/events`, not `/api/events`.

```
GET  /v1/news/events?category=&organization=&from=2026-05-01&to=2026-05-31&page=1&limit=50
GET  /v1/news/events/:id
POST /v1/news/events          [staff]
PATCH /v1/news/events/:id     [staff]
DELETE /v1/news/events/:id    [staff]  → 204
```

`from` / `to` are ISO dates (`YYYY-MM-DD`).

Create body (`NewsEventInput`):
```json
{
  "id":           "optional",
  "title":        "Hackathon 2026",
  "eventDate":    "2026-06-15",
  "startTime":    "09:00",
  "endTime":      "18:00",
  "location":     "Aula Magna",
  "category":     "academic",
  "organization": "it",
  "description":  "..."
}
```

---

## Organizations — `src/api/organizations.js`

```
GET /v1/organizations          → { "data": [ Organization ] }
GET /v1/organizations/:slug    → Organization
```

Write endpoints (staff only):
```
POST   /v1/organizations
PATCH  /v1/organizations/:slug
DELETE /v1/organizations/:slug  → 204
```

---

## Votes — `src/store/voteStore.js`

```
GET    /v1/articles/:id/votes          → { "up": N, "down": N }
POST   /v1/articles/:id/votes          → { "up": N, "down": N }
  body: { "type": "up" | "down" }
DELETE /v1/articles/:id/votes          → 204
```

Deduplication is fingerprint-based (IP + User-Agent) on the server — no
cookie/localStorage required on the client. Calling POST with the same type
twice is a no-op; calling POST with the opposite type retracts the old vote.

---

## Analytics — `src/store/analyticsStore.js`

```
POST /v1/analytics/events
```

Body:
```json
{
  "events": [
    {
      "type":      "article_view",
      "sessionId": "client-generated-opaque-id",
      "timestamp": 1746316800000,
      "articleId": "abc123",
      "category":  null,
      "path":      "/articles/abc123"
    }
  ]
}
```

- Max 50 events per request.
- No auth required.
- Returns `202 Accepted`.
- Flush every 10 s or on `visibilitychange`/`pagehide`.

Valid `type` values: `article_view`, `page_view`, `category_filter`.

---

## Image upload — `src/components/ImageUploader.jsx`

```
POST /v1/media/sign-upload
Authorization: Bearer <token>
```

Body:
```json
{ "filename": "cover.jpg", "contentType": "image/jpeg", "sizeBytes": 1048576 }
```

Response (when cloud storage is configured):
```json
{
  "uploadUrl": "https://ceitba.org.ar/ceitba-media/media/<uuid>.jpg?X-Amz-...",
  "publicUrl": "https://ceitba.org.ar/ceitba-media/media/<uuid>.jpg",
  "key":       "media/<uuid>.jpg",
  "method":    "PUT",
  "headers":   { "Content-Type": "image/jpeg", "Content-Length": "1048576" },
  "expiresAt": "..."
}
```

**Status:** Returns `501 Not Implemented` until object storage is configured
on the server (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`,
`STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL`; see
`docs/OBJECT-STORAGE.md`). Keep the base64 path as a fallback until 501
stops being returned.

Upload flow (once live):
1. Call `POST /v1/media/sign-upload` → get `uploadUrl` + `publicUrl`
2. `PUT <uploadUrl>` with the raw file bytes and exactly the returned `headers` (Content-Type and Content-Length are signed)
3. Save `publicUrl` as `article.coverImage`

---

## Analytics summary (admin dashboard)

```
GET /v1/analytics/summary?days=30
Authorization: Bearer <token>
```

Response:
```json
{
  "totalArticleViews": 1024,
  "uniqueVisitors":    312,
  "topArticles":  [ { "articleId": "...", "title": "...", "views": 87 } ],
  "categoryViews":[ { "category": "tech", "views": 210 } ],
  "dailyViews":   [ { "date": "2026-05-01", "views": 34 } ],
  "voteBreakdown":[ { "articleId": "...", "title": "...", "up": 12, "down": 3 } ]
}
```

---

## Environment variables to add to the SPA

```
VITE_API_URL=https://api.ceitba.org.ar/v1
VITE_GOOGLE_REDIRECT_URI=https://itbanews.ar/admin/callback
```

---

## Files to remove once migration is complete

- `src/store/articleStore.js` — localStorage no longer needed
- `src/store/eventStore.js` — same
- Mock resolver in `src/api/client.js`

# Auth Setup Guide

How to configure Google Sign-In, generate credentials, and use API keys.  
Read [AUTH-AND-ROLES.md](AUTH-AND-ROLES.md) for the access-control model.

---

## Required environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_JWT_SECRET` | **Yes** | — | Base64-encoded 32+ byte HMAC signing key |
| `GOOGLE_CLIENT_ID` | For login | — | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | For login | — | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | For login | `http://localhost:8080/api/v1/auth/callback` | Must match a URI registered in Google Cloud Console |
| `FRONTEND_URL` | No | `http://localhost:3000` | Where to redirect after a successful login |
| `AUTH_ALLOWED_DOMAINS` | No | `itba.edu.ar` | Comma-separated domains admitted by the allowlist |
| `AUTH_ALLOWED_EMAILS` | No | *(empty)* | Comma-separated individual emails admitted outside the domain rule |
| `AUTH_SYNC_API_KEY` | No | *(empty)* | Static key for `/v1/sync/**` cron endpoints |

---

## 1. Generate the JWT signing key

The API issues its own short-lived JWTs after a successful Google login. You need to generate a secret key once per environment.

```bash
openssl rand -base64 32
# e.g. <output of openssl rand -base64 32>
```

Set `AUTH_JWT_SECRET` to that output. Keep it secret — anyone with this key can forge tokens.

Default token lifetime is **7 days**. Override with `AUTH_JWT_TTL_DAYS=<n>`.

---

## 2. Create a Google OAuth 2.0 app

### 2a. Open Google Cloud Console

Go to [console.cloud.google.com](https://console.cloud.google.com) and create or select a project (e.g. "CEITBA API").

### 2b. Configure the consent screen

1. Sidebar → **APIs & Services** → **OAuth consent screen**
2. **User type:**
   - **Internal** — only accounts in your Google Workspace (e.g. @itba.edu.ar). Simplest; no review needed.
   - **External** — any Google account. Required if you want alumni or non-ITBA accounts. You must add test users until Google verifies the app.
3. Fill in app name, support email, developer email.
4. **Scopes:** Add `openid`, `email`, `profile`.
5. Save.

### 2c. Create credentials

1. Sidebar → **APIs & Services** → **Credentials**
2. **+ Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. **Authorized redirect URIs** — add one line per environment:
   ```
   http://localhost:8080/api/v1/auth/callback
   https://api.ceitba.org.ar/api/v1/auth/callback
   ```
5. Click **Create**. Copy the **Client ID** and **Client Secret**.

> The redirect URI must match `GOOGLE_REDIRECT_URI` exactly (scheme, host, port, path).

---

## 3. Configure your environment

### Local development (`.env` file — never commit this)

```bash
AUTH_JWT_SECRET=<output of openssl rand -base64 32>

GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback

FRONTEND_URL=http://localhost:3000
```

### Production (server / container env vars)

```bash
AUTH_JWT_SECRET=<different key — run openssl again>

GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://api.ceitba.org.ar/api/v1/auth/callback

FRONTEND_URL=https://ceitba.org.ar
```

> Generate a **separate** `AUTH_JWT_SECRET` for production. Do not reuse the dev one.

### Allowing non-ITBA emails

```bash
# Admit everyone at a custom domain:
AUTH_ALLOWED_DOMAINS=itba.edu.ar,alu.itba.edu.ar

# Admit specific addresses regardless of domain:
AUTH_ALLOWED_EMAILS=alumni@gmail.com,partner@company.com
```

---

## 4. Frontend integration

### Sign-in button

No OAuth library needed on the frontend. A plain link is enough:

```html
<a href="/api/v1/auth/google?redirect_uri=https://ceitba.org.ar/auth/callback">
  Sign in with Google
</a>
```

The `redirect_uri` must start with one of the allowed origins (`https://ceitba.org.ar`, `http://localhost:3000`, `http://localhost:3001`). Anything else falls back to `FRONTEND_URL`.

### Callback page (`/auth/callback` on the frontend)

After Google authenticates the user the API redirects back to your `redirect_uri` with a query parameter:

```
https://ceitba.org.ar/auth/callback?token=<jwt>   ← success
https://ceitba.org.ar/auth/callback?error=unauthorized  ← email not in allowlist
https://ceitba.org.ar/auth/callback?error=auth_failed   ← Google exchange failed
```

```js
// e.g. pages/auth/callback.js
const params = new URLSearchParams(window.location.search);
const token  = params.get('token');
const error  = params.get('error');

if (token) {
  localStorage.setItem('ceitba_token', token);
  router.push('/dashboard');
} else {
  showError(error === 'unauthorized'
    ? 'Your email is not authorized. Use your @itba.edu.ar account.'
    : 'Login failed. Please try again.');
}
```

### Authenticated requests

```js
fetch('/api/v1/wiki/bookmarks/93.12', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${localStorage.getItem('ceitba_token')}` }
});
```

The JWT is valid for **7 days**. When it expires the user gets a `401` and should be redirected to the login flow again.

---

## 5. User API keys

API keys let scripts and integrations authenticate without a browser login. They use the `X-Api-Key` header instead of `Authorization: Bearer`.

### Create a key

Requires an active session (JWT or another API key).

```bash
curl -X POST https://api.ceitba.org.ar/api/v1/auth/api-keys \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-pipeline", "ttlDays": 365}'
```

```json
{
  "id": "a1b2c3d4-...",
  "name": "ci-pipeline",
  "key": "ceitba_abc123...",
  "expiresAt": "2027-05-02T12:00:00Z"
}
```

**The raw key is returned once and never stored. Save it immediately.**

Default expiry is **365 days**. `ttlDays` is optional; omit it to use the default.

### Use the key

```bash
curl https://api.ceitba.org.ar/api/v1/some-endpoint \
  -H "X-Api-Key: ceitba_abc123..."
```

### List active keys

```bash
curl https://api.ceitba.org.ar/api/v1/auth/api-keys \
  -H "X-Api-Key: ceitba_abc123..."
```

```json
[
  {
    "id": "a1b2c3d4-...",
    "name": "ci-pipeline",
    "createdAt": "2026-05-02T12:00:00Z",
    "expiresAt": "2027-05-02T12:00:00Z",
    "lastUsedAt": "2026-05-02T15:30:00Z"
  }
]
```

### Revoke a key

```bash
curl -X DELETE https://api.ceitba.org.ar/api/v1/auth/api-keys/a1b2c3d4-... \
  -H "Authorization: Bearer <your-jwt>"
```

Returns `204 No Content`.

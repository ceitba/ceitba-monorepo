# Auth Setup Guide

How to configure Google Sign-In, generate credentials, and use API keys.  
Read [AUTH-AND-ROLES.md](AUTH-AND-ROLES.md) for the access-control model.

---

## Required environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_JWT_SECRET` | **Yes** | — | Base64-encoded 32+ byte HMAC signing key |
| `CONTENT_HMAC_SECRET` | No | derived from `AUTH_JWT_SECRET` | Root secret (32+ bytes) for keyed hashes: proposal attachment keys, imported Firestore comment ids, article-vote fingerprints (IP + User-Agent) and analytics IP hashes. Each use gets its own derived key; the JWT key is never used for them directly. Without it, rotating `AUTH_JWT_SECRET` also changes those hashes (past voters can vote once more) |
| `GOOGLE_CLIENT_ID` | For login | — | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | For login | — | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | For login | `http://localhost:8080/api/v1/auth/callback` | Must match a URI registered in Google Cloud Console |
| `AUTH_GOOGLE_MOBILE_AUDIENCES` | For mobile login | *(empty = disabled, 501)* | Comma-separated OAuth client IDs accepted as the `aud` of mobile Google ID tokens |
| `AUTH_JWT_TTL_DAYS` | No | `7` | Web session JWT lifetime |
| `AUTH_JWT_ISSUER` | No | `https://ceitba.org.ar/api` | `iss` claim of issued JWTs |
| `AUTH_JWT_ENFORCE_ISS_AUD` | No | `false` | Require `iss`/`aud` on every JWT (flip after the phase-in, see AUTH-AND-ROLES) |
| `AUTH_MOBILE_ACCESS_TTL` | No | `15m` | Mobile access-token lifetime |
| `AUTH_REFRESH_TTL` | No | `60d` | Mobile refresh-token lifetime (sliding) |
| `AUTH_REFRESH_REUSE_GRACE` | No | `60s` | Window in which a just-rotated refresh token may be retried (lost response) without revoking the family; `0` disables |
| `MOBILE_MIN_VERSION` / `MOBILE_LATEST_VERSION` / `MOBILE_MAINTENANCE` | No | `0.0.0` / `0.0.0` / `false` | Served by `GET /v1/app/config` |
| `FRONTEND_URL` | No | `http://localhost:3000` | Where to redirect after a successful login |
| `AUTH_ALLOWED_DOMAINS` | No | `itba.edu.ar` | Comma-separated domains admitted by the allowlist |
| `AUTH_ALLOWED_EMAILS` | No | *(empty)* | Comma-separated individual emails admitted outside the domain rule |
| `AUTH_SYNC_API_KEY` | No | *(empty)* | Static key for `/v1/sync/**` cron endpoints |
| `REVIEW_LOGIN_EMAIL` | For store review | *(empty = disabled, 404)* | The one account allowed on `POST /v1/auth/review-login` (see [§ 5f](#5f-store-review-account)) |
| `REVIEW_LOGIN_PASSWORD_HASH` | For store review | *(empty = disabled, 404)* | bcrypt hash of that account's password (never the password itself) |
| `RATE_LIMIT_REVIEW_LOGIN_CAPACITY` / `RATE_LIMIT_REVIEW_LOGIN_PERIOD` | No | `10` / `1m` | Per-IP bucket of `POST /v1/auth/review-login` |

---

## 1. Generate the JWT signing key

The API issues its own JWTs after a successful Google login (7-day web cookie, 15-minute mobile access token). You need to generate a secret key once per environment.

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

The `redirect_uri` origin (scheme + host + port) must exactly match one of the allowed origins (`https://ceitba.org.ar`, `http://localhost:3000`, `http://localhost:3001`, `http://localhost:5173`, `http://localhost:5175`). Anything else falls back to `FRONTEND_URL`.

The OAuth `state` is a random nonce + expiry + target, HMAC-signed with `AUTH_JWT_SECRET`, and the nonce is also set in a 10-minute HttpOnly `ceitba_oauth_state` cookie. The callback rejects (`?error=invalid_state` on `FRONTEND_URL`) any state that is unsigned, expired, or not bound to the browser's cookie, so the login must start and finish in the same browser.

### Callback page (`/auth/callback` on the frontend)

On success the API sets the JWT in an **HttpOnly session cookie** (`AUTH_COOKIE_NAME`, default `ceitba_session`) and redirects to your `redirect_uri` with a clean URL. The token is **never** put in the URL and JavaScript cannot read it. On failure it redirects with `?error=`:

```
https://ceitba.org.ar/auth/callback                              ← success (cookie set)
https://ceitba.org.ar/auth/callback?error=unverified_email       ← Google email not verified
https://ceitba.org.ar/auth/callback?error=unauthorized           ← email not in allowlist
https://ceitba.org.ar/auth/callback?error=unauthorized_workspace ← Google Workspace (hd) domain not allowlisted
https://ceitba.org.ar/auth/callback?error=access_denied          ← user cancelled Google's consent screen
https://ceitba.org.ar/auth/callback?error=auth_failed            ← Google exchange failed (or another Google error / no code)
https://ceitba.org.ar?error=invalid_state                        ← missing/forged/expired OAuth state (sent to FRONTEND_URL)
```

```js
// e.g. pages/auth/callback.js
const error = new URLSearchParams(window.location.search).get('error');
if (!error) {
  router.push('/dashboard');           // session cookie is already set
} else {
  showError(error === 'unauthorized'
    ? 'Your email is not authorized. Use your @itba.edu.ar account.'
    : 'Login failed. Please try again.');
}
```

### Authenticated requests

Same-origin requests carry the cookie automatically; cross-origin SPAs must send credentials:

```js
fetch('/api/v1/wiki/bookmarks/93.12', { method: 'POST', credentials: 'include' });
const me = await (await fetch('/api/v1/auth/me', { credentials: 'include' })).json();
```

The session is valid for **7 days** (`AUTH_JWT_TTL_DAYS`). When it expires the user gets a `401` and should be sent through the login flow again. `POST /api/v1/auth/logout` clears the cookie.

---

## 5. Mobile app integration

Native clients never see the web redirect flow or a cookie. They exchange a Google **ID token** for a CEITBA token pair.

### 5a. Google Cloud setup

Create the **Android** and **iOS** OAuth clients in the **same Google Cloud project** as the web client above; cross-client ID tokens only work within one project. In the app, request the ID token with the **web client ID as `serverClientId`**, so its `aud` is the web client ID. Then set:

```bash
AUTH_GOOGLE_MOBILE_AUDIENCES=<web client id>[,<ios client id if iOS does not use serverClientId>]
```

Never add a client ID you do not control: any ID token whose `aud` is listed can log in.

### 5b. Sign in

```http
POST /api/v1/auth/google/mobile
Content-Type: application/json

{ "idToken": "<Google ID token>", "nonce": "<optional>", "deviceName": "Pixel 8" }
```

```json
{
  "accessToken": "<jwt>",
  "accessTokenExpiresAt": "2026-09-25T12:15:00Z",
  "refreshToken": "<opaque>",
  "refreshTokenExpiresAt": "2026-11-24T12:00:00Z",
  "user": { "id": "…", "email": "alice@itba.edu.ar", "role": "user", "…": "same shape as GET /v1/auth/me" }
}
```

The server checks the token's signature (Google JWKS), `iss`, `aud`, `exp` and, when you send `nonce`, that it equals the token's `nonce` claim. It then applies the same checks as the web callback (`email_verified`, allowlist, `hd`). Errors: `401 {"error":"invalid_token"}`, `403 {"error":"unverified_email" | "unauthorized" | "unauthorized_workspace"}`, `501` if mobile login is not configured.

### 5c. Use and renew

Send `Authorization: Bearer <accessToken>`. Before it expires (15 min), or on a `401`, rotate:

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "<current refresh token>" }
```

The response has the same shape; **replace both stored tokens**. Each refresh token works once. Reusing an old one revokes the whole session family, so serialize refreshes (one in flight at a time). If a refresh response is lost (timeout, network drop, app killed), just retry with the token you still hold: within `AUTH_REFRESH_REUSE_GRACE` (default 60 s) of the rotation, and as long as the lost successor was never used, the server issues a fresh successor instead of ending the session. A `401`/`403` from `/refresh` means the session is over: sign in again.

### 5d. Log out and delete the account

```http
POST /api/v1/auth/logout        {"refreshToken": "<current refresh token>"}   → 204, this device
POST /api/v1/auth/logout-all    (Bearer)                                       → 204, every device
DELETE /api/v1/me               (Bearer)                                       → 204, account deleted
```

See [AUTH-AND-ROLES.md § Account deletion](AUTH-AND-ROLES.md#account-deletion-delete-v1me) for what is deleted or anonymized.

On logout, first unregister the push token with `DELETE /api/v1/me/devices/{token}` (while the access token is still valid). See [PUSH-NOTIFICATIONS.md](PUSH-NOTIFICATIONS.md) for registering it after login.

### 5f. Store review account

Apple / Google reviewers get an email + password login instead of Google Sign-In. It is **off by default** and should be on only while a review is pending. Full details (errors, security properties, what the reviewer can do): [AUTH-AND-ROLES.md § App Store / Play review login](AUTH-AND-ROLES.md#app-store--play-review-login).

1. Pick an email (any domain) and a strong password, and hash it:

   ```bash
   htpasswd -bnBC 12 "" 'the-password' | tr -d ':\n' | sed 's/^\$2y/$2a/'
   # or: docker run --rm httpd:2.4-alpine htpasswd -bnBC 12 "" 'the-password' | tr -d ':\n' | sed 's/^\$2y/$2a/'
   ```

2. Set on the server's `.env` (single quotes around the hash: it contains `$`), then `docker compose up -d ceitba-api`:

   ```bash
   REVIEW_LOGIN_EMAIL=appreview@example.com
   REVIEW_LOGIN_PASSWORD_HASH='$2a$12$...'
   ```

3. Put the email and plain password in the App Store Connect / Play Console review notes.
4. After the review, blank both variables and recreate the container: the endpoint 404s and the account's sessions die on their next refresh.

The app calls:

```http
POST /api/v1/auth/review-login
Content-Type: application/json

{ "email": "appreview@example.com", "password": "<password>", "deviceName": "iPhone" }
```

and gets the same response as [§ 5b](#5b-sign-in); from then on everything in § 5c–5d applies. Errors: `401 {"error":"invalid_credentials"}`, `404` when disabled, `429` after 10 attempts/min per IP.

### 5e. Release control

`GET /api/v1/app/config` (public) returns `{"minVersion": "1.2.0", "latestVersion": "1.4.1", "maintenance": false}` from `MOBILE_MIN_VERSION`, `MOBILE_LATEST_VERSION` and `MOBILE_MAINTENANCE`.

---

## 6. User API keys

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

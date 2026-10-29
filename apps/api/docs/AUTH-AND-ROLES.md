# Auth & roles

How identity, roles, and access control work in CEITBA-API. Read this before changing any of `src/http/security.ts`, `src/http/auth/*` (`policy.ts` above all), or anything in `src/features/auth/`.

---

## TL;DR

| You are… | What you send | What you can do |
|---|---|---|
| **Anonymous** | nothing | Read public endpoints (health, careers, subjects, plans, classrooms, commissions, highlights, benefits, GET wiki bookmarks, POST classrooms/conflicts, GET `/v1/app/config`, GET `/v1/capabilities`, GET `/v1/articles/{id}/preview`, GET `/v1/articles/sitemap.xml` [articles and events]); call the token endpoints (`POST /v1/auth/google/mobile`, `/v1/auth/refresh`, `/v1/auth/logout`, and `/v1/auth/review-login` [while enabled](#app-store--play-review-login)) |
| **USER** | `Authorization: Bearer <jwt>` or the web session cookie (email passes the allowlist) | Everything anonymous can do, **plus** create/delete wiki bookmarks, manage your own API keys, `POST /v1/auth/logout-all`, `DELETE /v1/me` (JWT session only, not API keys) |
| **USER via API key** | `X-Api-Key: ceitba_<key>` | Same as USER, narrowed by the key's scopes (`read` / `write` / `staff`, see [AUTH-SETUP.md § Scopes](AUTH-SETUP.md#scopes)) |
| **MODERATOR** | Same JWT or API key, plus an active `ceitba_moderators` grant (or active STAFF) | Everything USER can do, **plus** moderation endpoints that require `ROLE_MODERATOR` (`/v1/staff/proposals/**`, editing/deleting any study group) |
| **STAFF** | Same JWT or API key, plus an active `ceitba_staff` row | Everything USER and MODERATOR can do, **plus** assign/revoke STAFF and MODERATOR on others, create users and correct a user's file number (`/v1/users/**`), keep the career/plan catalogue (`POST`/`PUT`/`DELETE /v1/careers/**`; reads are public) |
| **SYNC** (machine, not human) | `X-Api-Key: <AUTH_SYNC_API_KEY>` | Trigger `/v1/sync/**` jobs |

JWTs are issued by this API (HS256, `AUTH_JWT_SECRET`) after a Google sign-in, either the web OAuth flow (JWT in an HttpOnly cookie) or the mobile ID-token exchange (JWT + refresh token in the response body). The one exception is the [store review account](#app-store--play-review-login), which signs in with an email and password. Google tokens are never accepted as bearer tokens. See [AUTH-SETUP.md](AUTH-SETUP.md) to configure login and [§ Sessions and tokens](#sessions-and-tokens) below.

`Anonymous` isn't actually a role; it's the absence of any authentication. The others (`USER`, `MODERATOR`, `STAFF`, `SYNC`) are the `Role` values of `src/http/auth/principal.ts` (written `ROLE_*` below, as in the error messages and history).

---

## How roles are assigned

### USER — automatic on first sign-in

Anyone whose JWT or API-key email passes the [allowlist](#how-to-add-a-new-authorized-user-without-making-them-staff) gets `ROLE_USER`. There's **no signup endpoint**: a `User` row is created on the first successful Google sign-in (web callback or mobile exchange, both through the Google login part of `src/features/auth/service.ts`) or the first time a JWT hits a route that asks for the current user (`currentUser: true` / `currentUser(c)`). That's "JIT provisioning" — see `findOrCreateUser` in `src/http/auth/provisioning.ts`. New users auto-follow the `ceitba` organization. Sign-in does **not** fill any academic data: ITBA revoked CEITBA's access to the SGA student lookup in 2026-09, so the SGA prefill (and `POST /v1/me/profile/sync-from-sga`) is gone. Users pick their career and plan during app onboarding and enter their file number (legajo) themselves via `PATCH /v1/me/profile`. The file number can be set only while it is empty and must be unique (409 `FileNumberAlreadySet` / `FileNumberTaken`); after that only STAFF can change or clear it (`PATCH /v1/users/{id}/file-number`).

If you authenticate but never hit a current-user route, no row is created. The role is still granted (`ROLE_USER`), so you can call any USER-level endpoint immediately.

### STAFF — granted via an active `ceitba_staff` row

The security chain adds `ROLE_STAFF` if the request's email maps to a `User` row that has a `ceitba_staff` record where `start <= now <= end`. The check happens on every authenticated request inside `jwtRoles` in `src/http/security.ts` — one DB lookup per request, no cache.

A user can only be in **one** branch at a time (`ceitba_staff.user_id` is the primary key). To change someone's branch or role, revoke their current membership and assign a new one.

### MODERATOR — a narrow grant, separate from STAFF

`ROLE_MODERATOR` is for people who moderate user-generated content without any other staff power. It is granted when either:

- the user is active STAFF (**STAFF implies MODERATOR**; no row needed), or
- the user has a `ceitba_moderators` row with `revoked_at IS NULL` (V19).

Both checks run in the same places as the STAFF check: `jwtRoles` (JWTs) and `apiKeyRoles` (user API keys) in `src/http/security.ts`, once per request, no cache. `GET /v1/auth/me` (and the `user` object of the mobile token responses) exposes it as `"moderator": true|false`; `role` stays `"staff"` or `"user"`.

Only STAFF can manage grants (a MODERATOR cannot grant or revoke):

```http
GET    /api/v1/staff/moderators              -> [{userId, email, name, grantedBy, grantedAt}]
POST   /api/v1/staff/moderators  {"email": "someone@itba.edu.ar"}   -> 201
DELETE /api/v1/staff/moderators/{userId}     -> 204
```

- The list shows explicit grants only; staff-implied moderators are listed by `GET /v1/staff`.
- `POST`: `404` when the email has never signed in (User rows are JIT-provisioned), `409` when the grant is already active. Granting again after a revoke reactivates the row.
- `DELETE` keeps the row for audit (`revoked_at`, `revoked_by`); `404` when there is no active grant.
- Account deletion removes the grant.

### Organization roles — `user_organizations.role`

Org membership is not one of the roles above: it is a `user_organizations` row whose `role` is `member` or `admin` (the only values the API accepts on write). Members can manage their org's profile, articles and events; only `admin` members (and STAFF) can list the org's followers (`GET /v1/organizations/{slug}/followers`, which exposes names and emails). Only STAFF manages memberships:

```http
POST   /api/v1/users/{userId}/organizations          {"slug": "sabf", "role": "member"}  -> 201
PATCH  /api/v1/users/{userId}/organizations/{slug}   {"role": "admin"}                    -> 200 {slug, role}
DELETE /api/v1/users/{userId}/organizations/{slug}                                        -> 204
```

`POST` returns `409` if the membership already exists (use `PATCH` to change its role); `PATCH` returns `404` if it doesn't; both return `400` for a role other than `member`/`admin`. `GET /v1/users` lists each user's memberships as `organizations: [{slug, role}]`.

### Independent articles (no organization)

Any `ROLE_USER` may `POST /v1/articles` with no `organization`. For non-staff authors the status may only be `draft` or `pending_review` (missing = `pending_review`; anything else → 400 `ValidationError`), and `featured` is ignored. The author (`createdBy`) can `GET`, `PATCH` and `DELETE` it while it is not `published`; a `PATCH` keeps the same status limit unless it moves the article into an org the author belongs to (then member rules apply). STAFF moderates by publishing it, after which only STAFF can edit or delete it. `GET /v1/articles?mine=true` lists only the caller's own **independent** (org-less) articles, of every status (`status` and `category` filter; `organization` is ignored — org articles are listed with `?organization=<slug>` by the org's members; anonymous → empty page). The author shortcut on `GET /v1/articles/{id}` likewise covers only org-less articles: an org article's drafts are visible to the org's current members (and STAFF), so an author who leaves the org loses access. A non-staff author's `id` on create is ignored (a UUID is generated); STAFF and org members may still pick one, matching `^[a-z0-9][a-z0-9-]{0,99}$` (else 400 `ValidationError`). Author `PATCH`/`DELETE` load the article under a row lock (`findArticle(tx, id, true)` in `src/features/news/repo.ts`, also used by staff writes) and re-check authorship/org-less/unpublished inside that transaction; if a staff publish won the race the author gets 409 `InvalidState` (403 is still returned when the state was already published at authorization time). API-key (`ceitba_`) callers are resolved to their user just like JWT callers. Org-less articles never trigger pushes. Checks live in `src/features/news/access.ts` (`OrgAccess`) + `src/features/news/routes.ts`.

### SYNC — `X-Api-Key` (static key) only

Cron jobs and ops scripts authenticate with a static header against `AUTH_SYNC_API_KEY`. The API-key step of `authenticateAndAuthorize` in `src/http/security.ts` (`syncKeyMatches`) translates a matching key into a `ROLE_SYNC` principal. This skips the JWT path entirely. Bug bias: if `AUTH_SYNC_API_KEY` is empty/unset, every `/sync` request returns 401. Fail-closed by design.

User API keys (prefixed `ceitba_`) also go through `X-Api-Key` but they are looked up in the `api_keys` table and grant `ROLE_USER` / `ROLE_STAFF` / `ROLE_MODERATOR`, not `ROLE_SYNC`. See [AUTH-SETUP.md § User API keys](AUTH-SETUP.md#6-user-api-keys).

---

## How to bootstrap the first STAFF member

The `POST /v1/staff` endpoint requires `ROLE_STAFF` to call. Chicken-and-egg: until someone is staff, nobody can grant staff. Bootstrap manually with SQL.

```sql
-- 1. The user must already exist. If they've ever hit a current-user route
-- they'll be there; otherwise insert manually:
INSERT INTO public."user" (id, email, name, created_at, updated_at)
VALUES (gen_random_uuid(), 'founder@itba.edu.ar', 'Founder', now(), now())
ON CONFLICT (email) DO NOTHING;

-- 2. Grant STAFF for one year. PK is user_id, so an existing row blocks a
-- new INSERT — UPDATE in that case.
INSERT INTO public.ceitba_staff (user_id, branch, role, start, "end")
SELECT id, 'DIRECTIVES', 'PRESIDENT', now(), now() + interval '1 year'
FROM public."user"
WHERE email = 'founder@itba.edu.ar';
```

After that, the founder's next request gets `ROLE_STAFF` and they can use the API to manage everyone else.

If you forget who has STAFF, a SQL refresher:

```sql
SELECT u.email, u.name, s.branch, s.role, s.start, s."end"
FROM public.ceitba_staff s
JOIN public."user" u ON u.id = s.user_id
WHERE s.start <= now() AND s."end" >= now()
ORDER BY u.email;
```

---

## How to assign STAFF after the bootstrap

```http
POST /api/v1/staff
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "email": "alice@itba.edu.ar",
  "branch": "IT",
  "role": "MEMBER",
  "start": "2026-03-01T00:00:00Z",
  "end":   "2026-12-31T23:59:59Z"
}
```

- `email` must already correspond to an existing `User` row (i.e., they've authenticated at least once OR you've inserted them via SQL).
- `branch` ∈ `{IT, MEDIA, INFRASTRUCTURE, NAUTICAL, EVENTS, DIRECTIVES}`.
- `role` ∈ `{PRESIDENT, VICEPRESIDENT, SECRETARY, TREASURER, LEADER, MEMBER}`.
- `start` must be before `end`. Both are ISO-8601 with timezone.

**Errors:**
- `404 ResourceNotFound` — email doesn't match any user.
- `409 ResourceAlreadyExists` — they already have an active CeitbaStaff row. Revoke it first.
- `400 ValidationError` — `start ≥ end`, missing fields, bad enum value.
- `403` — caller isn't STAFF.

## How to revoke STAFF

```http
DELETE /api/v1/staff/{userId}
Authorization: Bearer <jwt>
```

Returns `204 No Content`. Behavior:
- If the membership has already started, the row is **end-dated to `now`** (kept for audit).
- If the membership hasn't started yet, the row is **deleted** (mistake correction).

## How to list active STAFF

```http
GET /api/v1/staff
Authorization: Bearer <jwt>
```

Returns `[{user_id, email, name, branch, role, start, end}]`. Only currently-active rows (today is between `start` and `end`).

---

## How to add a new authorized user (without making them STAFF)

The allowlist gates which emails Google identities are admitted at all. Two knobs:

| Env var | Effect |
|---|---|
| `AUTH_ALLOWED_DOMAINS` | Comma-separated. Email is admitted if it ends with `@<one of these>`. Default: `itba.edu.ar` |
| `AUTH_ALLOWED_EMAILS` | Comma-separated. Email is admitted if it equals (case-insensitive) one of these. Default: empty |

**ITBA student/staff with an `@itba.edu.ar` Google account**: nothing to do; already admitted.

**External (e.g. alumni on personal Gmail)**: add their address to `AUTH_ALLOWED_EMAILS` (one-line PR to your deployment env / `.env`), redeploy. They're admitted on the next request.

**Someone with a different domain who shouldn't be auto-admitted**: just don't add them. They get `403 Forbidden` on any protected endpoint.

The admission rule is `admits()` in `src/http/auth/allowlist.ts` (the lists come from `src/config/sections/auth.ts`). It's case-insensitive: an email is admitted if it ends with an allowed `@domain` or equals an allowed email.

---

## How to use roles in code

### Path-based (preferred for whole prefixes)

Add an entry to `URL_RULES` in `src/http/auth/policy.ts` (first match wins, so put it before the catch-all `/**`):

```ts
{ patterns: ['/v1/sync/**'], access: { role: 'SYNC' } },
{ patterns: ['/v1/staff/**'], access: { role: 'STAFF', allowlisted: true } },
{ patterns: ['/v1/some-admin-thing/**'], access: { role: 'STAFF', allowlisted: true } },
```

`allowlisted: true` also requires the caller's email to pass the allowlist (every human route should).

### Per-route (when one feature mixes USER and STAFF endpoints)

Add an entry to `METHOD_RULES` in the same file, keyed by the method and the route path exactly as registered. The router evaluates it after the arguments are bound and validated, before the handler (403 `AccessDenied` when it fails):

```ts
'POST /v1/foos/{id}/approve': role('STAFF'),
'PATCH /v1/organizations/{slug}': or(role('STAFF'), check('orgAccess.canEditOrg', 'path.slug')),
```

A `check(...)` names a feature function, registered by the feature with `deps.accessChecks.register(name, fn)` in its `routes.ts`.

### Inside the route handler (when the policy depends on the body)

Ask for the current user and check it yourself:

```ts
r.post('/v1/whatever', { body: DoItRequest, currentUser: true }, ({ user, body }) => {
  if (user!.email !== body.actingFor) {
    throw new ValidationError('actingFor', body.actingFor, 'must be your own email');
  }
  ...
});
```

This is the only path where you should look at the user inside business code. If you're checking "is this user STAFF?" inside a service, prefer to gate the endpoint in `policy.ts` instead (or ask `staffPowers(c)` from `src/http/auth/context.ts`, which withholds staff powers from API keys without the `staff` scope).

---

## How a request flows through the stack

```
HTTP request
   │
   ▼
security headers, CORS, per-IP rate limits (src/http/security.ts, before any authentication; rules match the
decoded path, like routing: a percent-encoded path cannot escape its bucket)
   │
   ▼
API-key step (src/http/security.ts + src/http/auth/apikeys.ts)
   if X-Api-Key starts with "ceitba_":
       hash key, look up in api_keys table
       if found and not expired: mark last_used_at
           scopes lack "write" and the method is not safe → 403 INSUFFICIENT_SCOPE (stop)
           scopes include "staff":
               DB lookup: active ceitba_staff row? → add ROLE_STAFF (+ ROLE_MODERATOR)
               DB lookup: active ceitba_moderators grant? → add ROLE_MODERATOR
           principal = the key with ROLE_USER (+ROLE_STAFF/MODERATOR) and its scopes
               (apiKeyCredential(c): staffPowers drops staff powers without "staff",
               the API-key service refuses key creation / revoking other keys unless the
               key is full power, i.e. holds every scope including "keys")
   else if X-Api-Key matches AUTH_SYNC_API_KEY (static):
       principal = sync (ROLE_SYNC)
   │
   ▼
Bearer step (src/http/security.ts + src/http/auth/jwt.ts)
   token = Authorization: Bearer header, else the session cookie
           (ignored on POST /v1/auth/{google/mobile,refresh,logout,review-login} and the
           other token endpoints in isTokenEndpoint)
   if token (it replaces an API-key principal; a bad token is 401 even on public routes):
       1. Verify HS256 signature against AUTH_JWT_SECRET
       2. Verify exp / nbf, and iss / aud (see below)
       3. jwtRoles:
          a. Add ROLE_USER baseline
          b. DB lookup: if active ceitba_staff row for this user's email, add ROLE_STAFF
          c. add ROLE_MODERATOR if (b) matched or an active ceitba_moderators grant exists
          d. add ROLE_ORG_MEMBER if the user belongs to any organization
       4. principal = the JWT with those roles
   │
   ▼
URL_RULES (src/http/auth/policy.ts) — per-route policy, before routing
   GET  /v1/subjects/*/reviews -> authenticated AND email in allowlist (ahead of the public
                                /v1/subjects/** reads: reviews name professors; SUBJECT-REVIEWS.md)
   public matchers           -> permitAll (a JWT/API key whose email fails the allowlist runs
                                as anonymous there: no STAFF/org-admin/draft reads; not in Java)
   GET  /v1/auth/google, /v1/auth/callback               -> permitAll (web OAuth flow)
   POST /v1/auth/google/mobile, /refresh, /logout        -> permitAll (token endpoints)
   POST /v1/auth/review-login                            -> permitAll (404 unless configured)
   GET  /v1/app/config                                   -> permitAll
   GET  /v1/capabilities                                 -> permitAll (keys enabled for everyone)
   /v1/sync/**               -> role SYNC
   /v1/staff/proposals/**    -> role MODERATOR AND email in allowlist
   /v1/staff/**              -> role STAFF AND email in allowlist
                                (incl. /v1/staff/moderators, /v1/staff/schedule-corrections,
                                /v1/staff/subject-reviews)
   /**                       -> authenticated AND email in allowlist (JWT email, or the
                                API-key owner's email; allowlist + review email while
                                review login is on)
   │
   ▼
METHOD_RULES evaluation (if the route has one), after the arguments are bound
   │
   ▼
Route handler invoked
   if the route asks for the current user (currentUser: true / currentUser(c)):
      JWT path:     reads email+name from the JWT claims,
                    findOrCreateUser() → row exists / new INSERT
      API-key path: returns the key's owner, already loaded by the API-key step
      Handler receives the user row
```

For how a user obtains a JWT in the first place, see [AUTH-SETUP.md § Frontend integration](AUTH-SETUP.md#4-frontend-integration) (web) and [§ Mobile app integration](AUTH-SETUP.md#5-mobile-app-integration).

---

## Sessions and tokens

| | Web SPAs | Mobile app |
|---|---|---|
| Sign-in | `GET /v1/auth/google` → Google → `GET /v1/auth/callback` | Native Google Sign-In → `POST /v1/auth/google/mobile {idToken, nonce?, deviceName?}` |
| Google token check | Server-side code exchange with Google's token endpoint | ID token verified against Google's JWKS: `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` ∈ `AUTH_GOOGLE_MOBILE_AUDIENCES`, `exp` (60 s skew), `nonce` if sent |
| Admission | Google login (`src/features/auth/service.ts`): `email_verified`, allowlist, `hd` ∈ allowed domains when present, find-or-create | same service |
| Access token | JWT in HttpOnly cookie, `AUTH_JWT_TTL_DAYS` (7 d) | JWT in body, `AUTH_MOBILE_ACCESS_TTL` (15 min) |
| Renewal | Sign in again | `POST /v1/auth/refresh {refreshToken}` (rotating, `AUTH_REFRESH_TTL` = 60 d sliding) |
| Logout | `POST /v1/auth/logout` (clears cookie) | `POST /v1/auth/logout {refreshToken}` revokes that token's family; `POST /v1/auth/logout-all` revokes every family of the caller |

Token endpoint errors use the standard error body with a machine code in `error`: `401 invalid_token` (bad/expired/reused Google or refresh token), `403 unverified_email | unauthorized | unauthorized_workspace`, `501` when `AUTH_GOOGLE_MOBILE_AUDIENCES` is empty. The web callback uses the same codes in `?error=`.

**Refresh tokens** (table `refresh_tokens`, V17) are opaque random strings; only their SHA-256 is stored. Each login starts a *family*. `/refresh` revokes the presented token, links it to its successor (`replaced_by`) and returns the successor. Presenting an already-rotated token is treated as theft and revokes the whole family, so the app must never run two refreshes with the same token concurrently. Exception (lost responses): if the rotation happened less than `AUTH_REFRESH_REUSE_GRACE` (60 s) ago and the successor has not been used, the unused successor is revoked (and pointed at the new token, so presenting it later still counts as reuse) and a new successor is issued in the same family. Every refresh re-checks the allowlist: a user removed from it gets `403 unauthorized` and loses the family.

**JWT claims**: `sub` (user id), `email`, `name`, `iat`, `exp`, `iss` (`AUTH_JWT_ISSUER`, default `https://ceitba.org.ar/api`), `aud` = `ceitba-api`, `jti`. Access tokens are stateless: logout, logout-all and account deletion revoke refresh tokens, but an already-issued access JWT stays valid until `exp`.

**`iss`/`aud` enforcement.** `verifyJwt` (`src/http/auth/jwt.ts`) requires both claims on every JWT (`AUTH_JWT_ENFORCE_ISS_AUD=true`, the default since 2026-10-05). History: JWTs issued before B1 (in production 2026-09-27) carried neither claim and lived up to 7 days (`AUTH_JWT_TTL_DAYS`) in web cookies, so B1 shipped with a phase-in (`false`: each claim checked only when present). The last pre-B1 token expired on 2026-10-04, and the default was flipped after that. Setting `false` brings the phase-in back; it isn't needed anymore, and the flag can be removed in a later cleanup.

---

## App Store / Play review login

**Why.** Apple App Review (and Google Play review) need working demo credentials. Everyone else signs in with Google, but a reviewer on a fresh device signing into a Gmail test account routinely hits Google's new-device challenges, and the old Firebase email/password "tester login" is gone with Firebase Auth. So the API offers a password login for **exactly one** account, and only while it is switched on.

**Endpoint.** `POST /v1/auth/review-login` (public, `Cache-Control: no-store`):

```http
POST /api/v1/auth/review-login
Content-Type: application/json

{ "email": "appreview@example.com", "password": "<password>", "deviceName": "iPhone (optional)" }
```

Success is `200` with **exactly the same body as `POST /v1/auth/google/mobile`** (`accessToken`, `accessTokenExpiresAt`, `refreshToken`, `refreshTokenExpiresAt`, `user` = the `GET /v1/auth/me` shape). It goes through the same token-session / refresh-token-family code (`src/features/auth/service.ts`), so `/v1/auth/refresh`, `/logout`, `/logout-all`, `GET /v1/auth/me` and `DELETE /v1/me` work unchanged. Errors:

| Status | `error` | When |
|---|---|---|
| `401` | `invalid_credentials` | Wrong password, any email other than the configured one, or a missing/blank field (the message never says which) |
| `404` | `NotFound` | Review login is disabled (not configured). Field validation only happens after the enabled check, so a disabled endpoint does not reveal itself with a `400` for missing fields |
| `429` | `TooManyRequests` | More than `RATE_LIMIT_REVIEW_LOGIN_CAPACITY` (10) attempts per `RATE_LIMIT_REVIEW_LOGIN_PERIOD` (1 min) from one IP. Its own bucket; the generic `/v1/auth/**` bucket does not apply |

The endpoint is hidden from the Swagger/OpenAPI docs.

**Enable / disable.** Set both env vars (passed through by `docker-compose.yml`), then redeploy so a fresh API container reads them (`cd ~/CEITBA-API && bash deploy-api.sh`, `DEPLOY.md`):

```bash
REVIEW_LOGIN_EMAIL=appreview@example.com
# bcrypt hash only; SINGLE quotes in .env, otherwise compose expands the `$`s:
REVIEW_LOGIN_PASSWORD_HASH='$2a$12$...'
```

Generate the hash with `htpasswd -bnBC 12 "" 'the-password' | tr -d ':\n'` (no `htpasswd`? prefix `docker run --rm httpd:2.4-alpine`); `$2a$`, `$2b$` and `$2y$` hashes are all accepted. At startup the app logs one line: `INFO Review login: disabled`, `WARN Review login: ENABLED ...`, or `ERROR Review login: MISCONFIGURED ...` when only one of the two variables is set or the hash is not a well-formed bcrypt string (60 chars, cost 04-31; surrounding whitespace is trimmed, nothing else). A misconfiguration never stops the API: review login is then treated as disabled (404, sessions not admitted) and the error says what to check, without printing the hash. Leave both variables empty to disable it (the default). **Disable it whenever no store review is pending**: with it off, the endpoint 404s, the review account's refresh tokens stop working (`403 unauthorized` on the next refresh, which revokes the family) and its still-unexpired access JWTs are rejected by the allowlist gate (`403`) right away. Rotate the password (new hash) for each review round and put the plain password only in App Store Connect / Play Console review notes.

**What the account is.** A normal **USER**, nothing more:

- Only the configured email can use this endpoint; there is no other password account and no signup.
- The email bypasses `AUTH_ALLOWED_DOMAINS`/`AUTH_ALLOWED_EMAILS` **for this endpoint only**. After sign-in, `sessionAdmits` (`src/http/auth/allowlist.ts`, used by the allowlist gate of the URL rules in `src/http/security.ts` and by the refresh-token allowlist re-check) admits that one email while review login is enabled. Google sign-in with the same address is still rejected unless it is allowlisted normally.
- The password is only ever stored as a bcrypt hash. Every attempt runs exactly one bcrypt check (against a dummy hash of the same cost when the email does not match), so timing does not reveal the email; the email itself is compared in constant time. Passwords longer than 72 bytes are rejected.
- It is JIT-provisioned on the first login as `App Review` (the name is reset to that on every login) and goes through normal onboarding: no career, plan or file number until the reviewer picks them.
- Nothing grants it STAFF or MODERATOR: those come only from `ceitba_staff` / `ceitba_moderators` rows. Never add one for this account.
- It **cannot create API keys** (`POST /v1/auth/api-keys` → `403`): a key is a long-lived credential and this account only exists for store review.

**What the reviewer can do.** Everything any student can: onboarding (career/plan/legajo), schedules, classrooms, benefits, news, study groups, proposals, push-notification registration, logout, and account deletion (`DELETE /v1/me`, which App Store rule 5.1.1(v) requires them to be able to test; the next review login simply provisions a fresh account).

Code: the review-login part of `src/features/auth/service.ts`, `src/http/auth/allowlist.ts`, `reviewLogin` in `src/config/sections/auth.ts`, `POST /v1/auth/review-login` in `src/features/auth/routes.ts`.

---

## Account deletion (`DELETE /v1/me`)

Self-service, required by App Store rule 5.1.1(v). Runs in one transaction (`src/features/user/accountDeletion.ts`):

| Data | Policy |
|---|---|
| `refresh_tokens`, `api_keys` | Deleted (all sessions and keys revoked) |
| `user_devices` | Deleted (no more push notifications) |
| `ceitba_staff`, `user_follows`, `user_organizations` | Deleted |
| `saved_schedules`, `share_session_participants`, `share_sessions` created by the user (with everyone's participation in them) | Deleted |
| `study_groups` owned by the user | Passed to the earliest remaining joiner (as when an owner leaves); deleted only when the user was the sole member |
| The user's `study_group_participants` rows | Deleted |
| `wiki.subject_difficulty`, all wiki votes cast by the user, both bookmark tables | Deleted |
| `wiki.subject_comment` by the user, and all votes on those comments | Deleted (personal free text) |
| `wiki.subject_wiki_edit_proposal` with status `PENDING` | Deleted |
| `subject_review` by the user (with its professor links, votes and reports), the user's `subject_review_helpful` and `subject_review_report` rows | Deleted, after decrementing the report counts of the reviews they reported ([SUBJECT-REVIEWS.md](SUBJECT-REVIEWS.md)) |
| `articles.created_by`, `news_events.created_by` | Set to `NULL` (content belongs to the organization) |
| `article_comment_likes`, `article_comment_reports`, `article_poll_votes` of the user | Deleted |
| `article_comments` by the user | Replies and comments without replies deleted; the rest become tombstones (author `NULL`, body emptied) so others' replies keep their thread (`docs/NEWSLETTER-ENGAGEMENT.md`) |
| `schedule_correction_vote` rows of the user | Deleted, after decrementing the corrections' counters (statuses are not re-evaluated) |
| `schedule_correction.suggester_id` / `reviewed_by` | Set to `NULL` (corrections are crowd data and stay) |
| `wiki.subject_note`, `wiki.career_note`, `wiki.subject_wiki_page.updated_by`, reviewed edit proposals | Kept: shared study material with a NOT NULL author FK |
| `user` row | Hard-deleted when nothing above is kept; otherwise **anonymized**: every personal column cleared and the email replaced by `deleted-<id>@deleted.invalid` |
| Legacy Firebase uid (`user.firebase_uid`, set by the Firestore import) | Its SHA-256 goes into `deleted_firebase_accounts`, so a re-run of the Firestore import skips the account instead of re-creating it |

The response clears the web session cookie. Signing in again with the same Google account creates a new, unrelated user.

**Known gap: re-provisioning by a still-valid access JWT.** Deletion removes refresh tokens and API keys, but access JWTs are stateless. The cookie cleared is only the one of the browser that made the call; a web session cookie on another browser or device stays valid for up to `AUTH_JWT_TTL_DAYS` (7 d), and a mobile access token for up to `AUTH_MOBILE_ACCESS_TTL` (15 min). The first current-user request carrying such a token JIT-provisions the email again as a new, empty account (never linked to the deleted data). Closing this needs access-token revocation (see [Tech debt](#tech-debt--future-hardening)), e.g. a deletion tombstone per email hash that rejects tokens whose `iat` predates it at provisioning time.

Guards:

- **Session only.** The call must be authenticated with our JWT (web cookie or mobile bearer). A per-user `ceitba_` API key gets `403`, so a leaked script key cannot wipe its owner's account.
- **Last staff member.** If the caller is the only active `ceitba_staff` row, the call fails with `409 LastActiveStaff`: STAFF can only be re-bootstrapped with raw SQL, so they must grant the role to someone else first. The check locks the active `ceitba_staff` rows, so two staff members deleting their accounts at the same time cannot leave zero staff.

---

## Tested coverage

Contract tests (`contract/tests/*.contract.test.ts`, black-box over HTTP) and in-process tests (`test/**`); test names are kept from the Java suites they port.

| Concern | Test |
|---|---|
| Public endpoint, no token → 200 | `auth.contract.test.ts` `publicEndpointsAreReachableWithoutAuth` |
| Protected endpoint, no token → 401 | `auth.contract.test.ts` `protectedEndpointWithoutTokenReturns401` |
| `/sync` no/wrong/correct key → 401/401/200 | `auth.contract.test.ts` `sync*ApiKey*`, `test/auth/units.test.ts` (`ApiKeyFilterTest`) |
| Allowlist admits ITBA domain | `test/auth/units.test.ts` `allowlistAdmitsItbaDomain` |
| API-key scopes (read-only, `[]` = read-only, staff incl. `/auth/me` and capabilities, key minting incl. encoded paths, self-revoke, allowlisted owner) | `api-key-scopes.contract.test.ts`, `test/auth/units.test.ts` (`ApiKeyFilterTest`), `test/capability/CapabilityService.test.ts` |
| Allowlist admits explicit external email | `test/auth/units.test.ts` `allowlistAdmitsExplicitlyListedExternalEmail` |
| Allowlist rejects unknown domain | `test/auth/units.test.ts` `allowlistRejectsUnknownDomain` |
| Allowlist case-insensitive | `test/auth/units.test.ts` `allowlistIsCaseInsensitive` |
| Fresh user gets ROLE_USER only | `test/auth/roles.test.ts` `freshUserGetsRoleUserOnly` |
| User with active ceitba_staff row gets ROLE_STAFF | `test/auth/roles.test.ts` `userWithActiveStaffRowGetsRoleStaff` |
| Expired ceitba_staff row doesn't grant ROLE_STAFF | `test/auth/roles.test.ts` `userWithExpiredStaffRowGetsRoleUserOnly` |
| Future ceitba_staff row doesn't grant ROLE_STAFF | `test/auth/roles.test.ts` `userWithFutureStaffRowGetsRoleUserOnly` |
| Disallowed email rejected | `auth.contract.test.ts` `notAllowlistedEmailIsForbidden` |
| Anonymous can't list/assign staff | `staff-endpoints.contract.test.ts` `anonymousCannotListStaff` |
| USER (no STAFF) can't list/assign | `staff-endpoints.contract.test.ts` `regularUserCannot*` |
| STAFF can list/assign/revoke | `staff-endpoints.contract.test.ts` `staffCan*` |
| Duplicate staff assignment → 409 | `staff-endpoints.contract.test.ts` `assigningSamePersonTwiceReturns409` |
| Revoke end-dates active membership | `staff-endpoints.contract.test.ts` `revokeEndDatesActiveMembershipSoListingDropsIt` |
| `/v1/users/**` requires STAFF | `user-endpoints.contract.test.ts` `regularUser*Returns403` |
| Anonymous can't create/list users | `user-endpoints.contract.test.ts` `anonymous*Returns401` |
| STAFF can create/list users | `user-endpoints.contract.test.ts` `staffCan*` |
| Disallowed email rejected even with claimed STAFF authority | `user-endpoints.contract.test.ts` `disallowedEmailReturns403EvenWithStaffAuthorities` |
| Mobile ID-token exchange (valid, unverified, not allowlisted, workspace, wrong aud/iss, expired, nonce, idempotent provisioning) | `auth-mobile.contract.test.ts`, `test/auth/mobile-login.test.ts` |
| Refresh rotation, reuse revokes the family, lost-response grace window, allowlist re-check, logout / logout-all | `refresh-token.contract.test.ts`, `test/auth/refresh-concurrency.test.ts` |
| Account deletion: hard delete vs anonymize, tokens revoked, API keys rejected, last-staff guard | `user-account-deletion.contract.test.ts`, `test/user/account-deletion-concurrency.test.ts` |
| `iss`/`aud` phase-in validation | `test/auth/units.test.ts` (`IssuerAudienceValidatorTest`), `jwt-issuer-audience.contract.test.ts` |
| STAFF implies ROLE_MODERATOR | `test/auth/roles.test.ts` `userWithActiveStaffRowGetsRoleStaff`, `staff-moderators.contract.test.ts` `staffImpliesModerator` |
| MODERATOR grant / revoke / re-grant, audit row kept, 404/409 | `staff-moderators.contract.test.ts`, `test/staff/moderator-roles.test.ts` |
| USER and MODERATOR cannot manage moderator grants | `staff-moderators.contract.test.ts` `userAndModeratorCannotManageGrants` |
| `moderator` flag on `/v1/auth/me` | `auth-me.contract.test.ts` `meModeratorFlagFollowsActiveGrant`, `staff-moderators.contract.test.ts` |
| Proposal moderation open to MODERATOR, 403 for USER and non-allowlisted, MODERATOR is not STAFF elsewhere | `proposal-staff.contract.test.ts` |
| Review login: wrong password / other email / blank → 401, success = mobile token shape, USER only (not staff/moderator), allowlist admits only that email, Google login for it still rejected, refresh, no API keys, own rate-limit bucket | `review-login.contract.test.ts`, `test/auth/review-google.test.ts` |
| Review login disabled → 404 (even with an empty body) | `review-login-disabled.contract.test.ts` |
| Schedule corrections: suggest/vote/me need an allowlisted session (401/403), staff endpoints 403 for USER, no response exposes the suggester | `correction-schedule.contract.test.ts`, `test/correction/schedule-correction.test.ts` |
| Review login always runs one bcrypt check (unknown email, wrong/overlong/missing password) | `test/auth/review-login-service.test.ts` |
| A mangled review hash (unquoted in `.env`, trailing `%`, truncated) disables review login instead of failing startup | `test/auth/review-login-service.test.ts`, `review-login-disabled.contract.test.ts` |
| Review email admitted by the session allowlist only while review login is enabled | `test/auth/units.test.ts` (`SessionAllowlistTest`) |

---

## Tech debt / future hardening

- **Per-branch authorization** (e.g. only IT staff can touch `/v1/sync/**`). The data is there (`ceitba_staff.branch`), the policy isn't. When this matters, add roles such as `STAFF_IT` to `src/http/auth/principal.ts` and gate paths accordingly in `policy.ts`.
- **Web refresh tokens.** Mobile clients have rotating refresh tokens; the web cookie still requires a re-login every 7 days.
- **Enforce `iss`/`aud`** — see the dated follow-up in [§ Sessions and tokens](#sessions-and-tokens).
- **Access-token revocation.** Access JWTs are stateless; a `token_version` column checked in `jwtRoles` (`src/http/security.ts`, which already hits the DB per request) would let logout-all and account deletion cut them off immediately. Until then a deleted account can be re-provisioned (empty) by a web cookie issued before the deletion, for up to `AUTH_JWT_TTL_DAYS`.
- **Cache the staff and moderator lookups** if the role-detection DB hit shows up in flame graphs (it currently runs on every JWT/API-key request). An in-memory cache (e.g. `lru-cache`) with TTL ≤ minimum role-validity window would be enough.
- **Narrower API-key scopes.** Keys carry `read` / `report` / `write` / `staff` / `keys` (V62); per-route scopes (e.g. "proposals:write") would need a scope map per feature. New code that grants staff powers asks `staffPowers(c)` (`src/http/auth/context.ts`) instead of the staff/moderator queries.

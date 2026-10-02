# Auth & roles

How identity, roles, and access control work in CEITBA-API. Read this before changing any of `config/SecurityConfig.java`, `web/auth/*`, or anything in `service/auth/`.

---

## TL;DR

| You are… | What you send | What you can do |
|---|---|---|
| **Anonymous** | nothing | Read public endpoints (health, careers, subjects, plans, classrooms, commissions, highlights, benefits, GET wiki bookmarks, POST classrooms/conflicts, GET `/v1/app/config`); call the token endpoints (`POST /v1/auth/google/mobile`, `/v1/auth/refresh`, `/v1/auth/logout`, and `/v1/auth/review-login` [while enabled](#app-store--play-review-login)) |
| **USER** | `Authorization: Bearer <jwt>` or the web session cookie (email passes the allowlist) | Everything anonymous can do, **plus** create/delete wiki bookmarks, manage your own API keys, `POST /v1/auth/logout-all`, `DELETE /v1/me` (JWT session only, not API keys) |
| **USER via API key** | `X-Api-Key: ceitba_<key>` | Same as USER |
| **MODERATOR** | Same JWT or API key, plus an active `ceitba_moderators` grant (or active STAFF) | Everything USER can do, **plus** moderation endpoints that require `ROLE_MODERATOR` (`/v1/staff/proposals/**`, editing/deleting any study group) |
| **STAFF** | Same JWT or API key, plus an active `ceitba_staff` row | Everything USER and MODERATOR can do, **plus** assign/revoke STAFF and MODERATOR on others, create users and correct a user's file number (`/v1/users/**`) |
| **SYNC** (machine, not human) | `X-Api-Key: <AUTH_SYNC_API_KEY>` | Trigger `/v1/sync/**` jobs |

JWTs are issued by this API (HS256, `AUTH_JWT_SECRET`) after a Google sign-in, either the web OAuth flow (JWT in an HttpOnly cookie) or the mobile ID-token exchange (JWT + refresh token in the response body). The one exception is the [store review account](#app-store--play-review-login), which signs in with an email and password. Google tokens are never accepted as bearer tokens. See [AUTH-SETUP.md](AUTH-SETUP.md) to configure login and [§ Sessions and tokens](#sessions-and-tokens) below.

`Anonymous` isn't actually a role; it's the absence of any authentication. The others (`USER`, `MODERATOR`, `STAFF`, `SYNC`) map to Spring Security `ROLE_*` authorities.

---

## How roles are assigned

### USER — automatic on first sign-in

Anyone whose JWT or API-key email passes the [allowlist](#how-to-add-a-new-authorized-user-without-making-them-staff) gets `ROLE_USER`. There's **no signup endpoint**: a `User` row is created on the first successful Google sign-in (web callback or mobile exchange, both through `service/auth/GoogleLoginService.java`) or the first time a JWT hits a controller method that asks for `@CurrentUser User user`. That's "JIT provisioning" — see `service/auth/UserProvisioningService.java`. New users auto-follow the `ceitba` organization. Sign-in does **not** fill any academic data: ITBA revoked CEITBA's access to the SGA student lookup in 2026-09, so the SGA prefill (and `POST /v1/me/profile/sync-from-sga`) is gone. Users pick their career and plan during app onboarding and enter their file number (legajo) themselves via `PATCH /v1/me/profile`. The file number can be set only while it is empty and must be unique (409 `FileNumberAlreadySet` / `FileNumberTaken`); after that only STAFF can change or clear it (`PATCH /v1/users/{id}/file-number`).

If you authenticate but never hit a `@CurrentUser` route, no row is created. The role is still granted (`ROLE_USER`), so you can call any USER-level endpoint immediately.

### STAFF — granted via an active `ceitba_staff` row

Spring Security adds `ROLE_STAFF` if the request's email maps to a `User` row that has a `ceitba_staff` record where `start <= now <= end`. The check happens on every authenticated request inside [`StaffAwareJwtAuthenticationConverter`](../src/main/java/org/ceitba/api/web/auth/StaffAwareJwtAuthenticationConverter.java) — one DB lookup per request, no cache.

A user can only be in **one** branch at a time (`ceitba_staff.user_id` is the primary key). To change someone's branch or role, revoke their current membership and assign a new one.

### MODERATOR — a narrow grant, separate from STAFF

`ROLE_MODERATOR` is for people who moderate user-generated content without any other staff power. It is granted when either:

- the user is active STAFF (**STAFF implies MODERATOR**; no row needed), or
- the user has a `ceitba_moderators` row with `revoked_at IS NULL` (V19).

Both checks run in the same places as the STAFF check: `StaffAwareJwtAuthenticationConverter` (JWTs) and `ApiKeyFilter` (user API keys), once per request, no cache. `GET /v1/auth/me` (and the `user` object of the mobile token responses) exposes it as `"moderator": true|false`; `role` stays `"staff"` or `"user"`.

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

Org membership is not a Spring role: it is a `user_organizations` row whose `role` is `member` or `admin` (the only values the API accepts on write). Members can manage their org's profile, articles and events; only `admin` members (and STAFF) can list the org's followers (`GET /v1/organizations/{slug}/followers`, which exposes names and emails). Only STAFF manages memberships:

```http
POST   /api/v1/users/{userId}/organizations          {"slug": "sabf", "role": "member"}  -> 201
PATCH  /api/v1/users/{userId}/organizations/{slug}   {"role": "admin"}                    -> 200 {slug, role}
DELETE /api/v1/users/{userId}/organizations/{slug}                                        -> 204
```

`POST` returns `409` if the membership already exists (use `PATCH` to change its role); `PATCH` returns `404` if it doesn't; both return `400` for a role other than `member`/`admin`. `GET /v1/users` lists each user's memberships as `organizations: [{slug, role}]`.

### SYNC — `X-Api-Key` (static key) only

Cron jobs and ops scripts authenticate with a static header against `AUTH_SYNC_API_KEY`. The [`ApiKeyFilter`](../src/main/java/org/ceitba/api/web/auth/ApiKeyFilter.java) translates a matching key into a `ROLE_SYNC` principal. This skips the JWT path entirely. Bug bias: if `AUTH_SYNC_API_KEY` is empty/unset, every `/sync` request returns 401. Fail-closed by design.

User API keys (prefixed `ceitba_`) also go through `X-Api-Key` but they are looked up in the `api_keys` table and grant `ROLE_USER` / `ROLE_STAFF` / `ROLE_MODERATOR`, not `ROLE_SYNC`. See [AUTH-SETUP.md § User API keys](AUTH-SETUP.md#6-user-api-keys).

---

## How to bootstrap the first STAFF member

The `POST /v1/staff` endpoint requires `ROLE_STAFF` to call. Chicken-and-egg: until someone is staff, nobody can grant staff. Bootstrap manually with SQL.

```sql
-- 1. The user must already exist. If they've ever hit a @CurrentUser route
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

The admission rule is in [`AuthProperties.admits()`](../src/main/java/org/ceitba/api/config/AuthProperties.java). It's case-insensitive and checks the explicit list before the domain list.

---

## How to use roles in code

### Path-based (preferred for whole controllers/prefixes)

In `SecurityConfig.java`'s `authorizeHttpRequests` block:

```java
.requestMatchers("/v1/staff/**").hasRole("STAFF")
.requestMatchers("/v1/sync/**").hasRole("SYNC")
.requestMatchers("/v1/some-admin-thing/**").hasRole("STAFF")
```

`hasRole("X")` matches authority `ROLE_X` (Spring Security's prefix convention).

### Per-method (when one controller mixes USER and STAFF endpoints)

`@EnableMethodSecurity` is on; use `@PreAuthorize` on the controller method:

```java
@PostMapping("/{id}/approve")
@PreAuthorize("hasRole('STAFF')")
public Foo approve(@PathVariable UUID id) { ... }
```

### Inside the controller (when the policy depends on the body)

Pull the `@CurrentUser` and check it yourself:

```java
@PostMapping("/whatever")
public Foo doIt(@CurrentUser User user, @RequestBody DoItRequest req) {
    if (!user.getEmail().equals(req.actingFor())) {
        throw new ValidationException("actingFor", req.actingFor(), "must be your own email");
    }
    ...
}
```

This is the only path where you should look at the user inside business code. If you're checking "is this user STAFF?" inside a service, prefer to gate the endpoint at `SecurityConfig` level instead.

---

## How a request flows through the stack

```
HTTP request
   │
   ▼
ApiKeyFilter (custom, runs before Spring Security)
   if X-Api-Key starts with "ceitba_":
       hash key, look up in api_keys table
       if found and not expired: mark last_used_at
           DB lookup: active CeitbaStaff? → add ROLE_STAFF (+ ROLE_MODERATOR)
           DB lookup: active ceitba_moderators grant? → add ROLE_MODERATOR
           set Authentication = ROLE_USER (+ROLE_STAFF/MODERATOR) principal = User entity
   else if X-Api-Key matches AUTH_SYNC_API_KEY (static):
       set Authentication = ROLE_SYNC principal "sync-job"
   │
   ▼
OAuth2 Resource Server filter (Spring Security)
   token = Authorization: Bearer header, else the session cookie
           (ignored on POST /v1/auth/{google/mobile,refresh,logout,review-login})
   if token AND no auth set yet:
       1. Verify HS256 signature against AUTH_JWT_SECRET
       2. Verify exp / nbf, and iss / aud (phase-in, see below)
       3. Call StaffAwareJwtAuthenticationConverter:
          a. Add ROLE_USER baseline
          b. DB lookup: if active CeitbaStaff for this user's email, add ROLE_STAFF
          c. add ROLE_MODERATOR if (b) matched or an active ceitba_moderators grant exists
          d. add ROLE_ORG_MEMBER if the user belongs to any organization
       4. Set Authentication = JwtAuthenticationToken with the authorities
   │
   ▼
authorizeHttpRequests() — per-route policy from SecurityConfig
   public matchers           -> permitAll
   GET  /v1/auth/google, /v1/auth/callback               -> permitAll (web OAuth flow)
   POST /v1/auth/google/mobile, /refresh, /logout        -> permitAll (token endpoints)
   POST /v1/auth/review-login                            -> permitAll (404 unless configured)
   GET  /v1/app/config                                   -> permitAll
   /v1/sync/**               -> hasRole("SYNC")
   /v1/staff/proposals/**    -> hasRole("MODERATOR") AND email in allowlist
   /v1/staff/**              -> hasRole("STAFF") AND email in allowlist
                                (incl. /v1/staff/moderators, /v1/staff/schedule-corrections)
   anyRequest()              -> authenticated() AND email in allowlist (JWT only;
                                allowlist + review email while review login is on)
   │
   ▼
@PreAuthorize evaluation (if used on the controller method)
   │
   ▼
Controller method invoked
   if @CurrentUser User user is in the signature:
      JWT path:     CurrentUserResolver reads email+name from JWT claims
                    UserProvisioningService.findOrCreate() → row exists / new INSERT
      API-key path: CurrentUserResolver returns the User already set by ApiKeyFilter
      Controller receives the managed User entity
```

For how a user obtains a JWT in the first place, see [AUTH-SETUP.md § Frontend integration](AUTH-SETUP.md#4-frontend-integration) (web) and [§ Mobile app integration](AUTH-SETUP.md#5-mobile-app-integration).

---

## Sessions and tokens

| | Web SPAs | Mobile app |
|---|---|---|
| Sign-in | `GET /v1/auth/google` → Google → `GET /v1/auth/callback` | Native Google Sign-In → `POST /v1/auth/google/mobile {idToken, nonce?, deviceName?}` |
| Google token check | Server-side code exchange with Google's token endpoint | ID token verified against Google's JWKS: `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` ∈ `AUTH_GOOGLE_MOBILE_AUDIENCES`, `exp` (60 s skew), `nonce` if sent |
| Admission | `GoogleLoginService`: `email_verified`, allowlist, `hd` ∈ allowed domains when present, find-or-create | same service |
| Access token | JWT in HttpOnly cookie, `AUTH_JWT_TTL_DAYS` (7 d) | JWT in body, `AUTH_MOBILE_ACCESS_TTL` (15 min) |
| Renewal | Sign in again | `POST /v1/auth/refresh {refreshToken}` (rotating, `AUTH_REFRESH_TTL` = 60 d sliding) |
| Logout | `POST /v1/auth/logout` (clears cookie) | `POST /v1/auth/logout {refreshToken}` revokes that token's family; `POST /v1/auth/logout-all` revokes every family of the caller |

Token endpoint errors use the standard error body with a machine code in `error`: `401 invalid_token` (bad/expired/reused Google or refresh token), `403 unverified_email | unauthorized | unauthorized_workspace`, `501` when `AUTH_GOOGLE_MOBILE_AUDIENCES` is empty. The web callback uses the same codes in `?error=`.

**Refresh tokens** (table `refresh_tokens`, V17) are opaque random strings; only their SHA-256 is stored. Each login starts a *family*. `/refresh` revokes the presented token, links it to its successor (`replaced_by`) and returns the successor. Presenting an already-rotated token is treated as theft and revokes the whole family, so the app must never run two refreshes with the same token concurrently. Exception (lost responses): if the rotation happened less than `AUTH_REFRESH_REUSE_GRACE` (60 s) ago and the successor has not been used, the unused successor is revoked (and pointed at the new token, so presenting it later still counts as reuse) and a new successor is issued in the same family. Every refresh re-checks the allowlist: a user removed from it gets `403 unauthorized` and loses the family.

**JWT claims**: `sub` (user id), `email`, `name`, `iat`, `exp`, `iss` (`AUTH_JWT_ISSUER`, default `https://ceitba.org.ar/api`), `aud` = `ceitba-api`, `jti`. Access tokens are stateless: logout, logout-all and account deletion revoke refresh tokens, but an already-issued access JWT stays valid until `exp`.

**`iss`/`aud` phase-in (follow-up with a date).** JWTs issued before B1 have neither claim and live up to 7 days in web cookies. While `AUTH_JWT_ENFORCE_ISS_AUD=false` (default), `IssuerAudienceValidator` checks each claim only when it is present. **Follow-up:** 7 days after B1 reaches production (B1 deploy date + `AUTH_JWT_TTL_DAYS`), set `AUTH_JWT_ENFORCE_ISS_AUD=true` in prod so both claims become mandatory, then consider removing the flag.

---

## App Store / Play review login

**Why.** Apple App Review (and Google Play review) need working demo credentials. Everyone else signs in with Google, but a reviewer on a fresh device signing into a Gmail test account routinely hits Google's new-device challenges, and the old Firebase email/password "tester login" is gone with Firebase Auth. So the API offers a password login for **exactly one** account, and only while it is switched on.

**Endpoint.** `POST /v1/auth/review-login` (public, `Cache-Control: no-store`):

```http
POST /api/v1/auth/review-login
Content-Type: application/json

{ "email": "appreview@example.com", "password": "<password>", "deviceName": "iPhone (optional)" }
```

Success is `200` with **exactly the same body as `POST /v1/auth/google/mobile`** (`accessToken`, `accessTokenExpiresAt`, `refreshToken`, `refreshTokenExpiresAt`, `user` = the `GET /v1/auth/me` shape). It goes through the same `TokenSessionService` / refresh-token-family code, so `/v1/auth/refresh`, `/logout`, `/logout-all`, `GET /v1/auth/me` and `DELETE /v1/me` work unchanged. Errors:

| Status | `error` | When |
|---|---|---|
| `401` | `invalid_credentials` | Wrong password, any email other than the configured one, or a missing/blank field (the message never says which) |
| `404` | `NotFound` | Review login is disabled (not configured). Field validation only happens after the enabled check, so a disabled endpoint does not reveal itself with a `400` for missing fields |
| `429` | `TooManyRequests` | More than `RATE_LIMIT_REVIEW_LOGIN_CAPACITY` (10) attempts per `RATE_LIMIT_REVIEW_LOGIN_PERIOD` (1 min) from one IP. Its own bucket; the generic `/v1/auth/**` bucket does not apply |

The endpoint is hidden from the Swagger/OpenAPI docs.

**Enable / disable.** Set both env vars (passed through by `docker-compose.yml`), then recreate the `ceitba-api` container:

```bash
REVIEW_LOGIN_EMAIL=appreview@example.com
# bcrypt hash only; SINGLE quotes in .env, otherwise compose expands the `$`s:
REVIEW_LOGIN_PASSWORD_HASH='$2a$12$...'
```

Generate the hash with `htpasswd -bnBC 12 "" 'the-password' | tr -d ':\n' | sed 's/^\$2y/$2a/'` (no `htpasswd`? prefix `docker run --rm httpd:2.4-alpine`). The app refuses to start if the hash is not a bcrypt hash, and logs a `WARN` at startup while review login is on. Leave either variable empty to disable it (the default). **Disable it whenever no store review is pending**: with it off, the endpoint 404s, the review account's refresh tokens stop working (`403 unauthorized` on the next refresh, which revokes the family) and its still-unexpired access JWTs are rejected by the allowlist gate (`403`) right away. Rotate the password (new hash) for each review round and put the plain password only in App Store Connect / Play Console review notes.

**What the account is.** A normal **USER**, nothing more:

- Only the configured email can use this endpoint; there is no other password account and no signup.
- The email bypasses `AUTH_ALLOWED_DOMAINS`/`AUTH_ALLOWED_EMAILS` **for this endpoint only**. After sign-in, `SessionAllowlist` (used by the post-auth `AuthorizationManager` in `SecurityConfig` and by the refresh-token allowlist re-check) admits that one email while review login is enabled. Google sign-in with the same address is still rejected unless it is allowlisted normally.
- The password is only ever stored as a bcrypt hash. Every attempt runs exactly one bcrypt check (against a dummy hash of the same cost when the email does not match), so timing does not reveal the email; the email itself is compared in constant time. Passwords longer than 72 bytes are rejected.
- It is JIT-provisioned on the first login as `App Review` (the name is reset to that on every login) and goes through normal onboarding: no career, plan or file number until the reviewer picks them.
- Nothing grants it STAFF or MODERATOR: those come only from `ceitba_staff` / `ceitba_moderators` rows. Never add one for this account.
- It **cannot create API keys** (`POST /v1/auth/api-keys` → `403`), because API keys skip the allowlist and would outlive disabling review login.

**What the reviewer can do.** Everything any student can: onboarding (career/plan/legajo), schedules, classrooms, benefits, news, study groups, proposals, push-notification registration, logout, and account deletion (`DELETE /v1/me`, which App Store rule 5.1.1(v) requires them to be able to test; the next review login simply provisions a fresh account).

Code: `service/auth/ReviewLoginService`, `service/auth/SessionAllowlist`, `config/ReviewLoginProperties`, `TokenAuthController.reviewLogin`.

---

## Account deletion (`DELETE /v1/me`)

Self-service, required by App Store rule 5.1.1(v). Runs in one transaction (`service/user/AccountDeletionService`):

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
| `articles.created_by`, `news_events.created_by` | Set to `NULL` (content belongs to the organization) |
| `schedule_correction_vote` rows of the user | Deleted, after decrementing the corrections' counters (statuses are not re-evaluated) |
| `schedule_correction.suggester_id` / `reviewed_by` | Set to `NULL` (corrections are crowd data and stay) |
| `wiki.subject_note`, `wiki.career_note`, `wiki.subject_wiki_page.updated_by`, reviewed edit proposals | Kept: shared study material with a NOT NULL author FK |
| `user` row | Hard-deleted when nothing above is kept; otherwise **anonymized**: every personal column cleared and the email replaced by `deleted-<id>@deleted.invalid` |
| Legacy Firebase uid (`user.firebase_uid`, set by the Firestore import) | Its SHA-256 goes into `deleted_firebase_accounts`, so a re-run of the Firestore import skips the account instead of re-creating it |

The response clears the web session cookie. Signing in again with the same Google account creates a new, unrelated user.

**Known gap: re-provisioning by a still-valid access JWT.** Deletion removes refresh tokens and API keys, but access JWTs are stateless. The cookie cleared is only the one of the browser that made the call; a web session cookie on another browser or device stays valid for up to `AUTH_JWT_TTL_DAYS` (7 d), and a mobile access token for up to `AUTH_MOBILE_ACCESS_TTL` (15 min). The first `@CurrentUser` request carrying such a token JIT-provisions the email again as a new, empty account (never linked to the deleted data). Closing this needs access-token revocation (see [Tech debt](#tech-debt--future-hardening)), e.g. a deletion tombstone per email hash that rejects tokens whose `iat` predates it at provisioning time.

Guards:

- **Session only.** The call must be authenticated with our JWT (web cookie or mobile bearer). A per-user `ceitba_` API key gets `403`, so a leaked script key cannot wipe its owner's account.
- **Last staff member.** If the caller is the only active `ceitba_staff` row, the call fails with `409 LastActiveStaff`: STAFF can only be re-bootstrapped with raw SQL, so they must grant the role to someone else first. The check locks the active `ceitba_staff` rows, so two staff members deleting their accounts at the same time cannot leave zero staff.

---

## Tested coverage

| Concern | Test |
|---|---|
| Public endpoint, no token → 200 | `AuthIT.publicEndpointsAreReachableWithoutAuth` |
| Protected endpoint, no token → 401 | `AuthIT.protectedEndpointWithoutTokenReturns401` |
| `/sync` no/wrong/correct key → 401/401/200 | `AuthIT.sync*ApiKey*` |
| Allowlist admits ITBA domain | `AuthIT.allowlistAdmitsItbaDomain` |
| Allowlist admits explicit external email | `AuthIT.allowlistAdmitsExplicitlyListedExternalEmail` |
| Allowlist rejects unknown domain | `AuthIT.allowlistRejectsUnknownDomain` |
| Allowlist case-insensitive | `AuthIT.allowlistIsCaseInsensitive` |
| Fresh user gets ROLE_USER only | `StaffRoleDetectionIT.freshUserGetsRoleUserOnly` |
| User with active CeitbaStaff gets ROLE_STAFF | `StaffRoleDetectionIT.userWithActiveStaffRowGetsRoleStaff` |
| Expired CeitbaStaff doesn't grant ROLE_STAFF | `StaffRoleDetectionIT.userWithExpiredStaffRowGetsRoleUserOnly` |
| Future CeitbaStaff doesn't grant ROLE_STAFF | `StaffRoleDetectionIT.userWithFutureStaffRowGetsRoleUserOnly` |
| Disallowed email rejected at converter | `StaffRoleDetectionIT.disallowedEmailIsRejected` |
| Anonymous can't list/assign staff | `StaffEndpointsIT.anonymousCannotListStaff` |
| USER (no STAFF) can't list/assign | `StaffEndpointsIT.regularUserCannot*` |
| STAFF can list/assign/revoke | `StaffEndpointsIT.staffCan*` |
| Duplicate staff assignment → 409 | `StaffEndpointsIT.assigningSamePersonTwiceReturns409` |
| Revoke end-dates active membership | `StaffEndpointsIT.revokeEndDatesActiveMembershipSoListingDropsIt` |
| `/v1/users/**` requires STAFF | `UserEndpointsIT.regularUser*Returns403` |
| Anonymous can't create/list users | `UserEndpointsIT.anonymous*Returns401` |
| STAFF can create/list users | `UserEndpointsIT.staffCan*` |
| Disallowed email rejected even with claimed STAFF authority | `UserEndpointsIT.disallowedEmailReturns403EvenWithStaffAuthorities` |
| Mobile ID-token exchange (valid, unverified, not allowlisted, workspace, wrong aud/iss, expired, nonce, idempotent provisioning) | `AuthMobileIT` |
| Refresh rotation, reuse revokes the family, lost-response grace window, allowlist re-check, logout / logout-all | `RefreshTokenIT` |
| Account deletion: hard delete vs anonymize, tokens revoked, API keys rejected, last-staff guard | `AccountDeletionIT` |
| `iss`/`aud` phase-in validation | `IssuerAudienceValidatorTest` |
| STAFF implies ROLE_MODERATOR | `StaffRoleDetectionIT.userWithActiveStaffRowGetsRoleStaff`, `ModeratorIT.staffImpliesModerator` |
| MODERATOR grant / revoke / re-grant, audit row kept, 404/409 | `ModeratorIT` |
| USER and MODERATOR cannot manage moderator grants | `ModeratorIT.userAndModeratorCannotManageGrants` |
| `moderator` flag on `/v1/auth/me` | `AuthMeIT.meModeratorFlagFollowsActiveGrant`, `ModeratorIT` |
| Proposal moderation open to MODERATOR, 403 for USER and non-allowlisted, MODERATOR is not STAFF elsewhere | `StaffProposalControllerIT` |
| Review login: wrong password / other email / blank → 401, success = mobile token shape, USER only (not staff/moderator), allowlist admits only that email, Google login for it still rejected, refresh, no API keys, own rate-limit bucket | `ReviewLoginIT` |
| Review login disabled → 404 (even with an empty body) | `ReviewLoginDisabledIT` |
| Schedule corrections: suggest/vote/me need an allowlisted session (401/403), staff endpoints 403 for USER, no response exposes the suggester | `ScheduleCorrectionIT` |
| Review login always runs one bcrypt check (unknown email, wrong/overlong/missing password) | `ReviewLoginServiceTest` |
| Review email admitted by the session allowlist only while review login is enabled | `SessionAllowlistTest` |


---

## Tech debt / future hardening

- **Per-branch authorization** (e.g. only IT staff can touch `/v1/sync/**`). The data is there (`ceitba_staff.branch`), the policy isn't. When this matters, model authorities as `ROLE_STAFF_IT` etc. and gate paths accordingly.
- **Web refresh tokens.** Mobile clients have rotating refresh tokens; the web cookie still requires a re-login every 7 days.
- **Enforce `iss`/`aud`** — see the dated follow-up in [§ Sessions and tokens](#sessions-and-tokens).
- **Access-token revocation.** Access JWTs are stateless; a `token_version` column checked in `StaffAwareJwtAuthenticationConverter` (which already hits the DB per request) would let logout-all and account deletion cut them off immediately. Until then a deleted account can be re-provisioned (empty) by a web cookie issued before the deletion, for up to `AUTH_JWT_TTL_DAYS`.
- **Cache the staff and moderator lookups** if the role-detection DB hit shows up in flame graphs (it currently runs on every JWT/API-key request). Caffeine with TTL ≤ minimum role-validity window would be enough.
- **Allowlist check for API keys.** JWT requests pass the email allowlist gate in `SecurityConfig`; API-key requests bypass it (the email was already validated at key-creation time). If a user is later removed from the allowlist, their existing API keys stay valid until they expire. Revoke them manually if needed.

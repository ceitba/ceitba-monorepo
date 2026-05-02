# Auth & roles

How identity, roles, and access control work in CEITBA-API. Read this before changing any of `config/SecurityConfig.java`, `web/auth/*`, or anything in `service/auth/`.

---

## TL;DR

| You are… | What you send | What you can do |
|---|---|---|
| **Anonymous** | nothing | Read public endpoints (health, careers, subjects, plans, classrooms, GET wiki bookmarks, POST classrooms/conflicts) |
| **USER** | `Authorization: Bearer <google_id_token>` (email passes the allowlist) | Everything anonymous can do, **plus** create/delete wiki bookmarks |
| **STAFF** | Same JWT, plus an active `ceitba_staff` row | Everything USER can do, **plus** assign/revoke STAFF on others |
| **SYNC** (machine, not human) | `X-API-Key: <AUTH_SYNC_API_KEY>` | Trigger `/v1/sync/**` jobs |

`Anonymous` isn't actually a role; it's the absence of any authentication. The other three (`USER`, `STAFF`, `SYNC`) map to Spring Security `ROLE_*` authorities.

---

## How roles are assigned

### USER — automatic on first authenticated request

Anyone whose Google ID token email passes the [allowlist](#the-allowlist) gets `ROLE_USER`. There's **no signup endpoint**: a `User` row is created the first time someone hits a controller method that asks for `@CurrentUser User user` (currently the wiki bookmarks write endpoints). That's "JIT provisioning" — see `service/auth/UserProvisioningService.java`.

If you authenticate but never hit a `@CurrentUser` route, no row is created. The role is still granted (`ROLE_USER`), so you can call any USER-level endpoint immediately.

### STAFF — granted via an active `ceitba_staff` row

Spring Security adds `ROLE_STAFF` if the request's email maps to a `User` row that has a `ceitba_staff` record where `start <= now <= end`. The check happens on every authenticated request inside [`StaffAwareJwtAuthenticationConverter`](../src/main/java/org/ceitba/api/web/auth/StaffAwareJwtAuthenticationConverter.java) — one DB lookup per request, no cache.

A user can only be in **one** branch at a time (`ceitba_staff.user_id` is the primary key). To change someone's branch or role, revoke their current membership and assign a new one.

### SYNC — `X-API-Key` only

Cron jobs and ops scripts authenticate with a static header against `AUTH_SYNC_API_KEY`. The [`ApiKeyFilter`](../src/main/java/org/ceitba/api/web/auth/ApiKeyFilter.java) translates a matching key into a `ROLE_SYNC` principal. This skips the JWT path entirely. Bug bias: if `AUTH_SYNC_API_KEY` is empty/unset, every `/sync` request returns 401. Fail-closed by design.

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
Authorization: Bearer <staff_member_google_id_token>
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
Authorization: Bearer <staff_member_google_id_token>
```

Returns `204 No Content`. Behavior:
- If the membership has already started, the row is **end-dated to `now`** (kept for audit).
- If the membership hasn't started yet, the row is **deleted** (mistake correction).

## How to list active STAFF

```http
GET /api/v1/staff
Authorization: Bearer <staff_member_google_id_token>
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
ApiKeyFilter (custom, before Spring Security)
   if X-API-Key matches AUTH_SYNC_API_KEY:
       set Authentication = ROLE_SYNC principal "sync-job"
   │
   ▼
OAuth2 Resource Server filter (Spring Security)
   if Authorization: Bearer <jwt>:
       1. Verify signature against Google's JWKS (cached)
       2. Verify exp / iss / aud
       3. Call StaffAwareJwtAuthenticationConverter:
          a. Allowlist check → reject (-> 401) if email not admitted
          b. Add ROLE_USER baseline
          c. DB lookup: if active CeitbaStaff for this user, add ROLE_STAFF
       4. Set Authentication = JwtAuthenticationToken with the authorities
   │
   ▼
authorizeHttpRequests() — per-route policy from SecurityConfig
   public matchers     -> permitAll
   /v1/sync/**         -> hasRole("SYNC")
   /v1/staff/**        -> hasRole("STAFF")
   anyRequest()        -> authenticated()
   │
   ▼
@PreAuthorize evaluation (if used on the controller method)
   │
   ▼
Controller method invoked
   if @CurrentUser User user is in the signature:
      CurrentUserResolver reads `email` + `name` from the JWT
      UserProvisioningService.findOrCreate() → row exists / new INSERT
      Controller receives the managed User entity
```

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

---

## Tech debt / future hardening

- **Per-branch authorization** (e.g. only IT staff can touch `/v1/sync/**`). The data is there (`ceitba_staff.branch`), the policy isn't. When this matters, model authorities as `ROLE_STAFF_IT` etc. and gate paths accordingly.
- **`AUTH_JWT_AUDIENCE` enforcement.** Env var exists but isn't wired into the JWT decoder. Set it once you fix the Google OAuth client ID.
- **API key compare.** Currently `String.equals`; switch to `MessageDigest.isEqual` for constant-time.
- **Cache the staff lookup** if the role-detection DB hit shows up in flame graphs (it currently runs on every JWT request). Caffeine with TTL ≤ minimum role-validity window would be enough.
- **Lock down `POST /v1/users/create` and `GET /v1/users/**`.** Currently public for NestJS parity; should require STAFF (or be removed entirely once JIT provisioning covers all signup flows).

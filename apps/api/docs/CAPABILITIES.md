# Capabilities

Per-user and per-org feature gates, so features such as Apuntes can be turned
on for a few people in prod before they open to everyone.

## Registry

Keys live in code, in `service/capability/Capability` (key, label, Spanish
description). Add an enum constant to gate a new feature; unknown keys found in
the tables are ignored.

| Key | Label | Gates |
|---|---|---|
| `apuntes` | Apuntes | `/v1/me/drive/**` (MyDriveController), `/v1/wiki/apuntes/subjects`, `/v1/wiki/subjects/{id}/files`, `/v1/wiki/files/**` (ApuntesController), `/v1/wiki/subjects/{id}/kb/**` and `/v1/wiki/kb/pages/{id}/report` (KbController) |

Staff endpoints (`/v1/staff/drive/**`, `/v1/staff/kb/**`) and wiki bookmarks/notes are not gated.

## Rule

A user has a capability when any of these holds:

1. they are active STAFF (`ceitba_staff`, same check as `StaffAwareJwtAuthenticationConverter`);
2. `capability_settings.enabled_for_all` is true;
3. their lowercased email has a row in `capability_user_grants`;
4. they belong (`user_organizations`) to an org with a row in `capability_org_grants`.

Grants are keyed by email so staff can pre-grant people who never logged in.
The email allowlist still governs login; granting does not bypass it.

`CapabilityService.require(user, key)` throws `CapabilityRequiredException`
→ `403 {"error": "CAPABILITY_REQUIRED", "message": ...}`. Anonymous callers
get 401 from SecurityConfig first. `GET /v1/auth/me` returns
`capabilities: string[]` (the effective set, sorted).

## Tables (V39)

- `capability_settings(capability pk, enabled_for_all, updated_at, updated_by)` — no row = off.
- `capability_user_grants(capability, email, granted_at, granted_by)`, pk `(capability, email)`.
- `capability_org_grants(capability, org_slug → organizations ON DELETE CASCADE, granted_at, granted_by)`, pk `(capability, org_slug)`.

## Staff API (`/v1/staff/capabilities`, STAFF only)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/` | | `[{key, label, description, enabledForAll, userGrantCount, orgGrantCount}]` |
| PUT | `/{key}` | `{enabledForAll}` | the item; 404 unknown key |
| GET | `/{key}/grants` | | `{users:[{email, userId?, name?, grantedAt, grantedByName?}], orgs:[{slug, name, memberCount, grantedAt, grantedByName?}]}` |
| POST | `/{key}/users` | `{emails: string[]}` | grants; emails trimmed/lowercased/deduped, 400 on a malformed one |
| DELETE | `/{key}/users/{email}` | | grants (no-op if missing) |
| PUT | `/{key}/orgs/{slug}` | | grants; 404 unknown org |
| DELETE | `/{key}/orgs/{slug}` | | grants (no-op if missing) |

Every `/{key}` route answers 404 for a key not in the registry. Grants are
idempotent (re-granting keeps the original `grantedAt`).

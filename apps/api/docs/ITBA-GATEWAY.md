# ITBA gateway: what it can and cannot tell us

All calls go through `external/itba/ItbaApiClient` (real impl
`RestClientItbaApiClient`, base URL `ITBA_API_BASE_URL`, token
`ITBA_API_TOKEN` as the first path segment).

## Endpoints we know

| Endpoint | Input | Used for |
|---|---|---|
| `GET /careerPlans/{token}?plan=<planId>` | one plan code | subjects of that plan (`getSubjectsByPlan`); the response's `careerplan` also carries `name`, `career`, `degreeLevel`, `since` |
| `GET /courseCommissions/{token}?level=&year=&period=` | level/year/period | commissions and their schedules |

These (from the endpoints the old Flutter app used: `CEITBApp/README.md`,
`lib/features/schedules/models/available_courses.dart`,
`lib/api/itba/sga_login_api.dart`) are the only ones this API calls.

## Revoked: SGA student lookup (2026-09)

The API used to prefill a user's file number (legajo), career and plan from
SGA after login: `GET /people/{token}?email=` gave the DNI, then
`GET /students/{token}/{dni}` gave legajo, `careerCode`, career name and the
active plan names. ITBA revoked CEITBA's access to it: a probe on prod on
2026-09-27 got `401 Unauthorized` from `/people` for every student, while
`courseCommissions` still answered `200`. The lookup was removed end to end
(`AcademicProfileSyncService`, `POST /v1/me/profile/sync-from-sga`, the
`itba.profile-sync.*` settings, `user.sga_synced_at`, dropped in V28).

Instead, users choose career and plan in app onboarding and enter their
legajo once via `PATCH /v1/me/profile` (settable only while empty, unique
across users); STAFF corrects it with `PATCH /v1/users/{id}/file-number`.
If ITBA ever restores access, bring the lookup back from git history
(before the `feat/remove-sga-student-lookup` branch) rather than rewriting it.

## Gap: no career or plan listing

There is no known endpoint that **lists** careers or the plans of a career:
`careerPlans` needs the plan code up front. A probe in September 2026 with
the token that shipped in the old app returned `401 Unauthorized` for every
`careerPlans` variant (that token is revoked) and `405 Method not allowed`
for `GET /careers/{token}`, so no listing endpoint could be confirmed. Ask
ITBA's systems team whether one exists before building on it.

Consequences:

* The career/plan catalogue (`careers`, `plan`) is **not** synced from the
  gateway. `DataSyncService` walks the plans we already have and pulls their
  subjects (`/v1/sync/all`, `/v1/sync/subjects` and the scheduled job).
* Entrance-program plan codes change every year (e.g. `PAI` /
  `PA25 Proceso I` today, `ADM` / `Ingreso` in the old app). Never hardcode
  them. When a new one appears, STAFF registers it without a migration:

  ```
  POST /api/v1/careers/{careerId}/plans      (STAFF)
  { "id": "<plan code exactly as careerPlans spells it>", "name": "optional" }
  ```

  The next scheduled sync (or `POST /api/v1/sync/plan/{planId}/subjects`
  with the SYNC key) pulls its subjects. A brand-new career goes through
  `POST /api/v1/careers` first.
* Until a plan is registered, users cannot pick it in onboarding:
  `PATCH /v1/me/profile` only accepts plans in the catalogue.

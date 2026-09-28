# ITBA gateway: what it can and cannot tell us

All calls go through `external/itba/ItbaApiClient` (real impl
`RestClientItbaApiClient`, base URL `ITBA_API_BASE_URL`, token
`ITBA_API_TOKEN` as the first path segment).

## Endpoints we know

| Endpoint | Input | Used for |
|---|---|---|
| `GET /careerPlans/{token}?plan=<planId>` | one plan code | subjects of that plan (`getSubjectsByPlan`); the response's `careerplan` also carries `name`, `career`, `degreeLevel`, `since` |
| `GET /courseCommissions/{token}?level=&year=&period=` | level/year/period | commissions and their schedules |
| `GET /people/{token}?email=` | email | DNI (kept in memory only) |
| `GET /students/{token}/{dni}` | DNI | legajo, `careerCode`, career name, active plan names |

These are the only endpoints the old Flutter app used (`CEITBApp/README.md`,
`lib/features/schedules/models/available_courses.dart`,
`lib/api/itba/sga_login_api.dart`) and the only ones this API calls.

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
  { "id": "<plan code exactly as SGA/careerPlans spells it>", "name": "optional" }
  ```

  The next scheduled sync (or `POST /api/v1/sync/plan/{planId}/subjects`
  with the SYNC key) pulls its subjects. A brand-new career goes through
  `POST /api/v1/careers` first.
* Until a plan is registered, the SGA profile prefill
  (`AcademicProfileSyncService`) leaves the user's plan empty, because it only
  accepts plans in the catalogue.

## Possible follow-up

`GET /students/{token}/{dni}` returns `careerCode`, the career name and the
active plan names for every student who logs in, so unknown plan codes are
observable there. A future change could record unknown `(careerCode, plan)`
pairs seen by the prefill for STAFF to review (or auto-register), which would
cover new entrance programs without a gateway listing endpoint.

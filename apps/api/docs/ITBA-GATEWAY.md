# ITBA gateway: what it can and cannot tell us

All calls go through the ITBA client in `src/external/itba.ts` (real impl
`src/external/itba/restClient.ts`, base URL `ITBA_API_BASE_URL`, token
`ITBA_API_TOKEN` as the first path segment).

## Endpoints we know

| Endpoint | Input | Used for |
|---|---|---|
| `GET /careerPlans/{token}?plan=<planId>` | one plan code | subjects of that plan and the credits it asks for per elective group (`getSubjectsByPlan`, see "Plan shape"); the response's `careerplan` also carries `name`, `career`, `degreeLevel`, `since` and `informativeLevel` (not read) |
| `GET /courseCommissions/{token}?level=&year=&period=` | level/year/period | commissions and their schedules |

These (from the endpoints the old Flutter app used: `CEITBApp/README.md`,
`lib/features/schedules/models/available_courses.dart`,
`lib/api/itba/sga_login_api.dart`) are the only ones this API calls.

## Plan shape: subjects and elective groups

`careerplan.section` is a list of sections (a lone object counts as a
one-element list, like every list in this format). A section has either
`terms.term[]` (each with `year`, `period` and `entries.entry[]`) or
`withoutTerm.withoutTerm[]` (entries with no place in the timeline: the
subjects of an elective group).

An entry's `type` says what it is:

* `"subject"`: a subject (`code`, `name`, `credits`, `dependencies.dependency[]`,
  `creditsRequired`). Read from both branches; outside terms its year and
  semester are null (stored as 0).
* `"section"`, only inside a term: an **elective group** placed in that year
  and term. `name` is exactly the name of the sibling `withoutTerm` section
  that lists the group's subjects (spelling included: A22 sends
  `"Electivas Gestíon"` in both places) and `credits` is how many credits of
  it the plan asks for; `dependencies` is null. Real examples (October 2026):

  | Plan | Group | Credits | Year / term |
  |---|---|---|---|
  | A22 | Electivas Orientación | 18 | 1 / 2 |
  | A22 | Electivas Gestíon | 18 | 3 / 1 |
  | A22 | Electivas Informática | 15 | 3 / 1 |
  | A22 | Electivas Analytics | 15 | 3 / 2 |
  | A22 | Electivas Social | 12 | 3 / 2 |
  | S10-Rev23 | Electivas | 27 | 4 / 2 |
  | I22 | Gestión de datos (obligatoria) | 6 | 1 / 2 |

  The client returns them as `requirements` (`{ planId, section, credits,
  year, semester }`, names trimmed). A repeated name (the first one wins) and
  a `"section"` entry outside a term are skipped; an entry without a name or
  whose `credits` is not an integer is logged and skipped. A bad group never
  fails the plan's subjects.
* Anything else is skipped.

The sync stores the requirements in `plan_section_requirement`
(`PLANS.md`).

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
  gateway. The data sync (`src/features/sync/dataSync.ts`) walks the plans we already have and pulls their
  subjects (`/v1/sync/all`, `/v1/sync/subjects` and the scheduled job).
* Entrance-program plan codes change every year (e.g. `PAI` /
  `PA25 Proceso I` today, `ADM` / `Ingreso` in the old app). Never hardcode
  them. When a new one appears, STAFF registers it without a migration,
  from Administración → "Carreras y planes" (`/manage/careers`, which also
  renames careers and plans; ids never change) or directly:

  ```
  POST /api/v1/careers/{careerId}/plans      (STAFF)
  { "id": "<plan code exactly as careerPlans spells it>", "name": "optional" }
  ```

  The next scheduled sync (or `POST /api/v1/sync/plan/{planId}/subjects`
  with the SYNC key) pulls its subjects. A brand-new career goes through
  `POST /api/v1/careers` first. `GET /api/v1/careers/{id}/plans` lists a
  career's plans with their names; `PUT /api/v1/careers/{id}/plans/{planId}`
  `{ "name": "..." }` (STAFF) renames one.
* Until a plan is registered, users cannot pick it in onboarding:
  `PATCH /v1/me/profile` only accepts plans in the catalogue.

## Gap: commissions carry no term

`courseCommissions` returns no year/period per commission, and the sync does
not store the `(year, period)` it queried with. The `commission` table keeps
every term ever synced (upsert by ITBA id, never pruned), so a subject can
have past, running and next-term rows at once. `GET /v1/subjects?plan=` and
`GET /v1/commissions?plan=` both pick, per subject, the term to show with
`src/features/commission/logic/commissionTerms.ts`:

1. Candidates: the commissions with `course_end >= today` (ART). If none
   (between terms), all of them, so the subject shows its most recent term.
2. Let `N` = the latest `course_start` among the candidates. Keep a
   candidate if its `course_start >= N - 60 days` **or** its
   `course_end >= N` (still running when the newest term begins).

So when the next term is synced before the current one ends (current ends
Dec 31, next starts ~Mar 1; or 1st semester ends Jul 25, 2nd starts Jul 26)
only the next term is shown, while same-term offerings with different dates
stay: bimester modules (starts 42 days apart, rule a) and year-long or
cross-year commissions next to semester ones (e.g. 72.45's 01/03–31/12
commission beside its 26/07–31/12 ones, rule b).

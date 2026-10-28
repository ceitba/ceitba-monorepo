# Plans: subjects and elective-group credits

A **plan** (`public.plan`, e.g. `S10-Rev23`) belongs to a career
(`public.careers`). STAFF registers both (`/v1/careers`, `POST
/v1/careers/{id}/plans`): the ITBA gateway cannot list them
(`ITBA-GATEWAY.md` "Gap: no career or plan listing"). Everything inside a
plan comes from the gateway's `careerPlans` (`ITBA-GATEWAY.md` "Plan shape")
through the data sync.

## What the sync stores

`src/features/sync/dataSync.ts`, for each registered plan
(`POST /v1/sync/all`, `/v1/sync/subjects`, the scheduled job) or one plan
(`POST /v1/sync/plan/{planId}/subjects`, SYNC key). One transaction per plan:
a rejected row rolls the whole plan back, other plans are unaffected.

* `plan_entry` (V65; key `(plan_id, position)`): the plan exactly as fetched,
  one row per entry in ITBA's order, with the plan's own `section`, `year`,
  `semester`, `dependencies`, `credits_required`, `subject_name` and
  `subject_credits` (NULL where ITBA sent none). The same subject may appear in
  several sections (orientations). Replaced with each fetch, so entries ITBA
  stops sending disappear; `fetched_at` says when. Written in its own
  transaction before the rest of the plan, so a `subject`/`plan_subject` row
  the database rejects never keeps it stale. `GET /v1/subjects?plan=` reads
  it.
* `subject` + `plan_subject` (`section`, `year`, `semester`, `dependencies`,
  `credits_required`): upserted; rows the gateway stops sending are kept.
  Known limits, which is why `/v1/subjects` no longer reads them:
  `plan_subject`'s key is `(subject_id, plan_id)`, so a subject keeps one
  section per plan (S10-Rev18: 385 entries upstream, 120 rows); missing
  `creditsRequired` is stored as 0; `subject.name`/`credits` are global, last
  plan synced wins. They still back `/v1/plans/*` and will be retired once
  those routes read `plan_entry` (a later release: they are keyed by subject
  alone).
* `plan_section_requirement` (`plan_id`, `section`, `credits`, `year`,
  `semester`; key `(plan_id, section)`, V64): the credits the plan asks for
  per elective group. Replaced with each fetch: groups no longer sent are
  deleted, the rest upserted. `section` matches `plan_subject.section` of the
  group's subjects.

A `plan_entry` or `plan_section_requirement` row the database rejects is logged
and the stored rows stay as they were; it never fails the plan's subjects. Both
need the plan row (FK, cascades on
delete): syncing a plan id that is not registered writes only `subject` and
`plan_subject`. Neither is counted in the sync result (its JSON is fixed). The
sync runs at 00:00 and 12:00 (`DataSyncJob`), so a change in ITBA shows up
within 12 hours, or right away with `POST /v1/sync/plan/{planId}/subjects`.
A plan whose fetch keeps failing (gateway errors) keeps serving its last
stored entries; once they are more than 2 days old each read logs `Serving
plan entries older than 2 days` with the plan and `fetched_at`.

The per-plan sync response is still the subjects array; the requirements are
read with the endpoint below.

## Reading it

| Route | Access | Returns |
|---|---|---|
| `GET /v1/plans/{planId}/subjects` (`?year&semester&section&type=elective`) | public | the plan's `plan_subject` rows with their subject |
| `GET /v1/plans/{planId}/requirements` | public | `[{ "section", "credits", "year", "semester" }]` ordered by year, semester, section; `[]` for a plan without groups or an unknown plan |
| `GET /v1/subjects?plan=` | public | the plan from `plan_entry`, organized by section/year/semester in ITBA's order, with commissions. A plan with no stored entries (not synced yet, or not registered) is fetched live from the gateway (502 if it fails, 404 if empty), so a plan staff just added works before its first sync |

The MCP tool `get_plan_subjects` adds the requirements as `requirements`
(filtered by its year, semester and section arguments). The web client is
`fetchPlanRequirements` in `apps/web/src/api/plans.ts`.

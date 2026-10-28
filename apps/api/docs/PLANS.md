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

* `subject` + `plan_subject` (`section`, `year`, `semester`, `dependencies`,
  `credits_required`): upserted; rows the gateway stops sending are kept.
* `plan_section_requirement` (`plan_id`, `section`, `credits`, `year`,
  `semester`; key `(plan_id, section)`, V64): the credits the plan asks for
  per elective group. Replaced with each fetch: groups no longer sent are
  deleted, the rest upserted. `section` matches `plan_subject.section` of the
  group's subjects. Written in a savepoint: a row the database rejects is
  logged and the stored groups stay as they were; it never fails the plan's
  subjects. Needs the plan row (FK, cascades on delete): syncing a
  plan id that is not registered keeps its subjects only. Not counted in the
  sync result (its JSON is fixed).

The per-plan sync response is still the subjects array; the requirements are
read with the endpoint below.

## Reading it

| Route | Access | Returns |
|---|---|---|
| `GET /v1/plans/{planId}/subjects` (`?year&semester&section&type=elective`) | public | the plan's `plan_subject` rows with their subject |
| `GET /v1/plans/{planId}/requirements` | public | `[{ "section", "credits", "year", "semester" }]` ordered by year, semester, section; `[]` for a plan without groups or an unknown plan |
| `GET /v1/subjects?plan=` | public | the plan live from the gateway, organized by section/year/semester, with commissions |

The MCP tool `get_plan_subjects` adds the requirements as `requirements`
(filtered by its year, semester and section arguments). The web client is
`fetchPlanRequirements` in `apps/web/src/api/plans.ts`.

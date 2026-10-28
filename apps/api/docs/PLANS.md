# Plans: subjects and elective-group credits

A **plan** (`public.plan`, e.g. `S10-Rev23`) belongs to a career
(`public.careers`). STAFF registers both (`/v1/careers`, `POST
/v1/careers/{id}/plans`): the ITBA gateway cannot list them
(`ITBA-GATEWAY.md` "Gap: no career or plan listing"). Everything inside a
plan comes from the gateway's `careerPlans` (`ITBA-GATEWAY.md` "Plan shape")
through the data sync, and STAFF can correct it (see "Staff edits").

## The tables

```
plan_entry (V65)            ITBA's plan as fetched, one row per entry     written only by the sync
plan_entry_override (V66)   staff edits, one row per (plan, subject)      written only by the STAFF routes
plan_entry_effective (V66)  view: plan_entry with the edits applied       what every reader uses
plan_section_requirement    credits per elective group (V64)              written only by the sync
plan_subject                the old one-section-per-subject copy          still written by the sync, read by nothing; dropped next release
```

* `plan_entry` (key `(plan_id, position)`, no FK to `plan`, like
  `plan_subject`): one row per entry in ITBA's order, with the plan's own
  `section`, `year`, `semester`, `dependencies`, `credits_required`,
  `subject_name` and `subject_credits` (NULL where ITBA sent none). The same
  subject may appear in several sections (orientations). `fetched_at` says
  when it was stored; `source` is `ITBA`, or `BACKFILL` for the rows V66
  copied from `plan_subject` so the readers had data before each plan's
  first sync after the deploy.
* `plan_subject` (key `(subject_id, plan_id)`) can't hold a plan: a subject
  keeps one section per plan (S10-Rev18: 385 entries upstream, 120 rows),
  missing `creditsRequired` is stored as 0, and `subject.name`/`credits` are
  global (the last plan synced wins). It is kept up to date for one release
  so a rollback to the previous image still reads current data.

## What the sync stores

`src/features/sync/dataSync.ts`, for each registered plan
(`POST /v1/sync/all`, `/v1/sync/subjects`, the scheduled job) or one plan
(`POST /v1/sync/plan/{planId}/subjects`, SYNC key):

1. `plan_entry`: the plan's rows are replaced with the fetch, in their own
   transaction, so entries ITBA stops sending disappear and a
   `subject`/`plan_subject` row the database rejects never keeps them stale.
   Staff edits are never touched.
2. One transaction per plan for `subject` + `plan_subject` (upserted; a
   rejected row rolls the plan back, other plans are unaffected) and
   `plan_section_requirement` (replaced: groups no longer sent are deleted,
   the rest upserted; `section` matches the `section` of the group's
   entries; needs the plan row, FK cascading on delete).

A `plan_entry` or `plan_section_requirement` row the database rejects is
logged and the stored rows stay as they were; it never fails the plan's
subjects. Neither is counted in the sync result (its JSON is fixed). The sync
runs at 00:00 and 12:00 (`DataSyncJob`), so a change in ITBA shows up within
12 hours, or right away with `POST /v1/sync/plan/{planId}/subjects`. A plan
whose fetch keeps failing (gateway errors) keeps serving its last stored
entries; once they are more than 2 days old each `GET /v1/subjects?plan=`
logs `Serving plan entries older than 2 days` with the plan and `fetched_at`.

The per-plan sync response is still the subjects array; the requirements are
read with the endpoint below.

## Staff edits

ITBA's data is sometimes wrong, so a staff edit wins over it and survives
every sync (`plan_entry_override`, FK to `plan`: only registered plans). The
STAFF routes of `/v1/plans` (`src/features/plan/service.ts`) write it:

| Route | Effect |
|---|---|
| `POST /v1/plans/{planId}/subject` | adds a subject the plan doesn't show (one ITBA doesn't send, or one staff hid) with the given values (no year/semester/credits = 0, no dependencies = `[]`); listed after ITBA's entries, name and credits from `public.subject`. 404 for an unknown plan or subject, 409 if the plan already shows it |
| `PUT /v1/plans/{planId}/subject/{subjectId}` | a patch: each given field replaces ITBA's value in every entry of the subject from now on (a null field keeps the current one). Setting `section` collapses a subject that sits in several sections into its first entry. ITBA's later changes to the other fields still come through, and name/credits always come from ITBA |
| `DELETE /v1/plans/{planId}/subject/{subjectId}` | hides a subject ITBA lists (it stays hidden across syncs, and a `POST` brings it back); removes one staff added |

There is no route to drop an edit and go back to ITBA's values: delete the
`plan_entry_override` row by hand.

## Reading it

Every reader uses `plan_entry_effective`: the routes below, the current
commissions of a plan (`GET /v1/commissions?plan=`), Apuntes' plan subjects
and year matching (`src/features/drive`), and the wiki prerequisite relations
(`KbRelationService`). A subject can appear more than once (one per section);
readers that need one per subject take its first entry in plan order.

| Route | Access | Returns |
|---|---|---|
| `GET /v1/plans/{planId}/subjects` (`?year&semester&section&type=elective`) | public | the plan's entries in plan order, in the old `plan_subject` shape (no year/semester/`creditsRequired` = 0, `subject` = the plan's name and credits for it, `null` if unknown); a subject may repeat. Filters: `year` + `semester`, else `year`, else `section`, else `type=elective` (year and semester 0) |
| `GET /v1/plans/subjects/{subjectId}/plans` | public | every entry of the subject across plans (plan id, then plan order) |
| `GET /v1/plans/{planId}/subject/{subjectId}` | public | the subject's first entry in the plan; 404 if the plan doesn't show it |
| `GET /v1/plans/{planId}/requirements` | public | `[{ "section", "credits", "year", "semester" }]` ordered by year, semester, section; `[]` for a plan without groups or an unknown plan |
| `GET /v1/subjects?plan=` | public | the plan, organized by section/year/semester in ITBA's order, with commissions. A plan the sync hasn't stored from ITBA yet (none, or only `BACKFILL` rows) is fetched live from the gateway (502 if it fails, 404 if empty) and stored, so the edits apply and the next request reads the database; a plan staff just added works before its first sync |

The MCP tool `get_plan_subjects` adds the requirements as `requirements`
(filtered by its year, semester and section arguments). The web client is
`fetchPlanRequirements` in `apps/web/src/api/plans.ts`; the prerequisite map
(`apps/web/src/utils/correlatividades.ts`) keeps a repeated subject's first
entry.

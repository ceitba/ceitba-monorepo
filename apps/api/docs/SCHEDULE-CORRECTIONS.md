# Schedule corrections

Students fix wrong SGA schedules themselves. A logged-in student (email allowlist) suggests the real **day + time** of a commission's weekly slots; other students confirm or reject; once enough confirm, the corrected slots replace the SGA ones wherever the API serves commission times for scheduling. STAFF can override at any time. App parity: [ceitba/CEITBApp#130](https://github.com/ceitba/CEITBApp/issues/130).

Code: `service/correction/ScheduleCorrectionService` (rules), `CorrectionSlots` (validation, normalization, rooms), `web/correction/*` (endpoints), migration `V30__schedule_corrections.sql` (test mirror `V4.22`).

## Rules

- Slots: 1..6, `MONDAY`..`SATURDAY`, `HH:mm` or `HH:mm:ss` (whole minutes), `from < to`, within 07:00–23:30, no two overlapping on the same day (back-to-back is fine). Normalized to sorted `HH:mm` before storing or comparing. Two slot sets are equal when their normalized `(day, from, to)` lists are; rooms are never compared.
- Rooms are not editable. A served correction slot borrows the classroom/building of the SGA slot **at the same position** (both lists sorted by day, then start); slots beyond the SGA count get `""` for both.
- Suggest (`POST /v1/commissions/{id}/schedule-corrections`): 404 unknown commission; 400 `ValidationError`; 409 `CommissionEnded` when `course_end < today` (ART); 400 `SameAsSga` when the set equals the current SGA slots; an identical open (PENDING/APPLIED) correction is returned with `created: false` (200) instead of a duplicate; 409 `AlreadySuggested` when the caller already has a different PENDING one for the commission. The suggestion counts as the suggester's CONFIRM vote.
- Votes (`PUT`/`DELETE /v1/schedule-corrections/{id}/vote`): only on PENDING/APPLIED (409 `InvalidState` otherwise) of a commission that has not ended (409 `CommissionEnded`). Changing a vote replaces it; deleting is idempotent (the suggester may withdraw theirs).
- PENDING → **APPLIED** when `confirms >= 3 && confirms > rejects`. APPLIED → PENDING when that stops holding, **unless STAFF applied it**.
- At most one APPLIED per commission (partial unique index): applying one supersedes the current one (→ SUPERSEDED).
- STAFF: `apply` (PENDING → APPLIED, superseding; on an APPLIED one it just marks it staff-reviewed) and `reject` (PENDING/APPLIED → REJECTED, also the way to revert). REJECTED, RESOLVED and SUPERSEDED are final.
- Sync expiry: when a sync changes a commission's SGA slot set, each PENDING/APPLIED correction whose creation snapshot differs from the new SGA slots becomes RESOLVED (new SGA == proposal) or SUPERSEDED. Room-only changes don't count.
- Notification: the first time a correction becomes APPLIED (votes or staff) its suggester gets a push (see `docs/PUSH-NOTIFICATIONS.md`) and the correction shows `seen: false` in `GET /v1/me/schedule-corrections` until `POST /v1/me/schedule-corrections/{id}/seen`. Re-applying after an un-apply does not notify again.
- Anonymity is absolute: no public, "me" or staff response carries the suggester, the voters or the reviewing staff member.

## Concurrency

Every write (suggest, vote, staff review, sync expiry) first takes `SELECT … FOR UPDATE` on the parent `commission` row, then reads the corrections fresh. Counters are recounted from `schedule_correction_vote` on every change, so they are exact under concurrent votes (`ScheduleCorrectionIT.concurrentVotesAreAllCountedAndApplyOnce`).

## Where corrected times are served

| Endpoint | Times |
|---|---|
| `GET /v1/subjects?plan=` | Effective `schedule` + `sga_schedule` (only when applied) + `corrections[]` (PENDING/APPLIED, APPLIED first, then confirms desc) with `my_vote` for a logged-in caller. Two extra queries per request for the whole plan. |
| `GET /v1/commissions?plan=` (mobile schedule builder) | `times` are the effective slots. One extra query. |
| `/v1/classrooms/**` (room occupancy, conflicts) | **SGA** on purpose: corrections don't know rooms, and their position-borrowed rooms are a display aid, not occupancy data. |

## Rate limits (per IP, `rate-limit.rules` in `application.yml`)

- `schedule-corrections`: `POST /v1/commissions/*/schedule-corrections`, 10/hour (`RATE_LIMIT_SCHEDULE_CORRECTIONS_CAPACITY` / `_PERIOD`).
- `schedule-correction-votes`: `PUT`/`DELETE /v1/schedule-corrections/*/vote`, 60/min (same env vars as the newsletter votes, `RATE_LIMIT_VOTES_*`).

## Seeding one locally

With the API on `:8080`, a session cookie or Bearer for three allowlisted users, and a current commission id (`SELECT id FROM commission WHERE course_end >= current_date LIMIT 1`):

```bash
API=http://localhost:8080/api/v1
curl -X POST $API/commissions/$COMMISSION/schedule-corrections -H "Authorization: Bearer $T1" \
  -H 'Content-Type: application/json' \
  -d '{"schedule":[{"day":"TUESDAY","time_from":"09:00","time_to":"12:00"}]}'
curl -X PUT $API/schedule-corrections/$ID/vote -H "Authorization: Bearer $T2" \
  -H 'Content-Type: application/json' -d '{"type":"CONFIRM"}'
curl -X PUT $API/schedule-corrections/$ID/vote -H "Authorization: Bearer $T3" \
  -H 'Content-Type: application/json' -d '{"type":"CONFIRM"}'   # -> APPLIED
```

Or straight in SQL (any existing user as suggester). `reviewed_by_staff = true` marks it staff-applied, so the first real vote doesn't un-apply it for lack of confirms:

```sql
INSERT INTO public.schedule_correction
  (commission_id, suggester_id, proposed_slots, sga_snapshot, slots_key, status, applied_at, reviewed_by_staff)
SELECT c.id, (SELECT id FROM public."user" LIMIT 1),
       '[{"day":"TUESDAY","from":"09:00","to":"12:00"}]',
       COALESCE((SELECT jsonb_agg(jsonb_build_object('day', t.day, 'from', to_char(t.hour_from, 'HH24:MI'),
                                                     'to', to_char(t.hour_to, 'HH24:MI'))
                                  ORDER BY t.day, t.hour_from)
                 FROM public.commission_time t WHERE t.course_id = c.id), '[]'),
       'TUESDAY 09:00-12:00', 'APPLIED', now(), true
FROM public.commission c WHERE c.id = '<commission id>';
```

# Subject reviews ("Opiniones")

Students review a subject they took: whether they recommend it, how hard it was and, optionally, who taught it and a
comment. The web app shows them in the "Opiniones" tab of a subject (`/apuntes/:subjectId?vista=opiniones`), grouped
by professor. Code: `src/features/review/` (API), `src/external/googleDirectory.ts` (professor names),
`apps/web/src/components/apuntes/reviews/` and `apps/web/src/api/reviews.ts` (web). Schema: `V64__subject_reviews.sql`.

## Why it looks like this

- **The professor, not the commission letter, is what differs.** ITBA's data (`courseCommissions`,
  `ITBA-GATEWAY.md`) has no professors, and a letter means nothing from one term to the next. So a review records
  the term and commission *and* the professors the student says taught it; readers compare professors.
- **Several professors per review.** Theory and practice are often taught by different people. A review names 0..6
  professors and counts for each of them; the web says so, since per-professor numbers then do not add up to the
  total.
- **Professors are named by the directory, never typed.** A student adds a professor by their ITBA address; the API
  asks the Google Workspace directory for the name (see "Professors"). The address identifies the professor (no
  "J. Perez" vs "Juan Pérez" duplicates) and never leaves the API.
- **Anonymous.** No response carries the author. `mine` is the only link to the caller.
- **Short.** Recommend (yes/no) and difficulty (1 Baja, 2 Media, 3 Alta) are required; professors and comment are
  optional. Counts, not percentages ("3 de 4 la recomiendan"): there are few reviews per subject.

## Web

- **Tab.** "Opiniones" on `/apuntes/:subjectId`, opened only by `?vista=opiniones` (the default tab is still the
  wiki or the files). Layout "profesores primero": a header with the counts and "Escribir reseña" (or "Editar tu
  reseña" when the caller already reviewed the current term), Comisión and Cuatrimestre filters with removable pills
  and "Limpiar" (every number follows them), one row per professor plus "Sin profesor indicado" (a review counts in
  each of its professors' rows, and the page says so when some review names several), and the selected row's
  reviews, those with a comment first. Commissions are grouped ignoring case.
- **Form.** Term (current and the 3 previous, Argentina time), commission, recommend, difficulty, professors as
  multi-select chips with "+ Agregar profesor" (the lookup by address) and an optional comment. The professors that
  more than one other review named for the same commission and term are pre-selected, with a line saying why.
- **Staff.** /manage → Apuntes → "Opiniones ocultas" lists the hidden reviews with their reports, to restore or
  delete; each also shows up in "Para revisar" and in the area's badge.


- **Who.** Every route needs an allowlisted ITBA session (or an API key; every write, reports included, needs the
  `write` scope: the `report` scope only covers wiki pages and files). Reads are
  **not** public even though the rest of `GET /v1/subjects/**` is: `policy.ts` has a rule for
  `GET /v1/subjects/*/reviews` ahead of the public block. No capability gate.
- **One review per student, subject and term** (`year`, `period` 1|2). A second one is `409 SubjectReviewExists`:
  edit the first instead. A term that has not started (after today's term: first semester through July, second
  from August, Argentina time) is `400 SubjectReviewFutureTerm`.
- **Editing and deleting** only the author's own review; anyone else gets 404 (authors stay anonymous). A review
  hidden by reports cannot be deleted by its author (`409 SubjectReviewHidden`): that would free the term for a
  fresh copy without reports. It can still be edited, and stays hidden.
- **"Me sirvió"**: one per user and review, idempotent, not on one's own review (`400 SubjectReviewOwn`). Votes and
  reports share the per-IP votes limit (rule `subject-review-votes`, `RATE_LIMIT_VOTES_*`).
- **Reports** work like Apuntes (`DRIVE-SYNC.md`): one per user (a second replaces the first), reasons `OFFENSIVE`,
  `PERSONAL_DATA`, `FALSE`, `SPAM`, `OTHER`, not on one's own review. `report_count` is recounted from the report
  rows under the review's row lock (concurrent reports count one after the other); at **3** the review is hidden from
  everyone but its author (who sees `hidden: true`), `hidden_at` is set and it appears in the staff queue. Staff
  restores it (shown again, reports cleared) or deletes it. Hiding and restoring never touch `updatedAt`, which is
  the author's last edit.
- **Order.** Newest term first, then newest first. Professors by name.

## Professors

`POST /v1/professors/lookup {email}`:

1. The address is trimmed and lowercased and must belong to an allowed login domain (`AUTH_ALLOWED_DOMAINS`), else
   `400 ProfessorEmailDomain`.
2. A professor already stored with that address is returned (`{id, name}`) without asking Google.
3. Otherwise the directory is asked (per-user limit `professor-lookups`, 30/h): Google People API
   `people:searchDirectoryPeople` (`sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`), keeping only a person whose
   address is exactly this one and taking their primary display name. Found: stored and returned. Not found:
   `404 ProfessorNotFound`. The directory cannot be asked: `503 ProfessorDirectoryUnavailable`. A name longer than
   255 characters is cut.

**Known gap.** The directory has students too: nothing checks that the address belongs to teaching staff, so a
student could add a classmate as a "professor". Reports and staff deletion are the only remedy today.

The directory is read with the **CEITBA sender account** (`ceitba@itba.edu.ar`, `WEEKLY-DIGEST.md` "Sending
through the Gmail API"): its consent asks for `directory.readonly` besides `gmail.send`, and the lookup uses that
account's cached access token. Until staff reconnects the account with the new scope (and while the account is
missing or broken), lookups of new professors answer 503; professors already stored keep working. The People API
must be enabled in the Google Cloud project, and the ITBA Workspace must share its directory with users (Admin
console → Directory → Directory settings → Sharing settings), or the search comes back empty.

`REVIEWS_DIRECTORY_USE_FAKE=true` replaces Google with a fixed list (`FakeProfessorDirectory`: mgarcia, jlopez,
sfernandez, rquiroga, lbenitez `@itba.edu.ar`) for local dev and the tests.

## API

| Method | Path | Body → response |
|---|---|---|
| GET | `/v1/subjects/{subjectId}/reviews` | → `{subjectId, subjectName, reviews: Review[], professors: [{id, name}]}`; 404 unknown subject |
| POST | `/v1/subjects/{subjectId}/reviews` | `{year, period, commission, recommend, difficulty, professorIds, comment}` → 201 `Review`; 409 `SubjectReviewExists`, 400 `SubjectReviewFutureTerm`, 400 `UnknownProfessor` (an id that is not a stored professor) |
| PUT | `/v1/subject-reviews/{id}` | same body → `Review` (author only) |
| DELETE | `/v1/subject-reviews/{id}` | → 204 (author only) |
| PUT / DELETE | `/v1/subject-reviews/{id}/helpful` | → 204 |
| PUT | `/v1/subject-reviews/{id}/report` | `{reason, comment}` → 204 |
| POST | `/v1/professors/lookup` | `{email}` → `{id, name}` |
| GET | `/v1/staff/subject-reviews` | STAFF → hidden reviews, most recently hidden first (`hidden_at`): `[{id, subjectId, subjectName, year, period, commission, professors, recommend, difficulty, comment, reportCount, reports: [{reason, comment, createdAt}], createdAt, updatedAt}]` |
| POST | `/v1/staff/subject-reviews/{id}/restore` | STAFF → 204 |
| DELETE | `/v1/staff/subject-reviews/{id}` | STAFF → 204 |

`Review` = `{id, year, period, commission, professorIds, recommend, difficulty, comment, helpfulCount, helpful,
reported, mine, hidden, createdAt, updatedAt}`: `helpful`/`reported` are the caller's own vote and report,
`professorIds` are in name order, a blank comment is `null`, timestamps are UTC (`...Z`). Validation: `commission`
not blank, at most 20; `difficulty` 1–3; `period` 1–2; `year` 2000–2100; at most 6 professors; comment at most 2000.
Creating and editing share the per-user limit `subject-reviews` (20/h).

## Errors

| Status | `error` | When |
|---|---|---|
| 400 | `SubjectReviewFutureTerm` | the term has not started |
| 400 | `SubjectReviewOwn` | "Me sirvió" or a report on one's own review |
| 400 | `UnknownProfessor` | a `professorIds` entry is not a stored professor |
| 400 | `ProfessorEmailDomain` | lookup of an address outside the allowed domains |
| 404 | `ProfessorNotFound` | nobody in the directory has that address |
| 409 | `SubjectReviewExists` | a second review for the same subject and term (also when an edit moves a review onto it) |
| 409 | `SubjectReviewHidden` | the author deletes a review hidden by reports |
| 503 | `ProfessorDirectoryUnavailable` | no sender account with the directory scope, or Google failed |

## Schema (`V64`)

`public.professor` (`email` unique, lowercase), `public.subject_review` (unique `(subject_id, user_id, year,
period)`, `hidden`, `report_count`), `public.subject_review_professor` (review ↔ professor), and one-per-user
`public.subject_review_helpful` and `public.subject_review_report`, each with a `user_id` index. Deleting a subject
deletes its reviews; deleting a review deletes its links, votes and reports. Account deletion (`DELETE /v1/me`)
removes the user's reviews, votes and reports, recounting the reports of the reviews they reported, also when the
account is only anonymized and the user row stays (`review/repo.ts` `deleteUserData`).

## Not in this version

The line per commission inside the scheduler's commission picker, the end-of-term prompt ("¿Recomendás … con …?")
and feeding review comments to the subject wiki were prototyped but left out. The wiki, if it ever reads reviews,
should take subject-level tips only, without professor names.

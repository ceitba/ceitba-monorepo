# Drive sync ("Apuntes")

Students share a Google Drive folder with the CEITBA bot service account; the API polls it,
stores copies in MinIO + metadata in Postgres, and serves them per subject. Full design:
https://claude.ai/code/artifact/0c362715-0f9a-45bf-844a-a87c225d1c6d

Student and reader endpoints require the `apuntes` capability (see [CAPABILITIES.md](CAPABILITIES.md)).

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `DRIVE_SYNC_ENABLED` | `false` | Turns on the scheduled job |
| `DRIVE_SYNC_INTERVAL` | `PT30M` | Delay between runs |
| `DRIVE_SYNC_RUN_BUDGET` | `PT10M` | Max wall time per run |
| `DRIVE_SYNC_SERVICE_ACCOUNT_JSON` | — | Base64 of the service-account key JSON |
| `DRIVE_SYNC_USE_FAKE` | `false` | Use the in-memory `FakeDriveClient` (tests / offline dev) |
| `DRIVE_SYNC_MAX_FILE_BYTES` | `52428800` | Larger files are stored as metadata only |
| `DRIVE_SYNC_SOURCE_BUDGET` | `PT3M` | Max time slice of one source per run (min with what is left of the run budget) |
| `DRIVE_SYNC_REFERENCE_ABOVE_BYTES` | `20971520` | Files above this are kept by reference (no stored copy), in any source |
| `DRIVE_SYNC_MAX_ITEMS_PER_SOURCE` | `20000` | Walk cap per source and generation |
| `DRIVE_SYNC_MAX_DEPTH` | `30` | Folders deeper than this are not listed |
| `DRIVE_SYNC_COMMUNITY_ENABLED` | `true` | Expand community archives at the start of every run |
| `DRIVE_SYNC_COMMUNITY_ONLY_CODES` | — | Dev only: comma list of subject codes; expansion creates sources only for those folders (others are disconnected) |
| `DRIVE_SYNC_FAKE_DEMO_OWNERS` | — | Fake only: comma list of emails; each gets a demo folder `demo-<local part>` it owns |
| `STORAGE_INTERNAL_ENDPOINT` | — (= `STORAGE_ENDPOINT`) | Where the API itself writes copies (compose: `http://minio:9000`), bypassing Caddy's upload body limit |
| `AUTH_DEV_LOGIN_ENABLED` | `false` | Enables `POST /v1/auth/dev-login`, **only** with the `dev` profile |

Without a key (and without `DRIVE_SYNC_USE_FAKE`) the student endpoints (`/v1/me/drive/**`) answer 503
`DRIVE_SYNC_UNCONFIGURED`. Reader and staff endpoints keep serving what was already synced.
An unparseable key is logged at startup and treated as "no key".

Local stack for this feature: `docker-compose.drive.yml` + `.env.drive.example` (API on :8081, see the file header).

## Statuses

- Source `status`: `PENDING_REVIEW`, `ACTIVE`, `BLOCKED`, `REVOKED`, `DISCONNECTED`, `ERROR`.
- File `publication`: `PRIVATE` (no subject or hidden), `NEEDS_REVIEW`, `PUBLISHED`, `HIDDEN_REPORTED`, `REMOVED_BY_STAFF`, `REMOVED`.
- Source `kind`: `STUDENT`, `COMMUNITY_ROOT`, `COMMUNITY` (see "Community sources").
- File `kind`: `FOLDER`, `DOC`, `SLIDES`, `SHEET`, `DRAWING`, `PDF`, `IMAGE`, `OFFICE`, `OTHER`.
- What is imported at all (`service/drive/DriveKinds`): only what the wiki pipeline can read. `OTHER` is kept only
  for text-like files (code, notebooks, CSV, Markdown, JSON...: `DriveMedia.isTextLike`), stored as text. Everything
  else that is not a Google Doc/Slides/Sheet/Drawing, PDF, image or Office file is skipped entirely: no row, no
  download, not counted. That includes every `video/*`, `audio/*`, archives (zip, rar, 7z), executables, disk
  images, CAD files, HTML/XML/SVG-as-text, forms, sites and maps. Images are kept in student sources (photos of
  handwritten notes) and skipped in community sources. Rows of kinds that are skipped now (from before this rule)
  are not seen by the next walk generation, so they go `REMOVED` when it completes (wiki pages citing them are
  hidden) and are purged with their copies 30 days later.
- Community sources: every file counts as the community's (`ownedBySharer` true), the source is `ACTIVE` and
  approved, so files with a subject are `PUBLISHED` without review. Reports, staff hide/remove/block and the
  `apuntes` capability apply as usual.
- Publish rule: a non-folder file with an effective subject, not hidden, is `PUBLISHED` when it is owned by the
  source's student **and** the source is `ACTIVE`; otherwise `NEEDS_REVIEW` (owner differs) or held while the
  source is `PENDING_REVIEW`. Staff decisions (`REMOVED_BY_STAFF`, explicit publish) stick across syncs.
- 3 reports from different users move a `PUBLISHED` file to `HIDDEN_REPORTED`.
- Files **not owned** by the source's student start **hidden** (so `PRIVATE`). The student can unhide them;
  they then go to `NEEDS_REVIEW` for staff. Once the student sets `hidden` on a file (either way), syncs never
  change it again; until then the default is re-applied if the Drive owner changes. Folders are never hidden
  by default (hiding a folder hides the student's own files in it).
- Details: "held" files (source `PENDING_REVIEW`) are `NEEDS_REVIEW`. Folders are always `PRIVATE`. `hidden` on a
  folder hides everything below it. `BLOCKED`/`REVOKED` sources publish nothing; an approved source in `ERROR`
  keeps publishing. A staff publish ignores reports; staff `restore` clears the staff decision **and deletes the
  file's reports** (count back to 0). Implementation: `service/drive/PublicationRule`.

## Subject suggestions

`service/drive/SubjectMatcher`, recomputed on every sync, PATCH and `POST .../recompute-suggestions`:

- A subject code in the name (`93.41`, `93-41`, `9341`) wins.
- Otherwise accent/case-insensitive word overlap: light stemming (Matemática ~ Matemático ~ Matemáticas), prefixes of
  4+ letters (`Mate`, `Proba`, `Metodo`, `Estad`), short abbreviations (`Fís`, `AM`, `EDA`, `POO`, `PI`, `MD`).
  Filler words never count (resumen, apuntes, teoría, práctica, tp, parcial, final, guía, clase, ingreso, de, la,
  el, ...). Numerals: I-VI = 1-6; a numeral in the name that contradicts the subject's rules it out
  ("Física 2" is not Física I); none in the name is fine. Dates (`5/5/20`) are ignored.
- The source owner's plan (`user.plan` + `plan_subject`) is tried first with threshold 0.5 (share of the subject's
  words found), then all subjects with 0.75. Ties: first word matched, earlier in the plan, more words, name.
- Inheritance: an item's `suggestedSubjectId` is set only when it has no effective subject and its own match differs
  from the suggestion it inherits from its folders. `accept-suggestions` applies every suggestion, so a matched folder
  covers its unmatched children.

## Academic year

Sources show the year the material was made, not their last update (notes and TPs go stale as courses change).
`academicYear` is computed on every sync and PATCH, first match wins (`academicYearSource`):

1. `USER` — set by the student on this item (`PATCH … { academicYear }`; `ownAcademicYear` on `TreeItem`).
2. `INHERITED` — set by the student on an ancestor folder (`ownAcademicYear` is `null`: show "Automático"
   relative to the item, the year comes from the folder).
3. `NAME` — a 4-digit year 2000..current year as its own token in the file name, else in the nearest folder name on
   its path ("Resumen Quimica ingreso 2020", "Parciales 2019"); also `1C'21`, `2C-22`, `cuatri-20`. A number followed
   by a quantity word ("Tabla 2000 filas") is not a year.
4. `DRIVE` — the year of min(createdTime, modifiedTime) in America/Argentina/Buenos_Aires. `createdTime` is now
   synced (`drive_created_at`; existing rows are filled by the next walk).

## Sync and change detection

- Identity is `(source_id, drive_id)`; our file `id` is stable across renames and moves.
- Binary files: fingerprint = `md5Checksum`; downloaded only when it changes.
- Native Google files (Docs/Slides/Sheets/Drawings): `modifiedTime` is only the trigger (renames bump it too).
  When it changes the file is exported again and hashed: Docs = sanitized HTML + image bytes, Slides/Sheets =
  PDF text + page count, Drawings = PNG bytes. Same hash = metadata only (no new objects).
- Renames/moves are metadata only: path and effective subject are recomputed.
- An item reached twice in one walk (shortcut + original, cycles) is one row; the first path (BFS) wins.
  A shortcut is followed only when its target is owned (Drive `owners`) by the source's student; shortcuts to items
  the bot cannot read or that someone else owns are skipped (and counted in the sync log), so a shortcut can never
  pull another student's file into a source through the bot's access.
- Missing after a **complete, clean walk generation** → `REMOVED`, row and copy purged 30 days later (see
  "Resumable walk"; a partial or capped walk never removes anything).
- Cross-source move (same student): the row moves to the other source keeping its id, copy and explicit subject,
  whichever source syncs first. Same file in sources of different students → separate rows sharing one stored copy.
- Stored copies: `drive/<driveId>/<hash of fingerprint>/...` in the media bucket; `drive/` is never anonymously
  readable (MinIO policy), only via 5-minute signed URLs. Objects are deleted when no row uses them any more.
- Re-registering a `REVOKED` folder reactivates the same source; `POST .../sync` also retries a `REVOKED` source.
  `DELETE` (disconnect) deletes every file row and copy; the source row stays `DISCONNECTED`. Wiki pages citing
  those files are hidden and their digests/LLM payloads dropped (`docs/SUBJECT-WIKI-PIPELINE.md`, "Privacy").
- A `BLOCKED` source cannot be disconnected (409 `DRIVE_SOURCE_BLOCKED`), and a folder that is `BLOCKED` in any
  source cannot be registered again (409 `DRIVE_SOURCE_BLOCKED`), so a block cannot be bypassed by re-registering.
- A sync writes into a source under a row lock and stops when the source is gone, `DISCONNECTED` or `BLOCKED`, so a
  disconnect, block or account deletion during a running sync is never undone; objects uploaded for a row that
  vanished meanwhile are deleted. An unexpected error fails only its source (counted towards `ERROR`); the scheduled
  run carries on and the 30-day purge always runs.
- Requested syncs (register, `POST .../sync`, staff reprocess) run on a dedicated pool of 2 threads with a bounded
  queue (500), not on the shared task executor; when the queue is full the request is left to the scheduled run.
- Whenever a file stops being `PUBLISHED` (or moves to another subject), wiki pages citing it are hidden at once
  (takedown); the next pipeline run rewrites those subjects.

## Resumable walk

Every source is walked in **generations** (`wiki.drive_source_walk`, `service/drive/DriveWalker`):

- A generation starts at the root and is a BFS; the folders still to list (the frontier, with their depth) are
  saved after every slice. The next run continues from that frontier instead of starting over, so a huge tree
  makes progress run after run.
- Items reached get `drive_file.seen_generation`. Folders and items already seen in the generation (also in
  earlier runs) are skipped, so a folder is listed at most once per generation.
- When the frontier is empty the generation is complete. Only then, and only if nothing went wrong in it (no
  folder vanished mid-walk, no cap hit), are rows not seen in it marked `REMOVED`. The next run starts a new
  generation.
- Time: each source gets a slice of min(remaining run budget, `DRIVE_SYNC_SOURCE_BUDGET`). At most **half** of it is
  spent walking; the rest fetches content. Fetch tasks are computed from the rows (content missing or older than
  the Drive metadata the walk recorded), so files found by earlier slices are fetched while the walk is still
  unfinished; files that failed last time go last. `lastSyncedAt` is set after every slice (also partial ones), so
  the scheduler (oldest `lastSyncedAt` first) rotates an unfinished source to the back and one heavy source cannot
  starve the others.
- Loops are impossible: besides the per-generation "seen" set, a shortcut is never followed to the source's root
  or to any folder above it (`root_ancestors`, read once per generation); community sources never follow shortcuts
  into the archive (another subject's folder). Hard caps: `DRIVE_SYNC_MAX_ITEMS_PER_SOURCE` items per generation
  and `DRIVE_SYNC_MAX_DEPTH` levels. Hitting one ends the generation as incomplete (nothing is removed) with a
  warning in the source's `lastError`.

## Community sources

A community archive is a Drive folder shared with the bot that belongs to no student, e.g. "1-Materias"
(`1V3b2mlgCODmHaUh4WbvuHa4_POyvJvd1`, seeded by V42 as a `COMMUNITY_ROOT`, `ACTIVE`, label "Comunidad",
storage `REFERENCE`). It is never walked itself:

- At the start of every run (`DriveCommunityService`), its top-level folders are listed and kept as one
  `COMMUNITY` source each (`user_id` null, `parent_source_id` = the root, same label and storage mode), so every
  walk stays small. New folders are picked up, folders that disappear are disconnected (rows and copies deleted).
  A listing that fails changes nothing. `BLOCKED` sources are left alone.
- Subject: from the folder name `<code> - <name>`; the leading codes `^\d{2}\.\d{2}` (several allowed:
  `12.43 - 12.44 - Ciencia de Materiales`). A source has one subject: the **first** listed code that exists in
  `public.subject`. Every file of the source counts for it (`drive_source.subject_id`, the fallback of the
  effective subject).
- Skipped (no source is created): names starting with `00.` (`00.00 - ORGANIZAR...`, `00.00 - Resúmenes`,
  `00.01 Útil`), names without a leading code, and codes not in `public.subject` (created on a later run once the
  subject exists). `DRIVE_SYNC_COMMUNITY_ONLY_CODES` (dev) limits expansion to those codes.
- Files: no student-ownership checks; every file is community content (`ownedBySharer` true) and published without
  review. The contributors' Drive owners (personal Gmail addresses) are **never stored** (`owner_email` null) and
  never returned; the archive owner's address is kept only on the source row for the shortcut rule (shortcuts are
  followed only to items it owns) and is not exposed either. Author = the label: `author: { name: "Comunidad",
  anonymous: false, community: true }`. File and source DTOs carry `community: true`, so the SPA can show
  "Comunidad · archivo <academicYear>" (the academic year is computed as for any file).
- Wiki pipeline: PLAN/WRITE inputs carry each source's `academicYear` and `community`; the prompts prefer recent
  student notes when sources overlap or contradict and use the archive to fill gaps (`KB_STALE_YEARS` still drives
  the "stale" flag of pages).

## Reference storage (no copies)

Per source `storage_mode`: `COPY` (default for students) or `REFERENCE` (default for community sources). Any file
above `DRIVE_SYNC_REFERENCE_ABOVE_BYTES` is handled by reference in any source.

- By reference nothing goes to MinIO. Only what the wiki and search need is kept: extracted text (PDFs and the PDF
  export of Slides/Sheets are spooled to a temp file, read and deleted; text-like files likewise) and Docs'
  sanitized HTML **without images** (a Doc's images and its PDF export are not stored). Images, Office files and
  Drawings are not downloaded at all during the sync. Videos and audio are never imported (see "Statuses").
- `GET /v1/wiki/files/{id}/download` keeps its URL and parameters: for a file kept by reference it answers **200
  with the bytes streamed from Drive through the bot** instead of a 302 (same auth and capability checks, same
  inline rule: PDF, raster images and text inline, everything else an attachment served as
  `application/octet-stream`; `Content-Disposition` with the file name, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`). `pdf` = the PDF itself or the on-demand PDF export of a Doc/Slides/Sheet; `original` =
  the file (Drawings: PNG export). Capped at `DRIVE_SYNC_MAX_FILE_BYTES` (the response is cut past it). 404 when
  the bot lost access or the owner disabled downloads. `hasPdf`/`hasOriginal`/`*MimeType` describe what can be
  streamed. Doc image assets do not exist for these files.
- Rows kept by reference have `by_reference` true and a `ref:`-prefixed fingerprint (never shared with stored
  copies). Changing the mode (or a file crossing the threshold) fetches the file again in the new mode and
  releases its old copy.

## Endpoints (all under `/api/v1`, JSON, cookie auth)

Errors use the usual `{error, message, path, timestamp}` body. Other errors: 404 `ResourceNotFound` for
sources/files that are not the caller's (or not visible), 400 `ValidationError` for a `consentVersion` that is
not the current one or an unknown `subjectId`, 409 `InvalidState` for `POST .../sync` on a `BLOCKED` source.
Drive-specific `error` codes:
`DRIVE_INVALID_FOLDER_URL` (400), `DRIVE_FOLDER_NOT_SHARED` (422), `DRIVE_FOLDER_NOT_OWNED` (403),
`DRIVE_SOURCE_EXISTS` (409), `DRIVE_SOURCE_BLOCKED` (409), `DRIVE_SYNC_RATE_LIMITED` (429),
`DRIVE_SYNC_UNCONFIGURED` (503).

### Dev login (dev profile + `AUTH_DEV_LOGIN_ENABLED=true` only; otherwise 404)

`POST /v1/auth/dev-login` `{ "email": "alumno1@itba.edu.ar", "name": "Alumno Uno", "staff": false }`
→ 204, sets the same HttpOnly session cookie as Google login. `staff: true` ensures an active `ceitba_staff` row.

### Student

| Method + path | Body | Response |
|---|---|---|
| `GET /v1/me/drive/info` | — | `{ botEmail, consentVersion, consentText }` |
| `POST /v1/me/drive/sources` | `{ folderUrl, consentVersion, anonymous }` | 201 `Source` |
| `GET /v1/me/drive/sources` | — | `Source[]` |
| `GET /v1/me/drive/sources/{id}/tree` | — | `{ source: Source, items: TreeItem[] }` |
| `PATCH /v1/me/drive/sources/{id}` | `{ anonymous }` | `Source` |
| `DELETE /v1/me/drive/sources/{id}` | — | 204 |
| `POST /v1/me/drive/sources/{id}/sync` | — | 202 (max once per 5 min per source) |
| `POST /v1/me/drive/sources/{id}/accept-suggestions` | — | `{ applied }` |
| `POST /v1/me/drive/sources/{id}/recompute-suggestions` | — | `{ source: Source, items: TreeItem[] }` (fresh tree, with the caller's current plan) |
| `PATCH /v1/me/drive/files/{fileId}` | `{ subjectId?, hidden?, academicYear? }` (`subjectId: ""` clears; `academicYear: null` = automatic again, absent = unchanged; 1990..current year) | `TreeItem` |

`consentVersion` must equal `GET /v1/me/drive/info`'s. New sources start `PENDING_REVIEW`, or `ACTIVE` when the
student already has an `ACTIVE` one. `accept-suggestions` applies suggestions top-down (a matched folder covers its
files). The `429` carries `Retry-After` (seconds).

`Source` = `{ id, rootName, status, anonymous, lastSyncedAt, lastError, fileCount, publishedCount, needsReviewCount, createdAt, community }`

`TreeItem` = `{ id, parentId, name, kind, subjectId, subjectName, effectiveSubjectId, effectiveSubjectName,
suggestedSubjectId, suggestedSubjectName, suggestedInMyPlan, effectiveInMyPlan, hidden, publication, ownedByMe, sizeBytes, driveModifiedAt, syncError, exportBlocked, driveUrl,
academicYear, academicYearSource, ownAcademicYear }`
— a flat list; `parentId` is another item's `id`, or `null` for direct children of the shared folder.

### Reader (logged in)

| Method + path | Response |
|---|---|
| `GET /v1/wiki/apuntes/subjects?q=&limit=20&mine=` | `[{ subjectId, subjectName, fileCount, lastUpdatedAt, year, semester, section, hasWiki }]` (`hasWiki`: the subject wiki has at least one `PUBLISHED` page; every listing) — no `q`: subjects with published files, most recently updated first; with `q`: all subjects matching code or name (accent-insensitive); `mine=true`: the caller's plan subjects (`q`/`limit` ignored, `[]` without a plan): curricular subjects by year/semester first, then electives and other year-0 entries grouped by `section` (sections alphabetically, subjects by name); a subject that is both keeps its curricular entry. `year`/`semester`/`section` are only set with `mine=true` (else `null`); `year`/`semester` are `null` for year-0 entries, whose group is `section` (e.g. `"Electivas Analytics"`, `"SAT"`) |
| `GET /v1/wiki/subjects/{subjectId}/files` | `{ subjectId, subjectName, groups: [{ sourceId, author: { name, anonymous, community }, files: FileSummary[] }] }` (community groups: `name` = "Comunidad") |
| `GET /v1/wiki/files/{fileId}` | `FileSummary` + `{ subjectId, subjectName, author, html, reportedByMe }` (`html` only for Docs) |
| `GET /v1/wiki/files/{fileId}/download?variant=pdf\|original&disposition=inline\|attachment` | 302 to a 5-minute signed URL (default `disposition=inline`); files kept by reference: 200 streamed from Drive (see "Reference storage") |
| `GET /v1/wiki/files/{fileId}/assets/{name}` | 302 to a signed URL of an image embedded in a Doc's HTML (always inline, image content type) |
| `PUT /v1/wiki/files/{fileId}/report` | body `{ reason, comment }`, reason ∈ `COPYRIGHT, PERSONAL_DATA, WRONG_SUBJECT, SPAM, OTHER` → 204 |

`FileSummary` = `{ id, name, kind, path, sizeBytes, driveModifiedAt, publishedAt, hasHtml, hasPdf, hasOriginal,
pdfMimeType, originalMimeType, exportBlocked, driveUrl, academicYear, academicYearSource, community }`
(`path` = folder path inside the source, e.g. `"Comunicación/Trabajo Plasticos"`).

`html` is sanitized (no style/class/script/iframe) after turning the export's CSS classes into markup: real nested
`<ul>`/`<ol>` (`<ol type="1|a|A|i|I" start>`), `<strong>`, `<em>`, `<u>`, `<s>`, `<sup>`, `<sub>`, indented paragraphs
as `<blockquote>`, and `data-align="center|right"` on paragraphs/headings/cells; its `<img src>` are root-relative
`/api/v1/wiki/files/{fileId}/assets/{name}` (an SPA on another origin must prefix the API origin, or proxy `/api`).
`download` without `variant` serves the PDF when there is one, else the original; a missing variant is 404.
`disposition=inline` (default) presigns `response-content-disposition: inline; filename*=UTF-8''<name>` with the
served `response-content-type`, but only for types that are safe on the site's origin: PDF, PNG/JPEG/GIF/WebP/BMP,
and text-like files (source code, `.ipynb`, JSON, CSV, Markdown, plain text) served as `text/plain; charset=utf-8`.
Everything else (Office, SVG, ...) is always an attachment. `disposition=attachment` forces a download. Anything
else is 400.

- `pdfMimeType`: `"application/pdf"` when `hasPdf`, else `null`.
- `originalMimeType`: the Content-Type the original is served with (text-like: `"text/plain; charset=utf-8"`), `null`
  without an original. Text-like files of kind `OTHER` are now stored too (HTML/XML/SVG are not).
- `exportBlocked`: the owner disabled download for viewers (Drive `cannotExportFile`/`cannotDownloadFile`). The file is
  kept as metadata only, without `syncError`, `hasPdf`/`hasOriginal` false; show "El autor deshabilitó la descarga"
  and link to `driveUrl`. Retried whenever Drive reports a change to the file.
- `driveUrl`: opens the item in Drive: `https://docs.google.com/{document|spreadsheets|presentation|drawings}/d/<id>/edit`
  for native files, `https://drive.google.com/drive/folders/<id>` for folders, else
  `https://drive.google.com/file/d/<id>/view` (also on `TreeItem`).
Only `PUBLISHED`/`HIDDEN_REPORTED` files can be reported (else 404); re-reporting replaces the caller's report.

Readers only see `PUBLISHED` files. STAFF can open any file, and the source's student can open the files of their
source that they own in Drive (`ownedByMe`), so they can preview before publishing (`GET /v1/wiki/files/{id}` and
downloads). A file owned by someone else that sits in the student's folder is not previewable by them. A staff
member calling with an API key without the `staff` scope reads like a student (`DriveAccess.isStaff`).

### Staff (`/v1/staff/**`, STAFF role)

| Method + path | Response |
|---|---|
| `GET /v1/staff/drive/sources?status=&page=0&limit=20` | `{ items: StaffSource[], total }` |
| `POST /v1/staff/drive/sources/{id}/approve` · `/block` (body `{ comment? }`) | `StaffSource` |
| `GET /v1/staff/drive/files?publication=NEEDS_REVIEW\|HIDDEN_REPORTED&page=0&limit=20` | `{ items: StaffFile[], total }` (default `NEEDS_REVIEW`; files of `PENDING_REVIEW` sources are left out: approve/block the source) |
| `POST /v1/staff/drive/files/{id}/publish` · `/remove` · `/restore` | `StaffFile` |
| `POST /v1/staff/drive/reprocess?kind=DOC\|SLIDES\|SHEET\|DRAWING` | `{ files, sources }` — re-export those files on a sync queued now (default `DOC`); results identical to the stored copy keep it |
| `GET /v1/staff/drive/unclaimed` | `[{ name, ownerEmail, firstSeenAt, lastSeenAt }]` |

`StaffSource` = `Source` + `{ ownerName, ownerEmail, subjectId }` (community sources: owner `null`, `subjectId` = the
folder's subject). `StaffFile.ownerEmail` is `null` for community files.

`StaffFile` = `{ id, name, kind, sourceId, sourceRootName, ownerEmail, sharerName, sharerEmail,
effectiveSubjectId, effectiveSubjectName, publication, reportCount, reports: [{ reason, comment, createdAt }], driveModifiedAt,
academicYear, academicYearSource }`

## Pinned subjects

Pins on top of `/apuntes` reuse the subject bookmarks (`wiki.subject_bookmarks`, `/v1/wiki/bookmarks`):

| Method + path | Response |
|---|---|
| `GET /v1/wiki/bookmarks` (logged in) | `[{ subjectId, subjectName, fileCount, hasWiki, pinnedAt }]`, most recently pinned first. `fileCount` = published Apuntes files; `hasWiki` = the subject wiki has a published page |
| `GET /v1/wiki/bookmarks/{subjectId}` (public) | `{ count, bookmarked }` (unchanged) |
| `PUT` / `POST /v1/wiki/bookmarks/{subjectId}` | pin (idempotent) → `{ count, bookmarked }`; 409 `BOOKMARK_LIMIT` when the user already has 30 pins |
| `DELETE /v1/wiki/bookmarks/{subjectId}` | unpin → 204 |

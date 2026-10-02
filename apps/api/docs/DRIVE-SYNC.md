# Drive sync ("Apuntes")

Students share a Google Drive folder with the CEITBA bot service account; the API polls it,
stores copies in MinIO + metadata in Postgres, and serves them per subject. Full design:
https://claude.ai/code/artifact/0c362715-0f9a-45bf-844a-a87c225d1c6d

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `DRIVE_SYNC_ENABLED` | `false` | Turns on the scheduled job |
| `DRIVE_SYNC_INTERVAL` | `PT30M` | Delay between runs |
| `DRIVE_SYNC_RUN_BUDGET` | `PT10M` | Max wall time per run |
| `DRIVE_SYNC_SERVICE_ACCOUNT_JSON` | — | Base64 of the service-account key JSON |
| `DRIVE_SYNC_USE_FAKE` | `false` | Use the in-memory `FakeDriveClient` (tests / offline dev) |
| `DRIVE_SYNC_MAX_FILE_BYTES` | `52428800` | Larger files are stored as metadata only |
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
- File `kind`: `FOLDER`, `DOC`, `SLIDES`, `SHEET`, `DRAWING`, `PDF`, `IMAGE`, `OFFICE`, `OTHER`.
- Publish rule: a non-folder file with an effective subject, not hidden, is `PUBLISHED` when it is owned by the
  source's student **and** the source is `ACTIVE`; otherwise `NEEDS_REVIEW` (owner differs) or held while the
  source is `PENDING_REVIEW`. Staff decisions (`REMOVED_BY_STAFF`, explicit publish) stick across syncs.
- 3 reports from different users move a `PUBLISHED` file to `HIDDEN_REPORTED`.
- Details: "held" files (source `PENDING_REVIEW`) are `NEEDS_REVIEW`. Folders are always `PRIVATE`. `hidden` on a
  folder hides everything below it. `BLOCKED`/`REVOKED` sources publish nothing; an approved source in `ERROR`
  keeps publishing. A staff publish ignores reports; staff `restore` clears the staff decision **and deletes the
  file's reports** (count back to 0). Implementation: `service/drive/PublicationRule`.

## Sync and change detection

- Identity is `(source_id, drive_id)`; our file `id` is stable across renames and moves.
- Binary files: fingerprint = `md5Checksum`; downloaded only when it changes.
- Native Google files (Docs/Slides/Sheets/Drawings): `modifiedTime` is only the trigger (renames bump it too).
  When it changes the file is exported again and hashed: Docs = sanitized HTML + image bytes, Slides/Sheets =
  PDF text + page count, Drawings = PNG bytes. Same hash = metadata only (no new objects).
- Renames/moves are metadata only: path and effective subject are recomputed.
- An item reached twice in one walk (shortcut + original, cycles) is one row; the first path (BFS) wins.
  Shortcuts to items the bot cannot read are skipped.
- Missing after a **complete** walk → `REMOVED`, row and copy purged 30 days later.
- Cross-source move (same student): the row moves to the other source keeping its id, copy and explicit subject,
  whichever source syncs first. Same file in sources of different students → separate rows sharing one stored copy.
- Stored copies: `drive/<driveId>/<hash of fingerprint>/...` in the media bucket; `drive/` is never anonymously
  readable (MinIO policy), only via 5-minute signed URLs. Objects are deleted when no row uses them any more.
- Re-registering a `REVOKED` folder reactivates the same source; `POST .../sync` also retries a `REVOKED` source.
  `DELETE` (disconnect) deletes every file row and copy; the source row stays `DISCONNECTED`.

## Endpoints (all under `/api/v1`, JSON, cookie auth)

Errors use the usual `{error, message, path, timestamp}` body. Other errors: 404 `ResourceNotFound` for
sources/files that are not the caller's (or not visible), 400 `ValidationError` for a `consentVersion` that is
not the current one or an unknown `subjectId`, 409 `InvalidState` for `POST .../sync` on a `BLOCKED` source.
Drive-specific `error` codes:
`DRIVE_INVALID_FOLDER_URL` (400), `DRIVE_FOLDER_NOT_SHARED` (422), `DRIVE_FOLDER_NOT_OWNED` (403),
`DRIVE_SOURCE_EXISTS` (409), `DRIVE_SYNC_RATE_LIMITED` (429), `DRIVE_SYNC_UNCONFIGURED` (503).

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
| `PATCH /v1/me/drive/files/{fileId}` | `{ subjectId?, hidden? }` (`subjectId: ""` clears) | `TreeItem` |

`consentVersion` must equal `GET /v1/me/drive/info`'s. New sources start `PENDING_REVIEW`, or `ACTIVE` when the
student already has an `ACTIVE` one. `accept-suggestions` applies suggestions top-down (a matched folder covers its
files). The `429` carries `Retry-After` (seconds).

`Source` = `{ id, rootName, status, anonymous, lastSyncedAt, lastError, fileCount, publishedCount, needsReviewCount, createdAt }`

`TreeItem` = `{ id, parentId, name, kind, subjectId, subjectName, effectiveSubjectId, effectiveSubjectName,
suggestedSubjectId, suggestedSubjectName, hidden, publication, ownedByMe, sizeBytes, driveModifiedAt, syncError }`
— a flat list; `parentId` is another item's `id`, or `null` for direct children of the shared folder.

### Reader (logged in)

| Method + path | Response |
|---|---|
| `GET /v1/wiki/apuntes/subjects?q=&limit=20` | `[{ subjectId, subjectName, fileCount, lastUpdatedAt }]` — no `q`: subjects with published files, most recently updated first; with `q`: all subjects matching code or name (accent-insensitive) |
| `GET /v1/wiki/subjects/{subjectId}/files` | `{ subjectId, subjectName, groups: [{ sourceId, author: { name, anonymous }, files: FileSummary[] }] }` |
| `GET /v1/wiki/files/{fileId}` | `FileSummary` + `{ subjectId, subjectName, author, html, reportedByMe }` (`html` only for Docs) |
| `GET /v1/wiki/files/{fileId}/download?variant=pdf\|original` | 302 to a 5-minute signed URL |
| `GET /v1/wiki/files/{fileId}/assets/{name}` | 302 to a signed URL of an image embedded in a Doc's HTML |
| `PUT /v1/wiki/files/{fileId}/report` | body `{ reason, comment }`, reason ∈ `COPYRIGHT, PERSONAL_DATA, WRONG_SUBJECT, SPAM, OTHER` → 204 |

`FileSummary` = `{ id, name, kind, path, sizeBytes, driveModifiedAt, publishedAt, hasHtml, hasPdf, hasOriginal }`
(`path` = folder path inside the source, e.g. `"Comunicación/Trabajo Plasticos"`).

`html` is sanitized (no style/class/script/iframe); its `<img src>` are root-relative
`/api/v1/wiki/files/{fileId}/assets/{name}` (an SPA on another origin must prefix the API origin, or proxy `/api`).
`download` without `variant` serves the PDF when there is one, else the original; a missing variant is 404.
Only `PUBLISHED`/`HIDDEN_REPORTED` files can be reported (else 404); re-reporting replaces the caller's report.

Readers only see `PUBLISHED` files. The file's owner student and STAFF can open any of their/all files
(`GET /v1/wiki/files/{id}` and downloads) so they can preview before publishing.

### Staff (`/v1/staff/**`, STAFF role)

| Method + path | Response |
|---|---|
| `GET /v1/staff/drive/sources?status=&page=0&limit=20` | `{ items: StaffSource[], total }` |
| `POST /v1/staff/drive/sources/{id}/approve` · `/block` (body `{ comment? }`) | `StaffSource` |
| `GET /v1/staff/drive/files?publication=NEEDS_REVIEW\|HIDDEN_REPORTED&page=0&limit=20` | `{ items: StaffFile[], total }` (default `NEEDS_REVIEW`; files of `PENDING_REVIEW` sources are left out: approve/block the source) |
| `POST /v1/staff/drive/files/{id}/publish` · `/remove` · `/restore` | `StaffFile` |
| `GET /v1/staff/drive/unclaimed` | `[{ name, ownerEmail, firstSeenAt, lastSeenAt }]` |

`StaffSource` = `Source` + `{ ownerName, ownerEmail }`

`StaffFile` = `{ id, name, kind, sourceId, sourceRootName, ownerEmail, sharerName, sharerEmail,
effectiveSubjectId, effectiveSubjectName, publication, reportCount, reports: [{ reason, comment, createdAt }], driveModifiedAt }`

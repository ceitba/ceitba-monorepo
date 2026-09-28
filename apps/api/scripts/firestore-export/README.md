# firestore-export

One-off tool that exports the legacy CEITBA Firestore project (the old
Flutter app's backend) into the JSON document consumed by
`POST /api/v1/sync/import/firestore`.

Collections exported: `Usuarios`, `Propuestas`, `Benefits`, as
`{ "usuarios": [...], "propuestas": [...], "benefits": [...] }`. Each entry
is the document data plus its id as `"id"`; Timestamps become ISO-8601
strings. `fcmTokens` are dropped. The script only reads Firestore.

## Run

Needs Node 18+ and a Firebase service-account key with read access to
Firestore (Firebase console -> Project settings -> Service accounts).

```sh
cd scripts/firestore-export
npm install
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json \
  node export.mjs --out /secure/path/firestore-export.json
```

`--credentials <file>` can replace the env var; `--project <id>` overrides
the project id from the key.

For the real import, add `--copy-attachments` (required for proposal
attachments to survive, see below). It downloads every Propuestas `filesURL`
and uploads it to the API's bucket (self-hosted MinIO, see
`docs/OBJECT-STORAGE.md`) as `proposals/legacy/{uuid}.{ext}`, so it also
needs the API's storage settings (`STORAGE_*`; the older `R2_*` names are
accepted as fallbacks). Use the API's service user (`STORAGE_ACCESS_KEY_ID`
/`STORAGE_SECRET_ACCESS_KEY` from the VPS `.env`), not the MinIO root user:

```sh
STORAGE_ENDPOINT=https://ceitba.org.ar STORAGE_BUCKET=ceitba-media \
STORAGE_ACCESS_KEY_ID=ceitba-api STORAGE_SECRET_ACCESS_KEY=... \
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json \
  node export.mjs --copy-attachments --out /secure/path/firestore-export.json
```

Uploads use path-style URLs (`https://ceitba.org.ar/ceitba-media/<key>`),
which Caddy forwards to MinIO. That route caps request bodies at 12 MB, while
the script accepts attachments up to 20 MB: a larger file fails with a
`Propuestas/<id>: attachment not copied` line. Re-run from the VPS inside the
compose network to bypass Caddy, e.g.
`docker run --rm --network ceitba-api_ceitba-network -e STORAGE_ENDPOINT=http://minio:9000 ...`
with this directory mounted (`STORAGE_ENDPOINT` only needs to be reachable
by the script; the stored keys do not depend on it).

The `{uuid}` is derived from the download URL (whose token is secret), so a
re-run overwrites the same objects. The script exits with status 1 when any
attachment could not be copied; the log names only the document id.

The output contains names and emails: keep it outside the repo
(`.gitignore` blocks `*.json` here anyway), send it only to the API over
HTTPS, and delete it when the import is done.

## Import

Always dry-run first and read the report (`errors[]`, `warnings[]`):

```sh
curl -sS -X POST "https://<host>/api/v1/sync/import/firestore?dryRun=true" \
  -H "X-Api-Key: $AUTH_SYNC_API_KEY" -H "Content-Type: application/json" \
  --data-binary @/secure/path/firestore-export.json

# then without dryRun (or dryRun=false)
```

The import is idempotent: re-running it updates rows in place and never
duplicates them. Mapping rules are documented in
`src/main/java/org/ceitba/api/service/sync/FirestoreImportService.java`
(users, benefits) and `ProposalFirestoreImporter.java` (proposals).

`propuestas` go into the proposals board: `authorized` 0/1/2 becomes
PENDING/APPROVED/REJECTED, `status` the lifecycle, `votes` the up/down
votes, `comments` (and their `replies`) the comment threads, `userNames`
the per-proposal aliases, and `filesURL` the attachments. Only the object
keys written by `--copy-attachments` are imported; a raw Firebase Storage URL is
dropped with a warning (a later re-run with copied keys adds it), so no
imported attachment depends on the legacy Firebase project. Keep
`CONTENT_HMAC_SECRET` (or, when it is unset, `AUTH_JWT_SECRET`) the same
across import runs: imported comment ids are keyed on it. Authors, voters and
commenters are matched through the users imported from `usuarios` in the
same run, so a first dry run reports every proposal author as missing
(the users do not exist yet); the real run does not. Re-runs only add
votes, comments and attachments that are missing; they never overwrite
a proposal or its activity in the new system.

### Deleted accounts and re-runs after launch

Run the real import once, before the new app launches. Re-runs afterwards
are possible but limited:

- An account deleted through `DELETE /v1/me` after it was imported is
  remembered by its Firebase uid (SHA-256 in `deleted_firebase_accounts`).
  A re-run reports that `usuarios` document as skipped with a warning and
  never re-creates the account or links the uid to a new account with the
  same email. A proposal the deletion removed (not APPROVED) is not re-created
  either.
- Only accounts that were already linked to their Firebase uid are
  remembered. Someone who signs in to the new app *before* their first import,
  deletes the account, and is then imported would be created again from the
  legacy data. Importing before launch rules this out.
- Their comments are not affected: account deletion keeps comments as
  tombstones with the same ids, and a re-run never overwrites an existing
  comment.

Prerequisites on the target DB: careers/plans loaded (V6 seed or
`POST /v1/careers/{id}/plans`) and the `convenios` benefit category (V21).

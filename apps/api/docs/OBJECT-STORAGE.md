# Object storage (self-hosted MinIO, S3-compatible)

The API never receives file bytes. It signs short-lived presigned `PUT` URLs
(`STORAGE_PRESIGN_TTL`, default 10 min) and the client uploads straight to the
bucket (`service/media/MediaUploadService`). The API only *signs* (AWS SDK v2
`S3Presigner`, local computation): it never opens a connection to the store.
Any empty `STORAGE_ENDPOINT`/`BUCKET`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY`/
`PUBLIC_URL` disables uploads (the sign endpoints answer `501`).

Any S3-compatible store works. Production runs MinIO on the VPS, in the
CEITBA-API compose project (`docker-compose.yml`: `minio` + `minio-init`).

## How a request flows

```
phone ── PUT https://ceitba.org.ar/ceitba-media/<key>?X-Amz-Signature=… ──┐
phone ── GET https://ceitba.org.ar/ceitba-media/<key> (anonymous) ────────┤
                                                                          ▼
                       Caddy (~/infra): handle /ceitba-media/*  → ceitba-minio:9000
                       (no path strip, Host header unchanged, body ≤ 12 MB)
```

- **Path style on the main host.** No extra DNS name or certificate: the
  bucket is the first path segment. `STORAGE_ENDPOINT=https://ceitba.org.ar`
  and `STORAGE_PUBLIC_URL=https://ceitba.org.ar/ceitba-media`.
- **SigV4 signs the Host.** The API signs for `ceitba.org.ar`, Caddy forwards
  the client's `Host: ceitba.org.ar` unchanged (its `reverse_proxy` default),
  and MinIO verifies against it. Never add `header_up Host …` to that route,
  and do not set `MINIO_DOMAIN` (that turns on virtual-host bucket lookup).
- `Content-Type` and `Content-Length` are signed too: the client must send
  exactly the `headers` returned by the sign endpoint.
- `MinioPresignedUploadIT` proves this end to end with the real images, the
  compose `minio-init` script and the Caddyfile's `/ceitba-media/*` block
  (upload through a proxy whose Host differs from MinIO's, anonymous
  download, rejection of unsigned/tampered uploads, listing, deletes and
  bodies over 12 MB).

## Configuration

| Variable | Prod value | Notes |
|---|---|---|
| `STORAGE_ENDPOINT` | `https://ceitba.org.ar` | Must be the URL clients reach (it is part of the signature) |
| `STORAGE_REGION` | `us-east-1` (default) | MinIO's default region |
| `STORAGE_BUCKET` | `ceitba-media` (compose default) | Also the Caddy route prefix; change both together |
| `STORAGE_ACCESS_KEY_ID` | `ceitba-api` | MinIO **service user** created by `minio-init`, not the root user |
| `STORAGE_SECRET_ACCESS_KEY` | `openssl rand -hex 32` | Service user's secret |
| `STORAGE_PUBLIC_URL` | `https://ceitba.org.ar/ceitba-media` | Base of the stored/public object URLs |
| `STORAGE_PRESIGN_TTL` | `10m` (default) | Lifetime of a signed PUT |
| `MINIO_ROOT_USER` | e.g. `ceitba-root` | MinIO admin; used only by `minio-init` and operators |
| `MINIO_ROOT_PASSWORD` | `openssl rand -hex 32` | At least 8 characters |
| `MINIO_CONSOLE_PORT` | `9001` (default) | Web console, bound to `127.0.0.1` on the host |

The older `R2_*` names (`R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`,
`R2_PRESIGN_TTL`) are still read as fallbacks when the `STORAGE_*` variable is
unset. `docker compose` requires `MINIO_ROOT_*` and `STORAGE_ACCESS_KEY_ID`/
`STORAGE_SECRET_ACCESS_KEY` (it refuses to start without them).

## What `minio-init` sets up

A one-shot container that runs on every `docker compose up` (idempotent) and
must succeed before `ceitba-api` starts:

1. Creates the bucket (`STORAGE_BUCKET`, default `ceitba-media`).
2. Sets an anonymous bucket policy allowing **only `s3:GetObject`** on
   `ceitba-media/*`. Objects are publicly readable by exact key; nobody can
   list the bucket (mc's canned `download` policy would also allow
   `s3:ListBucket`, so it is not used) or write without a signature.
3. Creates (or updates the secret of) the service user
   `STORAGE_ACCESS_KEY_ID` and attaches policy `ceitba-api`:
   `s3:PutObject` + `s3:GetObject` on `ceitba-media/*`. No delete, no list,
   no other bucket, no admin. A leaked API secret can add objects, nothing
   more.

Logs: `docker logs ceitba-minio-init`.

## Network exposure

- MinIO publishes **no** S3 port. Only Caddy reaches it (over the
  `ceitba-proxy` network) and only for `/ceitba-media/*`, so the admin API
  (`/minio/admin/…`) and other buckets are not reachable from the internet.
- The web console listens on `127.0.0.1:9001` on the VPS. Use an SSH tunnel:
  `ssh -L 9001:127.0.0.1:9001 <vps>` and open http://localhost:9001 (log in
  with the root credentials).
- Caddy caps request bodies on the route at 12 MB (the API signs at most
  10 MB). MinIO discards incomplete multipart uploads after 24 h by itself.

## VPS migration (first MinIO deploy)

Nothing has to be migrated from R2: R2 was never configured in production.
If it had been, `mc mirror r2/<bucket> local/ceitba-media` would copy the
objects, and stored public URLs (article/benefit/highlight images) would need
rewriting to `https://ceitba.org.ar/ceitba-media/…`.

1. **Add the env vars** to `~/CEITBA-API/.env` on the VPS (never committed,
   never copied by the deploy):

   ```sh
   MINIO_ROOT_USER=ceitba-root
   MINIO_ROOT_PASSWORD=$(openssl rand -hex 32)
   STORAGE_ENDPOINT=https://ceitba.org.ar
   STORAGE_BUCKET=ceitba-media
   STORAGE_ACCESS_KEY_ID=ceitba-api
   STORAGE_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
   STORAGE_PUBLIC_URL=https://ceitba.org.ar/ceitba-media
   ```

   Remove any `R2_*` and the obsolete `AUTH_JWT_AUDIENCE`. Keep a copy of
   both secrets in the team's password manager.

2. **Caddy.** The deploy workflow copies `infrastructure/caddy/Caddyfile` to
   `~/infra/Caddyfile` and, when it changed, validates it and restarts
   `ceitba-caddy` (the single-file bind mount does not see a replaced file
   otherwise). No manual step is needed, but if you deploy by hand:

   ```sh
   cp infrastructure/caddy/Caddyfile ~/infra/Caddyfile
   cd ~/infra
   docker compose run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker compose restart caddy
   ```

   The Caddyfile must have the `handle /ceitba-media/*` block **before** the
   final catch-all `handle` (the SPA), otherwise the SPA answers those paths.

3. **Deploy.** The first `docker compose up -d` pulls the MinIO/mc images,
   creates the `minio_data` volume, runs `minio-init` (bucket, anonymous
   read policy, service user) and then starts the API. The deploy workflow
   runs `docker compose config -q` first and stops if a required variable is
   missing from `.env`.

4. **Verify** (from any machine):

   ```sh
   # 403 AccessDenied (from MinIO, not the SPA's HTML): route works, listing is off
   curl -si https://ceitba.org.ar/ceitba-media/ | head -1
   # the sign endpoint answers 200 with a ceitba.org.ar/ceitba-media uploadUrl (STAFF token)
   curl -s -X POST https://ceitba.org.ar/api/v1/media/sign-upload \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"filename":"t.png","contentType":"image/png","sizeBytes":5}'
   ```

   Then `PUT` 5 bytes to `uploadUrl` with the returned headers and `GET` the
   `publicUrl`.

## Backup and restore

All objects *and* MinIO's own config (the service user and policies, under
`.minio.sys/`) live in the `minio_data` volume. With the compose project in
`~/CEITBA-API` the volume is `ceitba-api_minio_data` (check with
`docker volume ls | grep minio_data`).

Snapshot (a brief stop gives a consistent copy; uploads and image loads fail
for those few seconds):

```sh
cd ~/CEITBA-API
docker compose stop minio
docker run --rm -v ceitba-api_minio_data:/data:ro -v "$HOME/backups":/backup alpine \
  tar czf "/backup/minio-$(date +%F).tgz" -C /data .
docker compose start minio
```

Copy the archive off the VPS (with the Postgres dump: attachments are only
meaningful together with `proposal_attachment` rows).

Restore into an empty volume:

```sh
docker compose stop minio
docker run --rm -v ceitba-api_minio_data:/data -v "$HOME/backups":/backup alpine \
  sh -c 'rm -rf /data/* /data/.minio.sys && tar xzf /backup/minio-YYYY-MM-DD.tgz -C /data'
docker compose up -d
```

## Rotating credentials

**Service user secret** (e.g. after a leak):

1. Set a new `STORAGE_SECRET_ACCESS_KEY` in `~/CEITBA-API/.env`.
2. `cd ~/CEITBA-API && docker compose up -d`. `minio-init` updates the
   user's secret (`mc admin user add` on an existing user replaces it) and
   the API is recreated with the new value.

Upload URLs signed in the last `STORAGE_PRESIGN_TTL` (10 min) with the old
secret stop working; clients just sign again.

**New service user name** (changing `STORAGE_ACCESS_KEY_ID`): same steps;
`minio-init` creates the new user. Then remove the old one:

```sh
docker exec ceitba-minio sh -c 'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc admin user rm local <old-access-key>'
```

**Root password:** change `MINIO_ROOT_PASSWORD` in `.env` and run
`docker compose up -d` (MinIO takes root credentials only from the
environment, so the recreated container uses the new ones).

## Local development

`docker compose up` runs MinIO too (set the `MINIO_ROOT_*` and
`STORAGE_ACCESS_KEY_ID`/`SECRET` values from `.env.example`). Its S3 port is
not published, so leave `STORAGE_ENDPOINT` empty (uploads answer 501) unless
you are testing uploads; then publish it with a
`docker-compose.override.yml`:

```yaml
services:
  minio:
    ports: ["127.0.0.1:9000:9000"]
```

and set `STORAGE_ENDPOINT=http://localhost:9000`,
`STORAGE_PUBLIC_URL=http://localhost:9000/ceitba-media`. (An emulator or
phone needs the host's LAN IP instead of `localhost`, since the host is part
of the signature.)

## Key layout

| Prefix | Written by | Referenced from |
|---|---|---|
| `media/{uuid}.{ext}` | `POST /v1/media/sign-upload` (STAFF CMS images) | article, benefit and highlight image URLs |
| `proposals/{uuid}-{tag}.{ext}` | `POST /v1/proposals/attachments/sign-upload` | `proposal_attachment.object_key` |
| `proposals/legacy/{uuid}.{ext}` | `scripts/firestore-export --copy-attachments` | `proposal_attachment.object_key` (imported proposals) |

`{tag}` binds a proposal attachment key to its uploader without revealing or
linking them; see the header of `MediaUploadService`.

## Orphaned uploads

Signing an upload does not create any row. An object becomes referenced only
when the client then creates the proposal (or saves the CMS entity) with its
key. If the client uploads and never submits, the object stays in the bucket
with nothing pointing at it. Proposal attachments are the main source: every
signed-in user can sign up to `RATE_LIMIT_PROPOSAL_ATTACHMENTS_CAPACITY` uploads
per period.

Nothing in the API deletes these today. **Do not add an age-based expiry
rule (`mc ilm rule add --expire-days …`) on `proposals/` or `media/`**:
lifecycle rules match by prefix and age only, so they cannot tell a
referenced object from an orphan and would delete the attachments of live
proposals.

To expire orphans with a lifecycle rule alone, uploads would have to land
under a staging prefix, for example `proposals/pending/`, with a rule such
as "expire objects under `proposals/pending/` after 1 day". Proposal create
would then copy each object to its final key. This needs code changes in
`MediaUploadService` and `ProposalService` and is not implemented yet
(follow-up).

Until then, orphans can be listed and removed by hand with the root
credentials (`mc ls --recursive local/ceitba-media/proposals/` inside
`ceitba-minio`). Take the keys under `proposals/` that are not
`proposals/legacy/`, whose last-modified time is older than a day, and that
are not in:

```sql
SELECT object_key FROM public.proposal_attachment;
```

The volume is bounded by the per-user signing quota.

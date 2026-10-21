# Deploying the API without downtime

The API runs as two Docker Compose services, `ceitba-api-blue` and `ceitba-api-green`, with one shared definition
(`x-api: &api` in `apps/api/docker-compose.yml`). Normally only one of them runs. A deploy starts the other one, waits
until it is healthy and only then stops the old one, so the API keeps answering while the new color boots and
applies pending migrations (`src/db/migrate.ts`, Flyway-compatible).

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Two colors | `apps/api/docker-compose.yml` | Same image (`${API_IMAGE:-ghcr.io/ceitba/ceitba-api:latest}`) and env. No `container_name` and no published port (two can't share either): Caddy reaches them by service name over the `ceitba-proxy` network. Docker health check every 5s on the aggregate `/api/actuator/health` (includes the database: the deploy's gate), `stop_grace_period: 90s` |
| Caddy | `infra/caddy/Caddyfile` (snippet `api_upstreams`) | `ceitba-api-blue:8080 ceitba-api-green:8080` with `lb_policy first` and active health checks on **readiness** (`/api/actuator/health/readiness`, every 2s, 2s timeout). Traffic goes to the first ready color; a request that can't reach an upstream is retried for up to 15s (`lb_try_duration`). A color that isn't running doesn't resolve and counts as down (Caddy logs a failed check every 2s for it: expected). Readiness rather than the aggregate: a database or disk problem shared by both colors must not take the whole API out of rotation (requests then fail fast, as before) |
| Private entrance | `infra/caddy/Caddyfile` (`http://:8081`) | The same upstreams for services on `ceitba-proxy` (the MCP server: `CEITBA_API_URL=http://ceitba-caddy:8081/api`). Not published on the host. Passes the caller's `X-Forwarded-For` through, so the API still keys rate limits on the MCP user's IP |
| Caddy reload | `infra/caddy/docker-compose.yml`, `deploy.yml` | `~/infra` is bind-mounted as a directory at `/etc/caddy`, so a new Caddyfile is visible in the container and the deploy runs `caddy reload` (no restart). An invalid file is refused and the running config stays |
| Deploy script | `infra/scripts/deploy-api.sh` (copied to `~/CEITBA-API/deploy-api.sh`) | Picks the idle color, pulls and starts it, waits for `healthy` (timeout 300s), waits 6s for Caddy's checks, stops the old color. If the new one never gets healthy, crashes (any restart counts) or times out, it is stopped, the old one keeps serving and the job fails |
| Drain | `src/main.ts` | On SIGTERM the server switches readiness to refusing traffic (`/actuator/health/readiness` → 503), keeps serving for `SHUTDOWN_DRAIN` (5s in compose), then stops gracefully (requests in flight finish, then the jobs and the task executor), so Caddy has moved traffic away before the listener closes |
| Job locks | `src/jobs/joblock.ts` | Every scheduled job runs once per tick in one process, while two colors (or a Java and a Bun process, during the cutover or a rollback) are up. See below |

### The deploy, step by step

`deploy.yml` (`api-deploy` job) copies `infra/caddy/{docker-compose.yml,Caddyfile}` to `~/infra/` and
`apps/api/docker-compose.yml` + `infra/scripts/deploy-api.sh` to `~/CEITBA-API/`, then on the VPS:

1. `docker compose config -q` in `~/CEITBA-API` (fails early on a missing `.env` variable).
2. `docker compose up -d` in `~/infra` (Caddy), then `caddy reload` (a no-op when the Caddyfile didn't change).
3. `bash deploy-api.sh` in `~/CEITBA-API`:
   1. the running color is the old one (both running, after an interrupted deploy: the healthy one keeps serving
      and the other is redeployed, or the newer one if both or neither are healthy; none running: blue);
   2. `docker compose up -d` of every other service (postgres, MinIO, minio-init, embeddings), then `pull` and
      `up -d --no-deps` of the new color;
   3. poll its Docker state every 2s until `healthy`; on `unhealthy`, a restart (crash loop: the restart policy
      resets health to `starting`), exit or timeout: print its logs, stop it, exit 1;
   4. sleep `CADDY_SETTLE` (6s, more than Caddy's interval + timeout), then `docker compose stop` the old color
      (drain 5s, then graceful shutdown: requests in flight and the digest email being sent finish).
4. `docker image prune -f`.

Pushing to `main` with an API change runs this. To redeploy by hand (e.g. after changing `~/CEITBA-API/.env`), run
`cd ~/CEITBA-API && bash deploy-api.sh`: it recreates the idle color with the new env. **Do not** run a bare
`docker compose up -d` there: it starts both colors (harmless thanks to the locks, but the next deploy then stops
the newer one) and never waits for health.

Operating on the running API: `docker compose ps` shows which color is up; logs and shell go through the service
name, e.g. `docker compose logs -f ceitba-api-blue`, `docker compose exec ceitba-api-green sh`. From the host the
API is reachable only through Caddy (`curl https://ceitba.org.ar/api/actuator/health`, or from a container on
`ceitba-proxy`, `http://ceitba-caddy:8081/api/...`); there is no `127.0.0.1:8080` on the VPS any more.

Memory: each color has `limits: 1G` (`API_MEMORY_LIMIT`, 256M reserved); the Bun server idles at ~100 MB. During
a deploy both colors run for ~10–20s.

### Local development

`apps/api/docker-compose.override.yml` (loaded automatically, never copied to the VPS) publishes blue on
`127.0.0.1:8080` and puts green in the `green` profile, so `docker compose up -d` starts postgres, MinIO and blue as
before. The deploy script uses `COMPOSE_FILE=docker-compose.yml` alone.

Rehearsal used for this design: the stack plus a Caddy with the real Caddyfile on the `ceitba-proxy` network, a load
loop of GETs and POSTs through Caddy (~100 req/s), and repeated `PULL=0 bash infra/scripts/deploy-api.sh` runs
(legacy → blue, then blue ↔ green with fresh containers and a rebuilt image, a deploy whose new color can't start,
and a deploy with both colors up). Result: no 502/503/504, no request slower than 0.7s with the drain in place.

## Scheduled jobs

While two colors run, every scheduled job (a feature's `jobs.ts`, `src/jobs/scheduler.ts`) fires in both.
`JobLock.runExclusively(job, task)`:

1. opens a dedicated connection, outside the pool (a long job doesn't pin a connection web requests need), and
   takes `pg_try_advisory_lock(NAMESPACE, job.id)` on it. If another session holds it, the run is skipped: runs
   never overlap;
2. under that lock, claims the job's row in `public.scheduled_job_run` (V63): if another run *started* less than
   `MIN_GAP` (30s) ago, this one is skipped. This is what stops the other color from repeating the same cron tick
   after the first one already finished (the lock alone would let it run again);
3. runs the task, unlocks and closes the connection. If the process dies, Postgres ends the session and frees the
   lock.

Skips are logged at INFO; the next tick tries again. 30s is shorter than every job's period (the shortest is 1
minute).

`test/jobs/joblock-coverage.test.ts` fails when a job (including ones that are off by default) has no `lock` or
explicit exemption, so a new job can't silently run twice. A new job gets a new id in `JOBS`
(`src/jobs/joblock.ts`).

`NAMESPACE` is `0x43454954` ("CEIT"). The ids and the `scheduled_job_run` row shape are the ones the Java app used,
so a Java and a Bun process exclude each other (`test/jobs/joblock-cross-runtime.test.ts`): never reuse or renumber
one. The job names (`DataSyncJob#run`, ...) are the old `@Scheduled` methods' names, kept as stable ids.

| Id | Job | Name (registered in) | Own claim/lease besides the lock |
|---|---|---|---|
| 1 | `DATA_SYNC` | `DataSyncJob#run` (`src/features/sync/jobs.ts`) | none |
| 2 | `EVENT_REMINDERS` | `EventReminderJob#run` (`src/features/news/jobs.ts`) | `claimReminder` per event |
| 3 | `MAIL_RETENTION` | `MailRetentionJob#run` (`src/features/mail/jobs.ts`) | none (idempotent deletes) |
| 4 | `KB_RELATIONS` | `KbRelationJob#run` (`src/features/kb-reader/jobs.ts`; also a startup hook) | none |
| 5 | `KB_EMBEDDINGS` | `KbEmbeddingJob#run` (`src/features/kb-reader/jobs.ts`) | revision re-check on write |
| 6 | `DIGEST_SCHEDULE` | `DigestJob#createWeeklyDraft` (`src/features/digest/jobs.ts`) | skips a week that already has a draft (check, then insert) |
| 7 | `DIGEST_TICK` | `DigestJob#tick` (`src/features/digest/jobs.ts`) | delivery claims |
| 8 | *(retired)* | `OrgMailJob#tick` (`src/features/orgmail/jobs.ts`) is exempt: it only hands off to the sender | delivery claims (`FOR UPDATE SKIP LOCKED`) |
| 9 | `DRIVE_SYNC` | `DriveSyncJob#run` (`src/features/drive/jobs.ts`) | none |
| 10 | `KB_PIPELINE_BATCHES` | `KbPipelineJob#pollBatches` (`src/features/kb-pipeline/jobs.ts`) | run lease (`V37__kb_run_lease`) |
| 11 | `KB_PIPELINE_POLL` | `KbPipelineJob#sweep` | run lease |
| 12 | `KB_PIPELINE_SCHEDULE` | `KbPipelineJob#tick` | run lease |

The lock covers the scheduled entry point. Work it hands to the task executor (digest and org-mail senders, wiki
pipeline runs) is protected by those claims and leases, which also cover the startup kicks.

Each running job holds one extra Postgres connection (not from the pool) for its lock.

## Migrations: expand/contract

While both colors run, the **old image runs against the new schema** (the new color has already migrated). Nothing
re-validates the schema after boot, so the old color keeps running against a changed schema until a query hits it.
Hence:

- **Expand** (same release as the code that uses it): new tables, new nullable columns (or with a default), new
  indexes, new enum values the old code ignores.
- **Contract** (a later release, once no deployed code reads or writes it): `DROP` of tables or columns, `RENAME`,
  `NOT NULL` on an existing column, type changes. A rename is *add new → copy/backfill → switch code → drop old*
  across releases.
- A migration must not hold long locks on hot tables (e.g. `CREATE INDEX CONCURRENTLY` in its own non-transactional
  migration for big tables): the old color is serving while it runs.

The rule is also in `AGENTS.md` and `apps/api/AGENTS.md`; the `flyway-migration` skill applies it.

## Migrations: the runner

`src/db/migrate.ts` is a Flyway-compatible runner: it reads and writes the same `public.flyway_schema_history`
rows Flyway 10 did (CRC32 checksums over the file's lines, versions compared per segment, one transaction per
migration, Flyway's advisory lock), so the Java app and the Bun server can take turns on one database. The SQL
files still live where Flyway's classpath had them, `src/main/resources/db/migration` (prod) and
`src/test/resources/db/test-migration` (test mirrors): merged migrations are never renamed
(`scripts/checks/migrations.mjs`), and the history stores only file names. The server migrates on boot
(`SPRING_FLYWAY_ENABLED`, default on; the prod profile adds baseline-on-migrate at version 1).

```
bun src/db/migrate.ts info       # applied + pending, against DATABASE_URL
bun src/db/migrate.ts validate   # read-only: checksum/description mismatches, failed rows, pending
bun src/db/migrate.ts migrate
```

## Cutover from the Java image (one time)

The release that switched the API from Spring Boot to Bun (`docs/adr/0004-api-runs-on-bun.md`) ships no
migration. Its deploy is a normal blue/green deploy: the Bun image comes up as the idle color next to the running
Java color, on the same database. During the overlap both serve:

- sessions, JWTs and refresh tokens issued by either work on the other (same HS256 secret, claims and cookie;
  `contract/tests/cross-signing.contract.test.ts`, `contract/tests/cross-runtime.contract.test.ts`);
- jobs take the same advisory locks and `scheduled_job_run` claims (`test/jobs/joblock-cross-runtime.test.ts`);
- the Bun runner validates the Java-written history (0 pending, no checksum issue) before serving.

Before merging the cutover, run `bun src/db/migrate.ts validate` against production (read-only) with the prod
`DATABASE_URL`: it must report no issue and no pending migration.

## Rollback

Every `main` build is pushed to GHCR as `ghcr.io/ceitba/ceitba-api:main-<short sha>` (plus `main` and `latest`;
`deploy.yml`, `docker/metadata-action`). Tags are kept until someone deletes them. To go back to an earlier image,
including the last Java one:

1. Find the tag. Only pushes that change the API build an image, so not every `main` commit has one: the last
   Java image is the newest `main-*` tag created before the cutover merge on the package page
   (github.com/orgs/ceitba/packages/container/package/ceitba-api; when this was written, `main-b515215`).
   `docker run --rm --entrypoint sh ghcr.io/ceitba/ceitba-api:main-<sha> -c 'command -v java'` prints a path
   for a Java image.
2. In `~/CEITBA-API/.env` set `API_IMAGE=ghcr.io/ceitba/ceitba-api:main-<sha>`. For a **Java** image also set
   its JVM values (the compose defaults are sized for Bun):
   ```
   API_MEMORY_LIMIT=2G
   API_MEMORY_RESERVATION=1G
   API_HEALTH_START_PERIOD=180s
   JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError
   ```
3. `cd ~/CEITBA-API && bash deploy-api.sh`. The usual blue/green deploy brings the pinned image up next to the
   current one and switches when it is healthy.

This is safe against the Java image because sessions, JWTs and refresh tokens are compatible in both directions
and the cutover release ships no migration (the Java app's Flyway validates the same history). After a release
that adds a migration, rolling back past it means the old image runs against the newer schema, which
expand/contract keeps working, and the Java app's Flyway starts on a history with versions it does not know
(Flyway's default `ignore-migration-patterns` is `*:future`); check its logs.

A deploy from `main` uses whatever `API_IMAGE` says, so remove the pin (and the JVM values) once the fix is on
`main`, or the next deploy redeploys the pinned image.

## First deploy after switching to blue/green (one time)

The Caddyfile keeps the pre-blue/green `ceitba-api` container as a third, last upstream, through a loopback adapter
site (`127.0.0.1:8082`) that answers its readiness check with the old container's `/actuator/health` (it has no
probes): while blue boots next to the old container, Caddy keeps serving from it. The script treats a running
`ceitba-api` as the old color, then stops and removes it. The legacy Java container has no `JobLock`, so a job firing during
that overlap can run twice (this deploy only). Also on this deploy only, Caddy's container is recreated once (its
volume changes from the single Caddyfile to the directory): a ~1–2s cut of the whole site.

The MCP server deploys after the API in the same push, now pointed at `ceitba-caddy:8081`. **Before merging**, update
or remove `CEITBA_API_URL` in `~/CEITBA-MCP/.env` if it still says `http://ceitba-api:8080/api` (the old example
value): that name stops resolving once the old container is removed.

Next release (contract): remove the `127.0.0.1:8082` upstream and its site from the Caddyfile.

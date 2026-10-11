# Deploying the API without downtime

The API runs as two Docker Compose services, `ceitba-api-blue` and `ceitba-api-green`, with one shared definition
(`x-api: &api` in `apps/api/docker-compose.yml`). Normally only one of them runs. A deploy starts the other one, waits
until it is healthy and only then stops the old one, so the API keeps answering while Spring boots and Flyway
migrates.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Two colors | `apps/api/docker-compose.yml` | Same image and env. No `container_name` and no published port (two can't share either): Caddy reaches them by service name over the `ceitba-proxy` network. Health check every 5s (`/api/actuator/health`), `stop_grace_period: 90s` |
| Caddy | `infra/caddy/Caddyfile` | `reverse_proxy ceitba-api-blue:8080 ceitba-api-green:8080` with `lb_policy first` and active health checks (`health_uri /api/actuator/health`, every 2s, 2s timeout). Traffic goes to the first healthy color; a request that can't reach an upstream is retried for up to 15s (`lb_try_duration`). A color that isn't running doesn't resolve and counts as down (Caddy logs a failed check every 2s for it: expected) |
| Caddy reload | `infra/caddy/docker-compose.yml`, `deploy.yml` | `~/infra` is bind-mounted as a directory at `/etc/caddy`, so a new Caddyfile is visible in the container and the deploy runs `caddy reload` (no restart). An invalid file is refused and the running config stays |
| Deploy script | `infra/scripts/deploy-api.sh` (copied to `~/CEITBA-API/deploy-api.sh`) | Picks the idle color, pulls and starts it, waits for `healthy` (timeout 300s), waits 6s for Caddy's checks, stops the old color. If the new one never gets healthy it is stopped, the old one keeps serving and the job fails |
| Drain | `config/ShutdownDrain` | On SIGTERM the instance reports DOWN on `/actuator/health` and keeps serving for `SHUTDOWN_DRAIN` (5s in compose) before Tomcat's graceful shutdown, so Caddy has moved traffic away before the connector closes |
| Job locks | `scheduling/JobLock` | Every `@Scheduled` job runs under a Postgres advisory lock, so it runs once while two colors (or the API and another process) are up. See below |

### The deploy, step by step

`deploy.yml` (`api-deploy` job) copies `infra/caddy/{docker-compose.yml,Caddyfile}` to `~/infra/` and
`apps/api/docker-compose.yml` + `infra/scripts/deploy-api.sh` to `~/CEITBA-API/`, then on the VPS:

1. `docker compose config -q` in `~/CEITBA-API` (fails early on a missing `.env` variable).
2. `docker compose up -d` in `~/infra` (Caddy), then `caddy reload` (a no-op when the Caddyfile didn't change).
3. `bash deploy-api.sh` in `~/CEITBA-API`:
   1. the running color is the old one (both running, after an interrupted deploy: the newer keeps serving and the
      older is redeployed; none running: blue);
   2. `docker compose up -d` of every other service (postgres, MinIO, minio-init, embeddings), then `pull` and
      `up -d --no-deps` of the new color;
   3. poll its Docker health status every 2s until `healthy`; on `unhealthy`, exit or timeout: print its logs,
      stop it, exit 1;
   4. sleep `CADDY_SETTLE` (6s, more than Caddy's interval + timeout), then `docker compose stop` the old color
      (drain 5s, then graceful shutdown: requests in flight and the digest email being sent finish).
4. `docker image prune -f`.

Pushing to `main` with an API change runs this. To redeploy by hand (e.g. after changing `~/CEITBA-API/.env`), run
`cd ~/CEITBA-API && bash deploy-api.sh`: it recreates the idle color with the new env. **Do not** run a bare
`docker compose up -d` there: it starts both colors (harmless thanks to the locks, but the next deploy then stops
the newer one) and never waits for health.

Operating on the running API: `docker compose ps` shows which color is up; logs and shell go through the service
name, e.g. `docker compose logs -f ceitba-api-blue`, `docker compose exec ceitba-api-green sh`. From the host the
API is reachable only through Caddy (`curl https://ceitba.org.ar/api/actuator/health`); there is no
`127.0.0.1:8080` on the VPS any more.

Memory: during a deploy both colors run for ~20–60s, each with `limits: 2G` (heap 75%).

### Local development

`apps/api/docker-compose.override.yml` (loaded automatically, never copied to the VPS) publishes blue on
`127.0.0.1:8080` and puts green in the `green` profile, so `docker compose up -d` starts postgres, MinIO and blue as
before. The deploy script uses `COMPOSE_FILE=docker-compose.yml` alone.

Rehearsal used for this design: the stack plus a Caddy with the real Caddyfile on the `ceitba-proxy` network, a load
loop of GETs and POSTs through Caddy (~100 req/s), and repeated `PULL=0 bash infra/scripts/deploy-api.sh` runs
(legacy → blue, then blue ↔ green with fresh containers and a rebuilt image, a deploy whose new color can't start,
and a deploy with both colors up). Result: no 502/503/504, no request slower than 0.7s with the drain in place.

## Scheduled jobs

While two colors run, every `@Scheduled` method would fire in both. `JobLock.runExclusively(job, task)` takes
`pg_try_advisory_lock(NAMESPACE, job.id)` on a dedicated pool connection, runs the task, and unlocks on the same
connection (a session-level lock is held by the connection that took it; if unlocking fails, the connection is
evicted rather than returned to the pool). If another session holds the lock the run is skipped and logged; the next
tick tries again. If the process dies, Postgres ends the session and frees the lock.

`NAMESPACE` is `0x43454954` ("CEIT"). Ids are stable and shared with any other process that runs these jobs (e.g. a
Bun worker during a migration): never reuse or renumber one.

| Id | Job | Method | Own claim/lease besides the lock |
|---|---|---|---|
| 1 | `DATA_SYNC` | `DataSyncJob.run` | none |
| 2 | `EVENT_REMINDERS` | `EventReminderJob.run` | `claimReminder` per event |
| 3 | `MAIL_RETENTION` | `MailRetentionJob.run` | none (idempotent deletes) |
| 4 | `KB_RELATIONS` | `KbRelationJob.run` (also on `ApplicationReadyEvent`) | none |
| 5 | `KB_EMBEDDINGS` | `KbEmbeddingJob.run` | revision re-check on write |
| 6 | `DIGEST_SCHEDULE` | `DigestJob.createWeeklyDraft` | skips a week that already has a draft (check, then insert) |
| 7 | `DIGEST_TICK` | `DigestJob.tick` | delivery claims (`DigestDeliveryRepository`) |
| 8 | `ORG_MAIL` | `OrgMailJob.tick` | delivery claims |
| 9 | `DRIVE_SYNC` | `DriveSyncJob.run` | in-process flag |
| 10 | `KB_PIPELINE_BATCHES` | `KbPipelineJob.pollBatches` | run lease (`V37__kb_run_lease`) |
| 11 | `KB_PIPELINE_POLL` | `KbPipelineJob.sweep` | run lease |
| 12 | `KB_PIPELINE_SCHEDULE` | `KbPipelineJob.tick` | run lease |

The lock covers the scheduled entry point. Work it hands to the task executor (digest and org-mail senders, wiki
pipeline runs) is protected by those claims and leases, which also cover the `ApplicationReadyEvent` kicks.

Each running job holds one extra pool connection (`DB_POOL_SIZE`, default 20) for its lock; the long ones (Drive
sync, data sync, embeddings, the pipeline tick) rarely overlap.

## Migrations: expand/contract

While both colors run, the **old jar runs against the new schema** (the new color has already run Flyway). Hibernate
validates the schema only at boot, so the old jar keeps running against a changed schema until a query hits it.
From now on:

- **Expand** (same release as the code that uses it): new tables, new nullable columns (or with a default), new
  indexes, new enum values the old code ignores.
- **Contract** (a later release, once no deployed code reads or writes it): `DROP` of tables or columns, `RENAME`,
  `NOT NULL` on an existing column, type changes. A rename is *add new → copy/backfill → switch code → drop old*
  across releases.
- A migration must not hold long locks on hot tables (e.g. `CREATE INDEX CONCURRENTLY` in its own non-transactional
  migration for big tables): the old color is serving while it runs.

The rule is also in `AGENTS.md` and `apps/api/AGENTS.md`; the `flyway-migration` skill applies it.

## First deploy after switching to blue/green (one time)

The Caddyfile keeps the pre-blue/green `ceitba-api:8080` as a third, last upstream: while blue boots next to the old
`ceitba-api` container, Caddy keeps serving from the old one. The script treats a running `ceitba-api` as the old
color, then stops and removes it. Also on this deploy only, Caddy's container is recreated once (its volume changes
from the single Caddyfile to the directory): a ~1–2s cut of the whole site. Remove `ceitba-api:8080` from the
Caddyfile in the next release.

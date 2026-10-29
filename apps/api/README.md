# CEITBA API

REST API for ITBA student and club data: careers, plans, subjects, classrooms, commissions, the newsletter
(articles, events, organizations), Apuntes (Drive sync), subject wikis, the weekly digest, push notifications and
the wiki layer (bookmarks, notes, comments, edit proposals). It backs the web app, the MCP server and the mobile
app, and integrates with the ITBA backend.

**Stack**: Bun, Hono (routing), zod (request validation), Drizzle over `postgres` (Postgres 16 + pgvector), `jose`
(JWTs), `croner` (jobs), `pino` (logs). The schema is plain SQL migrations applied by a Flyway-compatible runner.
The API was a Spring Boot app until 2026; the Bun port kept every route, status code, JSON byte, cookie and job
(`docs/adr/0004-api-runs-on-bun.md` at the repo root).

## Quick start (Docker)

```sh
cd apps/api
cp .env.example .env             # edit values, especially AUTH_JWT_SECRET, AUTH_SYNC_API_KEY, MINIO_ROOT_*, STORAGE_*
docker compose up -d --build     # postgres + minio (+ one-shot minio-init) + ceitba-api-blue on :8080 (docker-compose.override.yml)
curl http://localhost:8080/api/actuator/health
```

The image builds from the repo root (`Dockerfile` here, context `../..`), since it installs from the workspace's
`bun.lock`. Swagger UI: http://localhost:8080/api/docs · OpenAPI: http://localhost:8080/api/docs.json

## Local dev (host Bun)

`bun install` at the repo root installs every workspace, this one included.

```sh
docker compose up -d postgres         # just the database
bun --env-file=.env src/main.ts       # the app on :8080 (or: bun run dev, with --watch)
```

## Tests

```sh
bun run build                         # tsc (the typecheck; there is no emit)
bun run test                          # unit + in-process tests (test/); the DB ones start pgvector with Testcontainers
bun contract/run.ts                   # the contract suite: black-box tests against a real server (contract/tests/)
bun contract/run.ts career auth       # only the files whose name contains "career" or "auth"
bun contract/coverage.ts              # every OpenAPI operation: has a handler? hit by a contract test?
```

Docker is needed unless `CONTRACT_PG_URL=postgres://user:pass@host:port/postgres` points at a Postgres with
pgvector. Each contract test file boots its own server on a fresh clone of a migrated template database; see
`AGENTS.md` for how to write one.

## Configuration

All config flows through env vars, parsed in `src/config/sections/*.ts`; see [`.env.example`](.env.example). The
names are the ones the Spring Boot app used (including `SPRING_PROFILES_ACTIVE`, which still selects `prod` / `dev`
behaviour). Highlights:

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `jdbc:postgresql://localhost:5432/ceitba_db` | `jdbc:postgresql://` or `postgres://` URL; credentials from `POSTGRES_USER`/`POSTGRES_PASSWORD` when not in the URL |
| `AUTH_JWT_SECRET` | _(required)_ | HS256 key of the API's own JWTs (`openssl rand -base64 32`) |
| `AUTH_ALLOWED_DOMAINS` | `itba.edu.ar` | Comma-separated email domains admitted after authentication |
| `AUTH_ALLOWED_EMAILS` | _(empty)_ | Comma-separated explicit email allowlist (for accounts not on an allowed domain) |
| `AUTH_SYNC_API_KEY` | _(empty)_ | Required value for the `X-API-Key` header on `/api/v1/sync/**` |
| `SYNC_ENABLED` | `false` | Toggle the twice-daily data-sync job |
| `ITBA_API_BASE_URL` / `ITBA_API_TOKEN` | _(empty)_ | ITBA backend connection |
| `ITBA_API_USE_FAKE` | `false` | Use the fake ITBA client (no network) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_SERVICE_ACCOUNT_PATH` | _(empty)_ | FCM service account for push notifications; empty = pushes disabled. See [`docs/PUSH-NOTIFICATIONS.md`](docs/PUSH-NOTIFICATIONS.md) |
| `MAIL_ENABLED` / `MAIL_*` / `DIGEST_*` | `false` / see doc | Email and the weekly digest "La semana en ITBA"; `MAIL_ENABLED=false` refuses sends. See [`docs/WEEKLY-DIGEST.md`](docs/WEEKLY-DIGEST.md) |
| `REVIEWS_DIRECTORY_USE_FAKE` | `false` | Subject reviews name professors from a fixed fake directory instead of Google's (dev, tests). See [`docs/SUBJECT-REVIEWS.md`](docs/SUBJECT-REVIEWS.md) |
| `CONTENT_HMAC_SECRET` | _(empty)_ | Root secret for keyed hashes: proposal attachment keys, imported comment ids, article-vote fingerprints and analytics IP hashes; empty = derived from `AUTH_JWT_SECRET` |
| `STORAGE_*` | _(empty)_ | S3-compatible bucket for presigned uploads (self-hosted MinIO in prod, served at `https://ceitba.org.ar/ceitba-media`); any empty connection value disables uploads. `R2_*` still work as fallbacks. See [`docs/OBJECT-STORAGE.md`](docs/OBJECT-STORAGE.md) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | _(required by compose)_ | MinIO admin credentials, used only by the `minio-init` container; the API uses the `STORAGE_ACCESS_KEY_ID` service user |
| `API_IMAGE`, `API_MEMORY_*`, `API_HEALTH_START_PERIOD` | see `docker-compose.yml` | The image both colors run and their limits; the rollback knobs ([`docs/DEPLOY.md`](docs/DEPLOY.md) "Rollback") |

## Auth

Roles are `Anonymous`, `USER`, `STAFF` and `SYNC` (machine). The full guide, including how to bootstrap the first
STAFF member, assign and revoke roles and add authorized users, is [`docs/AUTH-AND-ROLES.md`](docs/AUTH-AND-ROLES.md);
the Google and token setup is [`docs/AUTH-SETUP.md`](docs/AUTH-SETUP.md).

- The API issues its **own** HS256 JWTs after a Google sign-in: the web app gets one in an HttpOnly cookie via the
  server-side OAuth flow (`GET /v1/auth/google`); the mobile app exchanges a Google ID token at
  `POST /v1/auth/google/mobile` for an access + rotating refresh token pair. Google tokens are never accepted as
  bearer tokens.
- `src/http/security.ts` validates the JWT (bearer or cookie) and the `X-Api-Key`; `src/http/auth/policy.ts` holds
  every URL rule and per-route role rule; the email allowlist (`AUTH_ALLOWED_DOMAINS` ∪ `AUTH_ALLOWED_EMAILS`) is
  enforced after authentication, and `ROLE_STAFF` comes from an active `ceitba_staff` row.
- `User` rows are JIT-provisioned (no signup endpoint). The first `STAFF` member is bootstrapped via SQL; see the
  guide.

## Endpoints

| Path | Method | Auth |
|---|---|---|
| `/api`, `/api/health`, `/api/actuator/health` | GET | public |
| `/api/v1/careers/**` | GET | public |
| `/api/v1/subjects/**`, `/api/v1/plans/**` | GET | public |
| `/api/v1/classrooms/**` | GET | public |
| `/api/v1/classrooms/conflicts` | POST | public |
| `/api/v1/commissions?plan=` | GET | public |
| `/api/v1/articles/**`, `/api/v1/news/events/**`, `/api/v1/organizations/**` | GET | public (writes: org members or `ROLE_STAFF`) |
| `/api/v1/highlights` | GET | public |
| `/api/v1/highlights/all` | GET | JWT + `ROLE_STAFF` |
| `/api/v1/highlights`, `/api/v1/highlights/{id}` | POST, PUT, DELETE | JWT + `ROLE_STAFF` |
| `/api/v1/benefits`, `/api/v1/benefit-cards` | GET | public (writes: `ROLE_STAFF`) |
| `/api/v1/users/**` | GET, POST `/create`, PATCH `/{id}/file-number` | JWT + `ROLE_STAFF` |
| `/api/v1/wiki/bookmarks/{id}` | GET | public |
| `/api/v1/wiki/bookmarks/{id}` | POST/PUT/DELETE | JWT |
| `/api/v1/staff/**` | GET, POST, DELETE | JWT + `ROLE_STAFF` |
| `/api/v1/sync/**` | POST | `X-API-Key` |

Full list in `/api/docs`. `/api/docs.json` serves `src/http/openapi.json`, the springdoc document of the Spring
app (paths, operationIds, parameters, component schemas), kept in sync by hand: `test/http/openapi.test.ts` fails
when a route and the document disagree, and `bun contract/coverage.ts --check` checks every operation has a handler
and a contract test.

## Database

- Migrations are SQL files in `src/main/resources/db/migration/` (the path Flyway's classpath used; merged
  migrations are never moved or edited). `src/db/migrate.ts` is the only thing that changes the schema: a
  Flyway-compatible runner that keeps `flyway_schema_history` exactly as Flyway did. The server migrates on boot.
- `src/db/schema/*.ts` is the Drizzle mapping, generated from a migrated database
  (`bun run db:schema`; never edit it by hand).
- Two schemas: `public` (academic, identity, newsletter, mail) and `wiki` (notes, comments, bookmarks, proposals,
  Apuntes, subject wikis).

To rebuild the local DB from scratch:

```sh
docker compose down -v && docker compose up -d postgres
bun --env-file=.env src/db/migrate.ts migrate     # or just start the app
./scripts/dev-seed.sh                             # optional: fake users, newsletter content, scheduler data
```

## Deployment (VPS)

Pushes to `main` that change the API run `.github/workflows/deploy.yml`: tests, then the image
`ghcr.io/ceitba/ceitba-api` (tags `main-<sha>`, `main`, `latest`), then `api-deploy`, which copies
`docker-compose.yml` and `infra/scripts/deploy-api.sh` to `~/CEITBA-API/` and `infra/caddy/{docker-compose.yml,Caddyfile}`
to `~/infra/` (never `.env`), checks that `~/CEITBA-API/.env` satisfies the compose file, reloads Caddy and runs
`deploy-api.sh`: a blue/green switch with no downtime (the new color must be healthy before the old one stops).
Caddy serves `https://ceitba.org.ar`, proxies `/api/*` to the healthy API color and `/ceitba-media/*` to MinIO over
the `ceitba-proxy` network. Postgres (5432) and the MinIO console (9001) are published on `127.0.0.1` only; the API
has no host port. Details, job locks, expand/contract migrations and the rollback to an earlier image:
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Conventions for contributors

[`AGENTS.md`](AGENTS.md) has the rules (layers, transactions, errors, migrations, jobs, tests). Short version:

1. One folder per feature in `src/features/<area>/`: `routes.ts` → `service.ts` → `repo.ts`, one way. Rows never
   leave the service; routes return DTOs.
2. Transactions with `withTx` (`{ readOnly: true }` for reads).
3. Throw the domain errors of `src/http/errors.ts` (or a feature's own `CodedError`); the app maps them to HTTP.
4. Schema changes go in a new `V<n>__<desc>.sql` migration (`flyway-migration` skill). **Never edit a migration that
   has merged.**
5. Calls to the ITBA backend go through `src/external/itba*`.
6. Every behaviour change comes with a test: a contract test for anything visible over HTTP.

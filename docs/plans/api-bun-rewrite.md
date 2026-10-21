# Plan: rewrite `apps/api` from Spring Boot to Bun

| | |
|---|---|
| Status | Approved direction, not started |
| Owner | Ian Dalton |
| Strategy | Big-bang: one cutover release |
| Stack | Bun + Hono + Drizzle + zod; schema stays SQL-first |
| Estimate | 10–13 weeks, one developer with agent help |
| Next step | ADR + spec issue (`docs/agents/workflow.md`: the change touches auth, spans apps and moves schema ownership) |

## 1. Goal and non-goals

**Goal.** Replace the Spring Boot API (`apps/api`) with a Bun/TypeScript service that is externally
indistinguishable from it. That means the same routes, status codes, JSON shapes, cookies, tokens, jobs and side
effects, so that `apps/web`, `apps/mcp`, CEITBApp and the Caddy routes keep working unchanged.

**Non-goals.**
- No API redesign, no route renames, and no "while we're at it" fixes. Behaviour changes wait until after
  cutover.
- No schema changes during the rewrite: the cutover release ships no migration.
- No changes to clients, except the generated OpenAPI URL if it moves.

**Why the end state is worth it** (for the ADR):
- One language and toolchain across web, MCP, `scheduler-core` and API.
- Shared zod types between API and clients.
- No Maven/JDK in CI or locally. This also removes the local JDK-26/Mockito workaround.
- Faster startup for blue/green deploys.

## 2. Current system inventory

| Item | Size |
|---|---|
| Main code | 796 Java files, ~59k LOC |
| Tests | 211 files, ~29.5k LOC: 84 integration (`*IT`), 112 unit (`*Test`) |
| Endpoints | 297 mappings |
| Schema | 64 Flyway migrations; `public` + `wiki` schemas; pgvector |
| Scheduled jobs | 9, each wrapped in `JobLock` |
| Config | ~167 env vars (`application*.yml`) |
| Resources | KB prompts (`resources/kb/prompts`), `proposals/alias-words.json` |

Endpoints per area:

| Area | Endpoints | ITs |
|---|---|---|
| kb | 57 | 7 |
| news | 33 | 12 |
| user | 27 | 5 |
| drive | 25 | 1 |
| staff | 22 | 5 |
| digest | 16 | 2 |
| proposal | 15 | 3 |
| orgmail | 12 | 2 |
| auth | 12 | 12 |
| studygroup / correction / capability | 8 each | 1 / 2 / 1 |
| career / plan / sync / mail | 7 / 6 / 6 / 6 | 2 / 2 / 3 / 2 |
| wiki / share / highlight / classroom | 5 each | 2 / – / 1 / 2 |
| subject, health, analytics, media, commission, app | 1–2 each | 1–3 each |

Jobs: `DataSyncJob`, `DigestJob`, `DriveSyncJob`, `EventReminderJob`, `KbEmbeddingJob`, `KbPipelineJob`,
`KbRelationJob`, `MailRetentionJob`, `OrgMailJob`.

External integrations:

| Integration | Java today | Bun replacement (to verify in the spikes) |
|---|---|---|
| Google OAuth (web + mobile audiences) | Spring Security + custom exchange | `fetch` + `jose` |
| JWT HS256 issue/verify | Spring OAuth2 resource server | `jose` |
| ITBA academic gateway | `RestClientItbaApiClient` + fake | `fetch` client + fake |
| Google Drive | google-api-services-drive | `googleapis` (Drive v3) |
| Firebase push + Firestore import | firebase-admin, google-cloud-firestore | `firebase-admin` (Node), gRPC risk |
| S3 / MinIO | AWS SDK v2 | `Bun.s3` or `@aws-sdk/client-s3` |
| SMTP | spring-boot-starter-mail | `nodemailer` |
| LLM chat/batch (DigitalOcean) + embeddings (OpenAI-compatible) | custom `Do*Client`s | `fetch` clients + fakes |
| PDF text extraction | pdfbox | `unpdf` / pdf.js |
| HTML parsing/sanitizing | jsoup | `linkedom` + `sanitize-html` |
| Rate limiting | bucket4j | in-memory token bucket (single process per color) |
| Caches | caffeine | `lru-cache` |
| OpenAPI UI (`/api/docs`) | springdoc | `@hono/zod-openapi` + Scalar/Swagger UI |

Consumers that must not notice the switch:
- `apps/web`: session cookie.
- `apps/mcp`: scoped API keys and OAuth.
- **CEITBApp**: separate repo; mobile access/refresh tokens with reuse grace.
- The Caddy link-preview route: `GET /v1/articles/{id}/preview`.
- The blue/green health check.

## 3. Why the Java tests can't validate the rewrite directly

The ITs run inside Spring:
- They call the app through `MockMvc`, with no real HTTP.
- They fake auth with `SecurityMockMvcRequestPostProcessors.jwt()`/`user()`, so no real token is validated.
- They seed data through injected JPA repositories.

The unit tests mock Java classes with Mockito. No Java test can be pointed at a Bun process.

They are still the most precise description of the behaviour, so the plan is to **re-express them first as
black-box HTTP tests, and make those green against the Java server** (phase 1). That suite then becomes the
acceptance gate for the Bun service.

## 4. Target architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun, version from the root `packageManager` | Same as the rest of the repo |
| HTTP | Hono | Bun-native, typed routing and middleware, OpenAPI from zod; portable to Node if ever needed |
| Validation / DTOs | zod | Already used in `apps/mcp`; one schema gives validation, types and OpenAPI |
| DB access | Drizzle ORM over `postgres` (porsager) | Typed SQL, no hidden behaviour, introspects the existing schema, raw SQL for pgvector |
| Migrations | Existing Flyway SQL files, unchanged | Prod schema stays untouched and rollback stays safe (§9) |
| Jobs | `croner` + ported `JobLock` | Same lock table and ids, so a job never runs twice across colors |
| Logging | `pino` | Structured logs |
| Tests | `bun test` + Postgres (Testcontainers-node locally, service container in CI) | Same runner as the rest of the repo |

### Layout (`apps/api-ts`, renamed to `apps/api` after cutover)

```
apps/api-ts/
  src/
    main.ts                 # boot: config, db, http, jobs, graceful shutdown
    config.ts               # zod-parsed env, same names and defaults as application.yml
    http/
      app.ts                # Hono app, middleware order, route mounting under /api
      errors.ts             # domain errors → {error, message} + status (GlobalExceptionHandler)
      auth/                 # cookie/bearer resolver, api-key middleware, staff lookup, allowlist
      ratelimit.ts
    features/<area>/        # one folder per Java feature package
      routes.ts             # web/ layer: zod request/response schemas, no business logic
      service.ts            # service/ layer: business logic, transactions
      repo.ts               # repository/ layer: Drizzle queries
    db/
      schema/               # Drizzle tables (introspected, then hand-checked)
      client.ts             # pool, transaction helper, readOnly transactions
    external/               # itba, drive, llm, firebase, storage, mail: interface + real + fake
    jobs/                   # one file per job + joblock.ts
  test/                     # unit tests per module
  contract/                 # black-box HTTP suite (phase 1) + diff runner
    openapi.json            # route inventory exported from Java
```

### Rules carried over from `apps/api/AGENTS.md`
- One-way layering: `routes → service → repo → db`. Database rows never leave `service`, and routes return
  zod-shaped DTOs.
- Domain errors only; one mapper turns them into HTTP responses.
- Every upstream ITBA call goes through `external/itba`.
- `TIME` columns are read and written as strings (`HH:mm:ss`) and never converted to `Date`. This is the same
  bug class as the `hibernate.jdbc.time_zone` guard; port `LocalTemporalZoneIT`.
- Every scheduled job runs through `JobLock.runExclusively` with its existing id.

## 5. Phases

### Phase 0: freeze and inventory (≈2 days)
Tasks:
- Announce a feature freeze on `apps/api`.
  - Bug fixes are still allowed. Each one lands in Java with a contract test, and the same PR or a linked
    issue tracks the TS port.
- Export `/v3/api-docs` from the running Java app to `contract/openapi.json` (now `src/http/openapi.json`, served as `/api/docs.json`).
  - A script lists every route, and CI fails when a route has no TS handler and no contract test.
- Write `contract/COMPATIBILITY.md`. It must cover:
  - cookie name and attributes (`AUTH_COOKIE_*`, default `ceitba_session`, `Lax`, `Secure`, path `/`);
  - JWT claims, issuer/audience enforcement and TTLs;
  - mobile access/refresh TTLs and the reuse grace window;
  - every `error` code and its status;
  - Jackson output: `LocalDate`, `LocalTime` and `Instant` formats, nulls vs absent fields, enum casing,
    pagination shape, numeric precision;
  - CORS headers;
  - rate-limit headers and 429 body.
- Copy the env var list into `config.ts` stubs with the same defaults.

Exit: frozen, route inventory committed, compatibility doc reviewed.

### Phase 1: contract suite, green against Java (≈1.5–2 weeks). Critical path
Tasks:
- Build `contract/` helpers:
  - `server(url)`: base URL, from `API_URL`.
  - `mintJwt({email, staff, ttl})`: HS256 with `AUTH_JWT_SECRET`, the same `iss`/`aud` as production.
  - `cookieSession(...)`, `apiKey(...)`, `syncKey()`.
  - `seed.sql` fixtures plus a `db` helper that truncates and seeds per file, replacing repository-based seeding.
  - Fake-mode env for every external dependency (`*_USE_FAKE`).
- Port all 84 ITs area by area, keeping each test's name for traceability.
  - Auth (12) and news (12) go first, because they cover the most cross-cutting behaviour.
- Add tests the Java suite lacks but the rewrite needs:
  - a token minted by Java verifies in TS, and the reverse;
  - jobs don't double-fire across two processes;
  - full response-shape snapshots for the 20 most-used routes.
- Build the **diff runner**: it replays a request corpus (contract requests plus sampled prod access logs) against
  Java and TS on the same seeded DB, and diffs the JSON, ignoring generated ids and timestamps.
- CI job `api-contract`: builds the Java jar and runs the suite against it on every PR touching `apps/api*`.

Exit: 100% of the suite green against Java in CI; the diff runner works Java-vs-Java (zero diffs).

### Phase 2: dependency spikes (≈1 week, in parallel with phase 1)
Each spike is a throwaway script against real or staging credentials, with a written yes/no:

| Spike | Pass condition |
|---|---|
| `firebase-admin` on Bun | Sends an FCM push; reads a Firestore export |
| `googleapis` Drive | Lists and downloads a real Apuntes folder within quota |
| PDF extraction | `unpdf` text matches pdfbox output on 20 real Apuntes PDFs (normalised whitespace) |
| HTML sanitizing | Output matches `DocHtmlSanitizer`/`GoogleDocsHtml` on 20 real Docs exports |
| pgvector via Drizzle/raw SQL | KB similarity query returns the same top-k as Java |
| SMTP via nodemailer | Sends through the production relay settings |
| LLM batch | Creates, polls and parses a batch with the existing prompts |

A failing spike gets a fallback before phase 4 reaches that area: another library, a Node subprocess, or a
small sidecar.

### Phase 3: foundation (≈1 week)
Tasks:
- `config.ts`: all ~167 env vars, zod-validated, failing fast at boot like Spring does.
- DB client:
  - Drizzle schema introspected from a migrated DB, hand-checked against the entities.
  - `withTx(fn, {readOnly})` helper.
  - Pool size from `DB_POOL_SIZE`.
- Error middleware and the domain error classes.
- Auth, matching Java byte for byte:
  - cookie/bearer resolver (`CookieOrHeaderBearerTokenResolver`);
  - `ApiKeyFilter` semantics: `ceitba_` user keys, scoped keys for MCP, static `AUTH_SYNC_API_KEY` → SYNC;
  - per-request STAFF lookup;
  - email allowlist (`AUTH_ALLOWED_DOMAINS` ∪ `AUTH_ALLOWED_EMAILS`);
  - Google OAuth code exchange and redirect validation;
  - mobile token and refresh endpoints;
  - dev login (`AUTH_DEV_LOGIN_ENABLED`);
  - JIT user provisioning;
  - logout.
- CORS, rate limiting, health endpoint at the path the blue/green deploy checks.
- `JobLock` port and the scheduler bootstrap; jobs are registered but stay disabled until their area is ported.
- Graceful shutdown: drain HTTP, stop jobs, release locks.
- Dockerfile on `oven/bun`, with the same port and health check.

Exit: auth, health and error contract tests green against TS.

### Phase 4: port the features (≈5–7 weeks)
Order goes by dependency and risk. Each step is one PR into a long-lived `feat/api-bun` branch.

| # | Areas | Jobs | Notes |
|---|---|---|---|
| 1 | career, plan, subject, classroom, commission, sync | `DataSyncJob` | Read-heavy; ITBA client + fake |
| 2 | user, staff, capability, app, analytics, highlight, media, ratelimit | – | Media → S3 |
| 3 | news, digest | `DigestJob`, `EventReminderJob` | Open Graph preview page, HMAC tokens (`CONTENT_HMAC_SECRET`), SMTP |
| 4 | share, correction, studygroup, proposal, wiki | – | Proposal alias generator + Firestore importer |
| 5 | mail, orgmail | `OrgMailJob`, `MailRetentionJob` | Encrypted mail tokens (`MAIL_TOKEN_ENCRYPTION_KEY`), daily/weekly limits |
| 6 | drive | `DriveSyncJob` | Budgets/depth limits, sanitizer |
| 7 | kb | `KbPipelineJob`, `KbEmbeddingJob`, `KbRelationJob` | 57 endpoints, chunker, embeddings, LLM batch, cost/token budgets, prompts |

An area is done when:
- its contract tests are green against TS;
- the diff runner shows zero unexplained diffs for its routes;
- its Java unit tests are ported as `bun test` unit tests of the matching TS module (chunker, alias generator,
  sanitizer, LLM output parser, quota tracker, date/ICS logic…);
- its jobs run once under two concurrent processes.

### Phase 5: hardening and shadow run (≈1 week)
Tasks:
- Deploy TS to staging next to Java on a fresh prod DB snapshot, with all external dependencies in fake or
  sandbox mode except read-only ones.
- Replay a day of production read traffic against both and diff. Write traffic only goes through the contract
  suite.
- Load test the 10 hottest routes; p95 must not regress against Java.
- Run CEITBApp (production build) against staging: login, refresh, the main screens.
- Security review (`security-reviewer` agent) of auth, API keys, CORS, redirects and uploads.

Exit: zero unexplained diffs, the mobile app verified, the security review clean.

### Phase 6: cutover (≈1–2 days, then a week of watch)
Steps:
1. The release contains only the TS service, with no migration.
2. Merge `feat/api-bun` → `dev` → `main`. The blue/green deploy brings up the TS image as the new color, health
   checks it and switches Caddy.
3. Smoke test:
   - web login and the main pages;
   - MCP tools (`whoami`, `list_careers`, a write tool on a test record);
   - mobile login and refresh;
   - WhatsApp preview;
   - each job's next tick logged exactly once.
4. **Rollback**: redeploy the last Java image tag (kept for 30 days). Sessions survive in both directions
   because the JWT and cookie are compatible.
5. After a quiet week:
   - delete the Java code, Maven CI jobs and Java-only tooling;
   - rename `apps/api-ts` → `apps/api`;
   - decide whether to keep Flyway or switch to a TS migration runner (§7).

## 6. Testing strategy summary

| Layer | Source | Runs against |
|---|---|---|
| Contract (black-box HTTP) | Ported from the 84 ITs + new compatibility tests | Java (phase 1), then TS |
| Diff runner | Contract requests + sampled prod logs | Java and TS side by side |
| Unit | Ported from the 112 `*Test` files | TS modules |
| Spikes | Phase 2 scripts | Real or sandbox services |
| Shadow | Replayed prod reads | Staging TS vs staging Java |

## 7. Migrations

- During the rewrite and at cutover, the schema is owned by Flyway, unchanged. The TS image either runs the
  Flyway CLI as an init step, or the deploy keeps running Flyway the way it does today.
- Drizzle never generates DDL. Its schema is introspected and checked in CI against a migrated DB, which
  replaces Hibernate's `validate` mode.
- After cutover, optionally replace Flyway with a small runner. It would apply `V65+__*.sql` and write
  `flyway_schema_history` rows with compatible checksums. Expand/contract stays the rule either way.
- `db/test-migration` and the test-mirror rule move with the migrations; the `migration-reviewer` agent is
  updated accordingly.

## 8. Repo changes

- **Workspace**: add `apps/api-ts` to the root `package.json` workspaces; `bun run test` includes it.
- **CI**:
  - `ci.yml` gets `api-contract` (phase 1, against Java), then a TS build, unit tests and contract tests.
  - `deploy.yml` builds the Bun image.
  - `dorny/paths-filter` gets the new paths.
  - Both stacks run in CI until the Java code is deleted.
- **Docs, rewritten for TS**:
  - `apps/api/AGENTS.md`;
  - `AUTH-AND-ROLES.md`, `AUTH-SETUP.md`, `DEPLOY.md`;
  - the feature docs, wherever they reference Java classes;
  - `docs/agents/spec-map.json` paths;
  - the root `AGENTS.md` table and commands.
- **Agent tooling**:
  - update the `api-endpoint` and `flyway-migration` skills;
  - update `.agents/agents/api-architecture-reviewer.md` and `migration-reviewer.md`, then
    `node scripts/agents/sync.mjs`.
- **ADR** `docs/adr/0004-api-runs-on-bun.md`: context, stack choice, SQL-first schema, big-bang trade-off.
- **Glossary**: no domain terms change.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| ~3 months without API features | Product stalls; pressure to break the freeze | Explicit freeze; bug fixes mirrored with a contract test; re-plan at the checkpoints in §10 |
| Silent JSON/date drift | Web, MCP or mobile break in subtle ways | Compatibility doc, response snapshots, diff runner, shadow replay |
| Sessions or tokens invalidated at cutover | Every user logged out; mobile refresh fails | Byte-compatible JWT/cookie; cross-signing contract tests; mobile verified in phase 5 |
| `LocalTime` / timezone bugs | Class and event times shift by 3h | `TIME` as strings; ported `LocalTemporalZoneIT`; `America/Argentina/Buenos_Aires` only where Java uses it |
| Jobs double-fire or never fire | Duplicate digests/emails, stale data | Same `JobLock` table and ids; two-process test; post-cutover tick check |
| Google/Firebase libs misbehave on Bun | Push, Firestore import or Drive sync broken | Phase 2 spikes before phase 4 reaches those areas; sidecar fallback |
| KB pipeline cost regressions | Unexpected LLM spend | Keep budgets and quota tracker semantics; run in fake mode until the parity tests pass |
| Rewrite branch drifts from `dev` | Painful merge | Freeze; weekly merge of `dev` into `feat/api-bun`; area PRs reviewed as they land |
| Size underestimated | Timeline slips | Checkpoints in §10 with an explicit go/no-go |

## 10. Timeline and checkpoints

| Week | Milestone |
|---|---|
| 0 | ADR + spec issue approved; freeze starts |
| 1–2 | Phase 0 done; phase 1 at ≥50%; phase 2 spikes done |
| 3 | **Checkpoint A**: contract suite green against Java, spikes resolved. Go/no-go on the stack and the timeline |
| 4 | Phase 3 foundation done |
| 5–6 | Phase 4 areas 1–3 done. **Checkpoint B**: re-estimate from actual velocity; if it is more than 1.5× the plan, consider switching to a per-area cutover through Caddy, which reuses all the work done so far |
| 7–10 | Phase 4 areas 4–7 done |
| 11 | Phase 5 shadow run |
| 12 | Phase 6 cutover; week 13 watch, then Java deletion |

## 11. Open decisions

1. Whether to keep Flyway after cutover, or replace it with a TS runner (§7).
2. Where the Java image lives for rollback, and for how long (proposed: 30 days in `ghcr.io`).
3. Whether the freeze allows small API features if they come with contract tests and a TS port in the same PR.

# apps/api: agent rules

The CEITBA API: Bun, Hono (routing), zod 4 (`jv.*` DTO schemas), Drizzle over `postgres` (porsager), `jose`,
`croner`, `pino`, Postgres 16 + pgvector. A workspace package (`@ceitba/api`); `bun.lock` is written by bun only,
so add a dependency with `bun add` (exact version) from this directory. `README.md` covers setup and env; the
feature docs (the living specs of the API) are in `docs/`, and `docs/agents/spec-map.json` at the repo root says
which doc covers which path. It was a Spring Boot app until 2026 (`docs/adr/0004-api-runs-on-bun.md`); its
observable behaviour (routes, status codes, JSON bytes, headers, cookies, JWTs, error bodies, jobs) was kept
exactly, so web, MCP and mobile clients never changed. Keep it that way: a visible change is a deliberate,
documented one. `contract/COMPATIBILITY.md` lists what clients depend on (cookies, JWTs, error codes, CORS, rate
limits, health) with the test that holds each, and the intentional differences from Java.

## Commands (from `apps/api`)

```
bun run build                         # tsc (must pass)
bun run test                          # unit + in-process tests (test/); DB tests need Docker or CONTRACT_PG_URL
bun contract/run.ts [fragment...]     # contract suite against a real server (contract/tests/)
bun contract/coverage.ts [--list|--check]   # OpenAPI operations: handler? contract test?
bun src/main.ts                       # run the server (env: AUTH_JWT_SECRET, DATABASE_URL, ...; .env is loaded)
bun src/db/migrate.ts info|validate|migrate   # Flyway-compatible migrations against DATABASE_URL
docker compose up -d                  # postgres + minio + api; health: /api/actuator/health, Swagger: /api/docs
```

Docker is needed for tests unless `CONTRACT_PG_URL=postgres://user:pass@host:port/postgres` points at a Postgres with
pgvector (`pgvector/pgvector:0.8.6-pg16-bookworm`). Copy `.env.example` to `.env`; `AUTH_JWT_SECRET` is required,
`ITBA_API_USE_FAKE=true` avoids the upstream ITBA API.

## Rules

Layering, one way, per feature (`src/features/<area>/`):

```
routes.ts (HTTP: params, body, status)  ->  service.ts (logic, transactions)  ->  repo.ts (drizzle)  ->  src/db/schema (tables)
```

- Rows never leave `service.ts`; routes return DTOs (`dto.ts`: request schemas + response interfaces, key order =
  JSON order).
- Reads run in `withTx(db, fn, { readOnly: true })`, writes in `withTx(db, fn)`.
- Throw domain errors (`src/http/errors.ts`, or a feature's own `CodedError` subclass with a `reason`), never a
  hand-built error `Response`; the app maps them to HTTP, and the error body (`error`, `message`, `path`,
  `timestamp`) keeps that shape. A new error class needs its mapping covered in `test/http/errors.test.ts`.
- All calls to the upstream ITBA system go through `deps.itba` (`src/external/itba*`); other HTTP goes through the
  clients in `src/external/*` / `src/infra/*`, never an ad-hoc `fetch` in a service.
- Add an interface only when there is a second implementation or a test fake.
- Business time comes from `deps.clock` (America/Argentina/Buenos_Aires): `clock.now()` / `clock.today()`, never
  `Date.now()` / `new Date()`, so tests can move time.
- Service constructors do no I/O (routes are registered without a database for coverage and OpenAPI).

Auth: read `docs/AUTH-AND-ROLES.md` and `docs/AUTH-SETUP.md` before touching `src/http/security.ts`,
`src/http/auth/*` or `src/features/auth/*`. Roles are `Anonymous`, `USER`, `STAFF`, `SYNC`. The API issues its own
HS256 JWTs after a server-side Google OAuth code exchange (web: HttpOnly cookie; mobile: access + rotating refresh
token). Every route is authenticated + allowlisted unless `src/http/auth/policy.ts` says otherwise: a new public,
STAFF, MODERATOR or SYNC route needs its rule there (see "Reference: authorization"). User API keys (`ceitba_`,
`X-Api-Key`) carry scopes `read`/`report`/`events`/`write`/`staff`/`keys` (`docs/AUTH-SETUP.md` § Scopes). Code that grants
the caller staff or moderator powers asks `staffPowers(c)` (`src/http/auth/context.ts`), never the
`ceitba_staff`/moderator tables directly: it withholds them from a key without `staff`.

Database: the SQL migrations in `src/main/resources/db/migration/` (prod) and
`src/test/resources/db/test-migration/` (test mirrors; the directories are Flyway's old classpath, kept because
merged migrations never move) are the only schema tool, applied on boot by `src/db/migrate.ts`. Two schemas,
`public` and `wiki`. Never edit a migration that has merged; add one with the `flyway-migration` skill (it also
handles the test mirror and `IT_FLYWAY_TARGET`), then regenerate `src/db/schema/` with `bun run db:schema` (never
edit it by hand). Migrations are **expand/contract**: two API colors overlap during a deploy, so the old image runs
against the new schema. Add tables, nullable/defaulted columns and indexes together with the code; `DROP`,
`RENAME`, `NOT NULL` on existing columns and type changes go one release later (`docs/DEPLOY.md`). `TIME` columns
are strings end to end (`formatPgTime`); never convert class or event times through a `Date`
(`contract/tests/local-temporal-zone.contract.test.ts`). The wiki embeddings live in `wiki.kb_page_chunk`
(pgvector, `docs/SUBJECT-WIKI.md` "Embeddings"), computed by the self-hosted `ceitba-embeddings` compose
service; only raw SQL touches the vector column.

Jobs: every scheduled job runs under `JobLock` with a new, never-reused id (see "Reference: jobs").

Tests: every behaviour change or bug fix comes with a test that fails without it; anything visible over HTTP gets
a contract test. Prefer the existing fakes (`test/kb/support/inMemoryRepo.ts`, `MutableClock`,
`InMemoryObjectStorage`, `FakePushGateway`, `InMemoryMailLedger`) over mocks. Behaviour changes update the
mapped doc in `docs/` in the same PR (`spec-sync` skill).

## Reference: the worked example, `src/features/career`

Four short files. Read them before writing a feature of your own.

### dto.ts: request schemas and response shapes

```ts
export const CreateCareerRequest = jv.object({
  id: jv.string({ notBlank: true, size: { max: 25 } }),
  name: jv.string({ notBlank: true, size: { max: 255 } }),
});
export type CreateCareerRequest = NonNullable<z.output<typeof CreateCareerRequest>>;   // { id: string|null; name: string|null }

export interface CareerResponse { id: string; name: string; plans: string[] }        // key order = JSON order
```

`jv` (src/http/validation.ts) keeps the validation semantics and messages clients already parse (the Bean
Validation rules the API had: Java-style `trim()` for `notBlank`, the `email` regexes, messages in the **request
locale**: `Accept-Language: es-AR` gives `no debe estar vacío`, no header gives `en_US`, all automatic;
`contract/tests/validation-locale`): `notNull`, `notBlank`, `notEmpty`, `size: {min,max}`, `min`, `max`,
`positive`, `positiveOrZero`, `pattern: {regexp, js?}` (pass `js` when the regex uses syntax beyond
`(?i)`/`\s`/`\S`), `email`, `check: (v) => message|null` (custom validators, literal messages); types `string`,
`int`, `long`, `double`, `bool({primitive})`, `uuid`, `enum([...])`, `instant` (ISO date-time input, gives
micros), `localDate`, `localTime`, `list(item, {size})`, `object(shape)`, `map(value)`, `json()`. Fields are
nullable; a non-nullable scalar (`staff: boolean`, `page: int` defaulting to false/0) is `{ primitive: true }`. A
nested object is `jv.object(...)` inside.

### repo.ts: drizzle, no business logic

```ts
export function findAllCareers(db: Db): Promise<CareerRow[]> {
  return db.select().from(careers).orderBy(asc(careers.id));
}
export async function insertCareer(db: Db, id: string, name: string, now: Micros) {
  const [row] = await db.insert(careers).values({ id, name, updatedAt: toPgTimestamp(now) }).returning();
  return row!;                                                    // updated_at: set it yourself
}
```

- Take `db: Db` (pool or transaction) as the first argument.
- Sort in SQL (`ORDER BY` in the DB collation), never in JS: list orders are part of the contract.
- Inserts set **every** column: set nullable columns to `null` explicitly rather than relying on a column DEFAULT
  where existing rows were written NULL (`user.preferred_language` stays NULL, not `'es'`).
- `created_at` / `updated_at`: write `toPgTimestamp(systemNowMicros())` yourself.
- Timestamps come back as Postgres text (`mode: 'string'`): format them in the service/DTO with
  `src/lib/time.ts` (see docs/SERIALIZATION.md). Never `new Date(row.col)` for business values.
- Raw SQL (pgvector, CTEs): `db.execute(sql\`...\`)` with drizzle's `sql` template (parameters are bound).

### service.ts: transactions and domain errors

```ts
getAllCareers(): Promise<CareerResponse[]> {
  return withTx(this.deps.db, async (tx) => (await repo.findAllCareers(tx)).map(...), { readOnly: true });
}
async create(req: CreateCareerRequest): Promise<CareerResponse> {
  try {
    return await withTx(this.deps.db, async (tx) => {
      if (await repo.careerExists(tx, req.id!)) throw new ResourceAlreadyExistsError('Career', req.id);
      ...
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ResourceAlreadyExistsError('Career', req.id);   // lost an insert race
    throw e;
  }
}
```

- `withTx(db, fn, { readOnly })` opens a transaction; a nested call with a `Tx` joins it; pass `deps.db` (the
  pool) for an independent one.
- An error that must not roll back the work: drizzle rolls back on throw, so return the error from the
  transaction and throw it after commit (see `AuthService.rotate`).
- Throw the classes in `src/http/errors.ts` (status/code/message format per class; every mapping is covered by
  `test/http/errors.test.ts`). A feature error with a `reason` enum (`DriveError`, digest, KB pipeline, org mail,
  RSVP, study group, schedule correction errors) is a `CodedError` subclass in the feature, with each reason's
  status/code (and headers like `Retry-After`).
- Postgres errors of SQLSTATE class 22/23 that escape are mapped to `409 DataIntegrityViolation` by the app
  (`deleteCareerWithPlansReturns409` relies on it).
- "Now": business time (what tests move with a `MutableClock`: due dates, windows, "today") is
  `deps.clock.now()` (micros) / `deps.clock.today()` (ART); row timestamps (`created_at`, `updated_at`, audit
  instants) are `systemNowMicros()` (src/lib/time.ts). Follow what the feature already does.
- Reuse the pure helpers: `src/lib/javaCompat.ts` (Java-compatible trim/strip/split/URL encode/UUID/hashCode/
  LocalDate math, so outputs stay byte-identical to what clients already store), `src/lib/javaUri.ts`,
  `src/lib/beanConstraints.ts`, and `src/features/<area>/logic/*`.
- pgvector queries that need iterative scans: `withIterativeScan(deps.db, (tx) => ...)` (src/db/client.ts;
  the SETs are transaction-local; it also forces custom plans, so a cached generic plan never skips the HNSW index).
- Service constructors must not do I/O (the contract harness and coverage register routes without a DB).

### routes.ts: the controller

```ts
export default defineRoutes((r, deps) => {
  const svc = new CareerService(deps);
  r.get('/v1/careers/{id}', { tags, params: { id: param.string() } }, ({ params }) => svc.getCareerById(params.id!));
  r.post('/v1/careers', { tags, body: CreateCareerRequest, status: 201 }, ({ body }) => svc.create(body));
  r.delete('/v1/careers/{id}', { params: { id: param.string() }, status: 204 }, async ({ params }) => { await svc.delete(params.id!); });
});
```

- The path is the full mapping (`/v1/...`, `{var}`, `{var:regex}`); `/api` is added for you.
  Literal routes beat variable ones whatever the registration order.
- Spec fields: `params`/`query` (`param.uuid()`, `param.int({ def: 0 })`, `param.string({ required: false })`,
  with the API's conversion-error and "Required request parameter" messages), `body` (+ `bodyOptional` for
  an optional body, `bodyValidation: 'bindOnly'` to bind without validating, `rawBody` for a raw string body),
  `currentUser: true` (the caller, JIT-provisioned), `produces: 'text/html'` (Spring's `produces`: an Accept
  without it is a 406 before binding; other routes ignore Accept), `argOrder` when the order of argument checks decides which
  400/403 wins, `status`, `summary`/`tags`/`hidden` (OpenAPI), `maxBodyBytes` (bodies are capped at 1 MiB, 413
  `PayloadTooLarge` beyond; raise it only for bulk routes, `src/http/body.ts`).
- Return a value (serialized as JSON with `status`), `undefined`/`null` (empty body), or a `Response` from the
  helpers: `json(body, status, headers)`, `noContent(headers)`, `found(location, headers)`, `emptyStatus(404)`.
- The caller: `await currentUser(c)` (JIT-provisions the user row), `await optionalUser(c)` (null when
  anonymous on a public route), `staffPowers(c).isStaff(id)` / `.isModerator(id)` (false for an API key without
  the `staff` scope), `apiKeyCredential(c)` (the API key in use, if any), `principal(c)`.
  Import from `src/http/auth/context.ts`.
- Per-user quotas: `deps.userRateLimiter.consume('proposals', user.id)`.
- Cookies: `src/http/auth/cookies.ts` (`sessionCookie`, `clearSessionCookies`, `formatCookie`); read one with
  `readCookie(c.req.header('cookie'), name)`.
- Headers: `c.req.header('x-name')`. The caller's IP (forwarded-for aware; vote dedup, analytics, tracking):
  `c.get('state').clientIp`. The raw request URI: `c.get('state').requestUri`.
- HTML, images, streams, redirects: return a `Response` (a `ReadableStream` body for streams). Bun adds a
  `Content-Type` to string/byte bodies; set the exact one the route documents.
- Paged responses are feature DTOs (`{data, meta: {total, page, limit}}` etc.); reuse the area's own.

## Reference: authorization

`src/http/auth/policy.ts` holds every URL rule (`URL_RULES`, first match wins) **and every per-route role rule**
(`METHOD_RULES`, keyed `"POST /v1/careers"` exactly as the OpenAPI path). You do not write `if (!staff) throw`:
the router applies the rule for your route after binding the arguments. A route with no `METHOD_RULES` entry
runs with only its URL rule, so a STAFF/moderator route **must** add its key (the policy test,
`test/http/policy-coverage.test.ts`, checks every key is a real route and that the rules match the frozen
snapshot `test/fixtures/java-security-policy.json`; refresh the snapshot in the same PR when you change a rule
on purpose).

Rules that call feature logic (`@orgAccess.canEditOrg(#slug, authentication)` ...) are named checks. The
feature that owns them registers the implementation in its `routes.ts`:

```ts
deps.accessChecks.register('orgAccess.canEditOrg', async ({ deps, principal }, slug) => ...);
```

Arguments arrive in rule order (`path.<var>` / `body.<field>` of the validated body). An unregistered check
answers 500 and logs which name is missing. A change to `policy.ts` is a security change: run the
`security-reviewer` subagent on it.

What the chain does before your handler (src/http/security.ts): security headers, CORS, per-IP rate limits
(`rate-limit.rules`), the `X-Api-Key` filter (user keys + scopes, the sync key), the bearer/cookie JWT
(401 with RFC 6750 `WWW-Authenticate` descriptions), the URL rules (401 empty body for anonymous, 403 empty
body otherwise). 404 `No static resource ...` / 405 + `Allow` / 415 / 400 / 500 bodies come from the app.

## Reference: config

All config is env vars, parsed in `src/config/sections/*.ts` (names and defaults are the Spring app's, including
`SPRING_PROFILES_ACTIVE` for `prod`/`dev`): `server`, `db`, `auth`, `rateLimit`, `integrations` (itba, sync,
mobileApp, push, storage), `kb`, `content` (driveSync, mail, orgMail, events, digest), `logging`. Read
`deps.config.<section>`. A new env var goes in the section of its area (or a new section file, auto-discovered),
in `.env.example` and, if production needs it, in `docker-compose.yml`. A section file is:

```ts
const schema = z.object({ ... });
declare module '../registry' { interface ConfigSections { myArea: z.infer<typeof schema> } }
export default defineSection('myArea', schema, ({ env, hasProfile }) => ({ x: env.duration('MY_ENV', 'PT5M') }));
```

`env.str(name, def)` reads `NAME` with a default (set-but-empty wins over the default), `env.duration` accepts
`PT5M`/`10m`/`60s`/`60d`/millis (returns ms), `env.list` is comma-separated and trimmed, `env.bool` accepts
true/false/yes/no/on/off/1/0.

## Reference: jobs

`src/features/<area>/jobs.ts`:

```ts
export default defineJobs((deps) => [{
  name: 'DigestJob#createWeeklyDraft',
  lock: 'DIGEST_SCHEDULE',                                   // JobLock.Job: mandatory (JOBS in src/jobs/joblock.ts)
  schedule: { cron: '0 5 0 * * MON', zone: 'America/Argentina/Buenos_Aires' },   // 6-field cron (seconds first)
  enabled: deps.config.content.digest.jobsEnabled,
  run: () => service.createScheduledDraft(),
}]);
```

Schedules: `{ cron, zone? }` (6-field cron; no zone = the process zone, `TZ`), `{ fixedDelayMs,
initialDelayMs }`, `{ fixedRateMs, initialDelayMs }`. **Every job runs under `JobLock`** with its own id: add a
new, never-reused id to `JOBS` in `src/jobs/joblock.ts` (8 is retired; ids are shared with any other process on
the database, `docs/DEPLOY.md` "Scheduled jobs"). A job without a lock needs a stated exemption in
`test/jobs/joblock-coverage.test.ts`, which checks every job. The scheduler waits for running jobs on shutdown.

Lifecycle work returns `{ jobs, startup, shutdown }` instead of an array (`src/jobs/scheduler.ts`):
- `startup: [{ name, order, enabled, run }]`: run one after the other by `order` before readiness turns UP; a
  throw fails the startup.
- `shutdown: [{ name, phase, order, run }]`: `phase: 'closing'` runs first (stop flags, before the drain);
  `'executors'` waits for kicked background workers, after HTTP and the jobs, before the pool closes.

## Reference: serialization

Read `docs/SERIALIZATION.md` before writing a DTO: the JSON is byte-compatible with what the Spring app sent,
and clients depend on it. The rules that bite: `OffsetDateTime` read from the DB prints
`...Z` but one computed in the app prints `...-03:00`; `Instant` prints the fraction in groups of 3, `OffsetDateTime`
strips trailing zeros; `double` fields need `javaDouble()`; `numeric` needs `bigDecimal()`; `TIME` columns go
through `formatPgTime()` (milliseconds, truncated); key order = record order.

## Reference: external services and fakes (`deps`)

| deps | What | Selected by |
|---|---|---|
| `clock` | business "now" (ART) | `SystemClock`; tests `MutableClock` |
| `storage` | object storage (S3/MinIO) | all `STORAGE_*` set -> `S3ObjectStorage`, else `UnconfiguredObjectStorage` (501); tests `InMemoryObjectStorage` |
| `mailTransport` | email transports | `MAIL_ENABLED`, `MAIL_LOG_SENDS`, `MAIL_TRANSPORT`; tests `InMemoryEmailSender` |
| `push` | push gateway | FCM when `FIREBASE_SERVICE_ACCOUNT_JSON/_PATH`, else `null` (no-op); tests `FakePushGateway` |
| `itba` | the ITBA backend client | `ITBA_API_USE_FAKE` -> the fake (+ `ITBA_API_FAKE_FROM_DB`) |
| `drive` | Google Drive client | `DRIVE_SYNC_USE_FAKE` -> `InMemoryDriveClient`, else Unconfigured |
| `llm.batch/chat/catalog/embeddings` | LLM batch/chat, model catalog, embeddings | `KB_LLM_USE_FAKE` / `KB_EMBEDDING_USE_FAKE` -> the fakes, else Unconfigured |
| `google.oauth/idTokens` | Google OAuth code exchange, ID token verification | real; tests `StubGoogleOAuthClient`, `JwksGoogleIdTokenVerifier(auth, localKey)` |
| `userRateLimiter`, `jobLock`, `accessChecks`, `availability`, `log`, `db`, `sql` | | |

### Real integrations

The ITBA client + wire format (`src/external/itba*`), the Google Drive client and the fake's demo content
(`src/external/drive*`), the DigitalOcean/OpenAI clients and fakes (`src/external/llm*`), the Gmail API transport
and the quota ledger (`src/features/mail`; `src/infra/mail.ts` selects the transport), `S3ObjectStorage` and the
FCM push gateway (`src/infra/push.ts`). The FCM, Gmail, Drive and ITBA clients are only exercised against fakes
or stubs in tests.

## Reference: contract tests

Black-box tests against a real server: anything a client can see over HTTP gets one. Most were ported from the
Spring app's `*IT` classes and keep their class and method names (header comment). Worked examples:
`contract/tests/career.contract.test.ts`, `refresh-token.contract.test.ts`.

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedCareer, seedStaff, supports, useServer } from '../support';

const api = useServer({ env: { /* extra config, as env vars */ } });                    // boots per FILE
const hasX = await supports('GET /v1/some/other/feature');                              // skip on ts until it exists

describe('CareerWritesIT', () => {
  beforeEach(async () => { await api.db`DELETE FROM public.plan`; });
  test('staffCanCreate_returns201', async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');                                        // ROLE_STAFF = a real row
    const r = await api.post('/v1/careers', { as: bearer(await mintJwt({ email: 'boss@itba.edu.ar' })), body: { id: 'S', name: 'Sistemas' } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"id":"S","name":"Sistemas","plans":[]}');                       // byte-level where it matters
  });
});
```

- `useServer({ env })` starts a fresh Bun server on a free port, against a fresh clone of the template database
  (`db/migration` + `db/test-migration` up to `IT_FLYWAY_TARGET` in `contract/support/pg.ts`), with the test
  profile's env (`contract/support/env.ts`). Two configs in one file = two `useServer` calls;
  `shareDatabaseWith: () => other` puts a second server on the first one's database. Nothing leaks between files.
- Requests: `api.get/post/put/patch/delete/head/options(path, { as, body, contentType, headers, query, rawPath })`
  -> `{ status, headers, text, json, setCookies, location }`. Paths are without `/api`. `rawPath: true` sends
  the path untouched (encoded-path tests).
- Identities: `bearer(await mintJwt({ email, name, ttlSeconds, iss, aud, claims }))` (the API's own claims,
  test secret), `sessionCookie(token)`, `apiKey(key)` with `seedApiKey(db, userId, scopes|null)`,
  `apiKey(TEST_SYNC_KEY)`. STAFF is a real row: `seedStaff(db, email)`; moderators `seedModerator(db, userId)`.
- Seeding: `api.db` is a postgres.js client on the server's database: `seedUser`, `seedStaff`, `seedCareer`,
  `seedPlan`, `seedRefreshToken`, `truncateUsers`, or plain SQL. Wrap SQL in `async () => { await ... }` inside
  hooks: a bare postgres.js query returned from a hook is never awaited by bun.
- Asserting: status and the IT's jsonPath checks; add byte-level `r.text` checks for shapes you port.
  Never assert the order of several validation violations or of `Allow` (not stable).
- Run it: `bun contract/run.ts <file-fragment>`; the whole suite before a PR (`bun contract/run.ts`).
- In-process tests (fakes, a moved clock, stubbed Google, open transactions): `test/<area>/*.test.ts` with
  `testApp({ env, overrides })` from `test/support/app.ts` (`contract/IN-PROCESS.md` lists the ones ported
  from Spring ITs).
- Unit tests: `test/<area>/*.test.ts` against your `logic/` or service functions.
- `bun contract/coverage.ts --list` shows every OpenAPI operation with its handler and contract hits; a new
  route must be hit by a contract test (`--check` fails otherwise; CI runs it after the contract suite).

## Reference: the OpenAPI document

`/api/docs.json` (Swagger UI at `/api/docs`) serves `src/http/openapi.json` as is, except `servers`: the springdoc
document of the Spring app with its paths, operationIds, typed parameters and component schemas. It is edited by
hand: a new, changed or removed route updates its operation (and any `components.schemas` it references) in the
same PR. `test/http/openapi.test.ts` fails when a registered non-hidden route has no operation, an operation has no
route, or a `$ref` dangles. The `api-endpoint` skill has the checklist.

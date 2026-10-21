# apps/api-ts: agent rules

The Bun/TypeScript rewrite of `apps/api` (plan: `docs/plans/api-bun-rewrite.md`). The goal is a server that is
**externally indistinguishable** from the Spring Boot one: same routes under `/api`, status codes, JSON bytes,
headers, cookies, JWTs, error bodies, jobs and side effects. The Java code is the specification; when this
file and the Java code disagree, the Java code wins and this file is wrong.

Stack: Bun (root `packageManager`), Hono (routing), zod 4 (`jv.*` DTO schemas), Drizzle over `postgres`
(porsager), `jose`, `croner`, `pino`. All dependencies a feature plausibly needs are already installed (S3,
nodemailer, googleapis, firebase-admin, linkedom, sanitize-html, unpdf, lru-cache, bcryptjs): never hand-edit
`bun.lock`; if you need a new package, report it.

## Commands (from `apps/api-ts`)

```
bun run build                         # tsc (must pass)
bun run test                          # bun test ./test  (unit + in-process only; DB tests need Docker or CONTRACT_PG_URL)
bun run test:contract                 # contract suite against TS (default)
bun run test:contract:java            # the same suite against the Java jar (built if missing/stale)
bun contract/run.ts --target both career auth   # both targets, only files matching "career"/"auth"
bun contract/coverage.ts [--list]     # OpenAPI operations: TS handler? contract test?
CONTRACT_RECORD=1 bun contract/run.ts && bun contract/diff.ts   # replay all recorded requests on java + ts, diff
bun src/main.ts                       # run the server (env like the Java app: AUTH_JWT_SECRET, DATABASE_URL, ...)
bun src/db/migrate.ts validate        # Flyway-compatible validation of the configured DB
```

Docker is needed for tests unless `CONTRACT_PG_URL=postgres://user:pass@host:port/postgres` points at a
Postgres with pgvector (`pgvector/pgvector:0.8.6-pg16-bookworm`). The Java target needs JDK 21
(`~/.local/jdk/jdk-21.0.12.1+1/Contents/Home` or `CONTRACT_JAVA_HOME`).

## Layout: what you add and what you never touch

```
src/features/<area>/        YOURS. One folder per Java feature package (career, news, kb, ...)
  routes.ts                 web/ layer: default-export defineRoutes(...). Auto-discovered.
  service.ts                service/ layer: business logic, transactions (withTx)
  repo.ts                   repository/ layer: drizzle queries. Rows never leave service.ts
  dto.ts                    request schemas (jv.*) and response interfaces (record order)
  jobs.ts                   optional: default-export defineJobs(...). Auto-discovered.
  logic/                    optional: pure ported helpers (+ test/<area>/*.test.ts)
src/config/sections/<area>.ts   YOURS when the area has config not in an existing section (auto-discovered)
test/<area>/                YOURS: unit tests + in-process tests
contract/tests/<area>*.contract.test.ts   YOURS: black-box ports of the area's *IT.java

SHARED (do not edit; report what you need):
src/http/**                 app, security chain, router, errors, validation, policy (central!)
src/db/client.ts, migrate.ts, schema/   (schema is generated: scripts/split-schema.ts)
src/lib/**, src/infra/**, src/external/**, src/jobs/**, src/deps.ts, src/main.ts, src/shared/**
contract/support/**, contract/run.ts, coverage.ts, diff.ts, openapi.json
```

Exceptions by agreement: the owning feature ported the real implementations in `src/external/*` and
`src/infra/*` (see "Real integrations" below).

## The worked example: `src/features/career`

`web/career/CareerController.java` + `service/career/CareerService.java` + `repository/CareerRepository.java`
became four files. Read them before writing your own; they are short.

### dto.ts: request schemas and response shapes

```ts
// CreateCareerRequest(@NotBlank @Size(max = 25) String id, @NotBlank @Size(max = 255) String name)
export const CreateCareerRequest = jv.object({
  id: jv.string({ notBlank: true, size: { max: 25 } }),
  name: jv.string({ notBlank: true, size: { max: 255 } }),
});
export type CreateCareerRequest = NonNullable<z.output<typeof CreateCareerRequest>>;   // { id: string|null; name: string|null }

export interface CareerResponse { id: string; name: string; plans: string[] }        // record component order
```

`jv` (src/http/validation.ts) maps Bean Validation one to one (Hibernate Validator 8.0.1 semantics: Java
`trim()` for `@NotBlank`, Hibernate's `@Email` regexes, `@Pattern` with the Java source; messages come from
Hibernate's own bundles in the **request locale**: `Accept-Language: es-AR` gives `no debe estar vacío`, no
header gives the JVM default `en_US`, all automatic; verified by `contract/tests/validation-locale`): `notNull`, `notBlank`, `notEmpty`,
`size: {min,max}`, `min`, `max`, `positive`, `positiveOrZero`, `pattern: {regexp, js?}` (pass `js` when the Java
regex uses syntax beyond `(?i)`/`\s`/`\S`), `email`, `check: (v) => message|null` (custom validators, literal
messages); types `string`, `int`, `long`, `double`, `bool({primitive})`, `uuid`,
`enum([...])`, `instant` (OffsetDateTime/Instant input, gives micros), `localDate`, `localTime`, `list(item,
{size})`, `object(shape)`, `map(value)`, `json()`. Fields are nullable like Java references; a Java primitive
(`boolean staff`, `int page`) is `{ primitive: true }`. A nested `@Valid` record is `jv.object(...)` inside.

### repo.ts: drizzle, no business logic

```ts
export function findAllCareers(db: Db): Promise<CareerRow[]> {
  return db.select().from(careers).orderBy(asc(careers.id));     // careerRepository.findAll(Sort.by("id"))
}
export async function insertCareer(db: Db, id: string, name: string, now: Micros) {
  const [row] = await db.insert(careers).values({ id, name, updatedAt: toPgTimestamp(now) }).returning();
  return row!;                                                    // @UpdateTimestamp: set it yourself
}
```

- Take `db: Db` (pool or transaction) as the first argument.
- Sort in SQL like Spring Data does (`ORDER BY` in the DB collation); no ORDER BY where Java has none.
- Hibernate inserts **every** column: set nullable columns to `null` explicitly when Java leaves them null,
  even if the column has a DEFAULT (`user.preferred_language` stays NULL, not `'es'`).
- `@CreationTimestamp` / `@UpdateTimestamp`: write `toPgTimestamp(clock.now())` yourself.
- Timestamps come back as Postgres text (`mode: 'string'`): format them in the service/DTO with
  `src/lib/time.ts` (see docs/SERIALIZATION.md). Never `new Date(row.col)` for business values.
- Raw SQL (pgvector, CTEs): `db.execute(sql\`...\`)` with drizzle's `sql` template (parameters are bound).

### service.ts: transactions and domain errors

```ts
getAllCareers(): Promise<CareerResponse[]> {                      // @Transactional(readOnly = true)
  return withTx(this.deps.db, async (tx) => (await repo.findAllCareers(tx)).map(...), { readOnly: true });
}
async create(req: CreateCareerRequest): Promise<CareerResponse> {
  try {
    return await withTx(this.deps.db, async (tx) => {
      if (await repo.careerExists(tx, req.id!)) throw new ResourceAlreadyExistsError('Career', req.id);
      ...
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ResourceAlreadyExistsError('Career', req.id);   // catch (DataIntegrityViolationException race)
    throw e;
  }
}
```

- `withTx(db, fn, { readOnly })` = `@Transactional`; a nested call with a `Tx` joins it (REQUIRED); pass
  `deps.db` (the pool) for REQUIRES_NEW.
- `noRollbackFor`: drizzle rolls back on throw, so return the error from the transaction and throw it after
  commit (see `AuthService.rotate`).
- Throw the classes in `src/http/errors.ts` (one per Java exception, same status/code/message format; every
  GlobalExceptionHandler mapping is covered by `test/http/errors.test.ts`).
  Feature exceptions with a `reason` enum (DriveException, DigestException, KbPipelineException,
  OrgMailException, EventRsvpException, StudyGroupConflictException, ScheduleCorrectionException) are yours:
  `class DriveError extends CodedError` in your feature with each reason's status/code (and headers like
  `Retry-After`).
- Postgres errors of SQLSTATE class 22/23 that escape are mapped to `409 DataIntegrityViolation` by the app,
  like Spring/Hibernate (`deleteCareerWithPlansReturns409` relies on it).
- "Now": use `deps.clock.now()` (micros) / `deps.clock.today()` (ART) exactly where Java uses the injected
  `Clock` (`LocalDate.now(clock)`, `OffsetDateTime.now(clock)`), and `systemNowMicros()` (src/lib/time.ts) where
  Java uses `Instant.now()` / `OffsetDateTime.now()` / `@CreationTimestamp` / `@UpdateTimestamp`. Tests that move
  a `MutableClock` must only move what Java's clock moves.
- Reuse the pure helpers already ported: `src/lib/javaCompat.ts` (Java trim/strip/split/URL encode/UUID/
  hashCode/LocalDate math), `src/lib/javaUri.ts` (`java.net.URI`), `src/lib/beanConstraints.ts`, and
  `src/features/<area>/logic/*` for your area. Do not re-port them.
- pgvector queries that need iterative scans: `withIterativeScan(deps.db, (tx) => ...)` (src/db/client.ts;
  the SET is transaction-local).
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

- The path is the Java mapping, verbatim (`/v1/...`, `{var}`, `{var:regex}`); `/api` is added for you.
  Literal routes beat variable ones whatever the registration order (Spring specificity).
- Spec fields: `params`/`query` (`param.uuid()`, `param.int({ def: 0 })`, `param.string({ required: false })`:
  Spring's conversion errors and "Required request parameter" messages), `body` (+ `bodyOptional` for
  `required = false`, `bodyValidation: 'bindOnly'` when the Java parameter has no `@Valid`, `rawBody` for
  `@RequestBody String`), `currentUser: true` (`@CurrentUser User`), `argOrder` when the Java parameter order
  decides which 400/403 wins, `status` (`@ResponseStatus`), `summary`/`tags`/`hidden` (OpenAPI).
- Return a value (serialized as JSON with `status`), `undefined`/`null` (empty body), or a `Response` from the
  helpers: `json(body, status, headers)`, `noContent(headers)`, `found(location, headers)`, `emptyStatus(404)`.
- The caller: `await currentUser(c)` (JIT-provisions like `@CurrentUser`), `await optionalUser(c)` (null when
  anonymous on a public route), `staffPowers(c).isStaff(id)` / `.isModerator(id)` (= `StaffPowers`: false for an
  API key without the `staff` scope), `apiKeyCredential(c)` (= `ApiKeyCredential.current()`), `principal(c)`.
  Import from `src/http/auth/context.ts`.
- Per-user quotas: `deps.userRateLimiter.consume('proposals', user.id)` (= `UserRateLimiter`).
- Cookies: `src/http/auth/cookies.ts` (`sessionCookie`, `clearSessionCookies`, `formatCookie` = Spring's
  `ResponseCookie` format); read one with `readCookie(c.req.header('cookie'), name)` (`@CookieValue`).
- Headers (`@RequestHeader`): `c.req.header('x-name')`. The caller's IP as `ClientIp.resolve` sees it
  (vote dedup, analytics, tracking): `c.get('state').clientIp`. The raw request URI: `c.get('state').requestUri`.
- HTML (`produces = TEXT_HTML`), images, `StreamingResponseBody`, redirects: return a `Response` (a
  `ReadableStream` body for streams). Bun adds `Content-Type` to string/byte bodies; set the one Java sends.
- `PageResponse` records (news, drive, ...) are feature DTOs (`{data, meta: {total, page, limit}}` etc.), not
  Spring's `PageImpl`: port the one your controller returns.

## Authorization: central, already complete

`src/http/auth/policy.ts` is the whole of `SecurityConfig` (URL rules, same order) **and every `@PreAuthorize`
of every controller** (`METHOD_RULES`, keyed `"POST /v1/careers"` exactly as the OpenAPI path). You do not
write `if (!staff) throw` for these: the router applies the rule for your route after binding the arguments,
like Spring. Check the key of each route you add is in `METHOD_RULES` when its Java method has
`@PreAuthorize` (all 163 are there).

Rules that call feature logic (`@orgAccess.canEditOrg(#slug, authentication)` ...) are named checks. The
feature that owns them registers the implementation in its `routes.ts`:

```ts
deps.accessChecks.register('orgAccess.canEditOrg', async ({ deps, principal }, slug) => ...);
```

Arguments arrive in rule order (`path.<var>` / `body.<field>` of the validated body). An unregistered check
answers 500 and logs which name is missing. If your area needs a URL rule or a method rule that is not in
`policy.ts`, **report it**; do not edit the file.

What the chain does before your handler (src/http/security.ts): security headers, CORS, per-IP rate limits
(`rate-limit.rules`), the `X-Api-Key` filter (user keys + scopes, the sync key), the bearer/cookie JWT
(401 with Spring's `WWW-Authenticate` descriptions), the URL rules (401 empty body for anonymous, 403 empty
body otherwise). 404 `No static resource ...` / 405 + `Allow` / 415 / 400 / 500 bodies come from the app.

## Config

All of `application.yml` (+ prod/dev profiles) is already parsed in `src/config/sections/*.ts` with the
same env names and defaults: `server`, `db`, `auth`, `rateLimit`, `integrations` (itba, sync, mobileApp, push,
storage), `kb`, `content` (driveSync, mail, orgMail, events, digest), `logging`. Read `deps.config.<section>`.
The Java `*Properties` records also normalize values (trim, fallbacks); `auth` and `rateLimit` do it already,
for the others port the normalization of your area **in your own section file** (e.g.
`src/config/sections/digestPersonal.ts` with a new key) rather than editing a shared one. A section file is:

```ts
const schema = z.object({ ... });
declare module '../registry' { interface ConfigSections { myArea: z.infer<typeof schema> } }
export default defineSection('myArea', schema, ({ env, hasProfile }) => ({ x: env.duration('MY_ENV', 'PT5M') }));
```

`env.str(name, def)` is Spring's `${NAME:def}` (set-but-empty wins over the default), `env.duration` accepts
`PT5M`/`10m`/`60s`/`60d`/millis (returns ms), `env.list` is comma-separated and trimmed, `env.bool` accepts
true/false/yes/no/on/off/1/0.

## Jobs

`src/features/<area>/jobs.ts`:

```ts
export default defineJobs((deps) => [{
  name: 'DigestJob#createWeeklyDraft',
  lock: 'DIGEST_SCHEDULE',                                   // JobLock.Job: mandatory (JOBS in src/jobs/joblock.ts)
  schedule: { cron: '0 5 0 * * MON', zone: 'America/Argentina/Buenos_Aires' },   // Spring 6-field cron
  enabled: deps.config.content.digest.jobsEnabled,
  run: () => service.createScheduledDraft(),
}]);
```

Schedules: `{ cron, zone? }` (no zone = JVM default zone, `TZ`), `{ fixedDelayMs, initialDelayMs }`,
`{ fixedRateMs, initialDelayMs }`. The ids are the Java ones; a job Java runs without a lock (OrgMailJob.tick)
omits `lock` (`test/jobs/joblock-coverage.test.ts` checks every job against `JOBS`). The scheduler waits for
running jobs on shutdown.

Lifecycle work returns `{ jobs, startup, shutdown }` instead of an array (`src/jobs/scheduler.ts`):
- `startup: [{ name, order, enabled, run }]` = `@EventListener(ApplicationReadyEvent)`: run one after the other
  by `order` before readiness turns UP; a throw fails the startup, as in Spring.
- `shutdown: [{ name, phase, order, run }]`: `phase: 'closing'` = `@EventListener(ContextClosedEvent)` (stop
  flags, before the drain); `'executors'` = the task executor's await-termination (wait for kicked workers,
  after HTTP and the jobs, before the pool closes).

## Serialization

Read `docs/SERIALIZATION.md` before writing a DTO. The rules that bite: `OffsetDateTime` read from the DB prints
`...Z` but one computed in Java prints `...-03:00`; `Instant` prints the fraction in groups of 3, `OffsetDateTime`
strips trailing zeros; `double` fields need `javaDouble()`; `numeric` needs `bigDecimal()`; `TIME` columns go
through `formatPgTime()` (milliseconds, truncated); key order = record order.

## External services and fakes (`deps`)

| deps | Java | Selected by |
|---|---|---|
| `clock` | `ClockConfig` (ART) | `SystemClock`; tests `MutableClock` |
| `storage` | `ObjectStorage` (S3/MinIO) | all `STORAGE_*` set -> `S3ObjectStorage`, else `UnconfiguredObjectStorage` (501); tests `InMemoryObjectStorage` |
| `mailTransport` | `EmailSender` transports | `MAIL_ENABLED`, `MAIL_LOG_SENDS`, `MAIL_TRANSPORT` (MailConfig); tests `InMemoryEmailSender` |
| `push` | `PushGateway` | FCM when `FIREBASE_SERVICE_ACCOUNT_JSON/_PATH`, else `null` (NoOp service); tests `FakePushGateway` |
| `itba` | `ItbaApiClient` | `ITBA_API_USE_FAKE` -> `FakeItbaApiClient` (+ `ITBA_API_FAKE_FROM_DB`) |
| `drive` | `DriveClient` | `DRIVE_SYNC_USE_FAKE` -> `InMemoryDriveClient`, else Unconfigured |
| `llm.batch/chat/catalog/embeddings` | `LlmBatchClient`, `SyncChatClient`, `DoModelCatalog`, `EmbeddingClient` | `KB_LLM_USE_FAKE` / `KB_EMBEDDING_USE_FAKE` -> the Fake* ports, else Unconfigured |
| `google.oauth/idTokens` | `GoogleOAuthService`, `GoogleIdTokenVerifier` | real; tests `StubGoogleOAuthClient`, `JwksGoogleIdTokenVerifier(auth, localKey)` |
| `userRateLimiter`, `jobLock`, `accessChecks`, `availability`, `log`, `db`, `sql` | | |

### Real integrations

Every Java integration is ported: `RestItbaApiClient` + `wire/*` (`src/external/itba*`), `GoogleDriveClient` and
`FakeDriveClient`'s demo content (`src/external/drive*`), the DigitalOcean/OpenAI clients and fakes
(`src/external/llm*`), the Gmail API transport and the quota ledger (`src/features/mail`; `src/infra/mail.ts`
selects the transport and leaves the Gmail slot to the mail feature), `S3ObjectStorage` (presign with
`signableHeaders` + `WHEN_REQUIRED`, spike 7) and `FirebasePushGateway` (real, not exercised against FCM in
tests). `SmtpEmailSender` classifies failures with `src/features/mail/logic/smtpReplyClassification.ts`.

## Contract tests: how to port a Java IT

One file per Java IT class (or group), test names = Java method names, a header comment naming the Java file.
Worked examples: `contract/tests/career.contract.test.ts`, `refresh-token.contract.test.ts`.

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedCareer, seedStaff, supports, useServer } from '../support';

const api = useServer({ env: { /* the IT's @TestPropertySource, as env vars */ } });   // boots per FILE
const hasX = await supports('GET /v1/some/other/feature');                              // skip on ts until it exists

describe('CareerWritesIT', () => {
  beforeEach(async () => { await api.db`DELETE FROM public.plan`; });                   // @BeforeEach deleteAll()
  test('staffCanCreate_returns201', async () => {
    await seedStaff(api.db, 'boss@itba.edu.ar');                                        // ROLE_STAFF = a real row
    const r = await api.post('/v1/careers', { as: bearer(await mintJwt({ email: 'boss@itba.edu.ar' })), body: { id: 'S', name: 'Sistemas' } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"id":"S","name":"Sistemas","plans":[]}');                       // byte-level where it matters
  });
});
```

- `useServer({ env })` starts a fresh server (jar or Bun, `CONTRACT_TARGET`) on a free port, against a fresh
  clone of the template database (migrated like the ITs: `db/migration` + `db/test-migration`, target 4.52),
  with the IT test profile translated to env (`contract/support/env.ts`). Two configs in one file = two
  `useServer` calls. Nothing leaks between files.
- Requests: `api.get/post/put/patch/delete/head/options(path, { as, body, contentType, headers, query, rawPath })`
  -> `{ status, headers, text, json, setCookies, location }`. Paths are without `/api`. `rawPath: true` sends
  the path untouched (encoded-path tests).
- Identities: `bearer(await mintJwt({ email, name, ttlSeconds, iss, aud, claims }))` (= JwtIssuerService
  claims, test secret), `sessionCookie(token)`, `apiKey(key)` with `seedApiKey(db, userId, scopes|null)`,
  `apiKey(TEST_SYNC_KEY)`. MockMvc's `jwt().authorities(ROLE_STAFF)` becomes `seedStaff(db, email)`;
  moderators `seedModerator(db, userId)`.
- Seeding: `api.db` is a postgres.js client on the server's database: `seedUser`, `seedStaff`, `seedCareer`,
  `seedPlan`, `seedRefreshToken`, `truncateUsers`, or plain SQL. Wrap SQL in `async () => { await ... }` inside
  hooks: a bare postgres.js query returned from a hook is never awaited by bun.
- Asserting: status and the IT's jsonPath checks; add byte-level `r.text` checks for shapes you port.
  Never assert the order of several validation violations or of `Allow` (Java's is not stable).
- A test that needs another feature's endpoint: `test.skipIf(!(await supports('METHOD /path')))`.
- Run it against **both** targets before you report done: `bun contract/run.ts --target both <file-fragment>`.
  The Java run is the proof the test is right; the TS run is the proof the port is.
- In-process ports (ITs that need fakes, a clock, stubbed Google, open transactions): `test/<area>/*.test.ts`
  with `testApp({ env, overrides })` from `test/support/app.ts`, and a row in `contract/IN-PROCESS.md`.
- Unit tests (`*Test.java`) become `test/<area>/*.test.ts` against your `logic/` or service functions.

## Done for an area means

1. Every Java endpoint of the area has a route (`bun contract/coverage.ts --list`).
2. Every `*IT.java` of the area is ported (contract or in-process) and passes on java AND ts.
3. `bun run build` passes; `bun run test` passes.
4. `CONTRACT_RECORD=1 bun contract/run.ts --target ts <area> && bun contract/diff.ts` shows no unexplained diff.
5. Jobs registered with their JobLock ids.
6. You reported anything you needed from shared files instead of editing them.

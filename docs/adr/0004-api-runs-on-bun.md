# The API runs on Bun, not Spring Boot

`apps/api` was a Spring Boot 3 / Java 21 app (~59k LOC, 295 operations, 64 Flyway migrations, 9 locked jobs). The
rest of the repo is TypeScript on Bun (web, MCP server, `packages/scheduler-core`), so the API was the one app
outside the workspace: a second toolchain (JDK, Maven), a second dependency ecosystem, a 2 GB container and a
two-minute test run. We rewrote it in TypeScript on Bun and switched production in one release.

## Context

- **Cost of the JVM** (`docs/plans/api-bun-baseline.md`, same machine): the Java server idled at 735 MiB of RAM
  and booted in 10 s; the Bun port idles at about 120 MiB and boots, all migrations included, in about 1 s. The
  full test run went from 122 s (Maven `verify`) to 66 s (typecheck, unit + in-process tests, contract suite).
  On a single VPS where both blue/green colors run during a deploy, the memory difference decides how much else
  the host can hold.
- **Risk areas were spiked first** (`docs/plans/api-bun-spikes.md`): firebase-admin (FCM, Firestore), Google
  Drive v3, PDF text extraction (pdfbox), HTML sanitizing (jsoup), pgvector over `postgres`, SMTP and Gmail MIME.
  Each had a working Bun approach or a measured fallback before the port started.
- **Clients must not notice.** Web, MCP and the mobile app (released through the stores, slow to update) depend
  on exact routes, status codes, JSON bytes, error bodies, cookies and JWTs.

## Decision

- **Stack**: Bun (version pinned once in the root `packageManager`), Hono for routing, zod 4 for request
  validation (wrapped as `jv.*` to keep the Bean Validation semantics and messages), Drizzle over `postgres`
  (porsager) for queries, `jose` for JWTs, `croner` for jobs, `pino` for logs. The API is a workspace package
  (`@ceitba/api`) and shares `bun.lock`.
- **SQL-first schema, Flyway-compatible.** The schema stays in the existing `V*.sql` files; Drizzle's mapping
  (`src/db/schema`) is generated from a migrated database, never the other way. `src/db/migrate.ts` reads and
  writes `flyway_schema_history` exactly as Flyway 10 did (checksums, version order, baseline, advisory lock), so
  the Java and Bun apps can take turns on one database. We did not adopt a TS migration tool, and the SQL files
  stay at their Flyway classpath paths because merged migrations are never renamed.
- **Big-bang cutover, guarded by a contract suite.** The Java code was the specification: every Java `*IT` was
  ported to a black-box contract test (725) or an in-process test, and every `*Test` to a unit test; each
  contract test ran green against the jar **and** the Bun server, a parity check matched all 1,207 Java tests,
  and a replay diff compared both servers' responses byte for byte. Cross-runtime tests prove the blue/green
  overlap is safe: tokens, cookies and refresh tokens work across both runtimes on one database, and both
  honour the same job locks. The cutover release ships no migration, so rolling back is redeploying the last
  Java image (`apps/api/docs/DEPLOY.md` "Rollback").
- After the cutover, the Java code was deleted; the contract suite, frozen as TS, is the specification.

## Consequences

- One toolchain and one lockfile for the whole repo; CI tests the API with the same `setup-bun` as the other apps.
  The Java-only tooling is gone (Maven, `scripts/mvn`, the Java Dockerfile, Dependabot's Maven entry). The policy
  test checks `src/http/auth/policy.ts` against a frozen snapshot of the Spring security rules
  (`test/fixtures/java-security-policy.json`) instead of the Java sources.
- Byte compatibility constrains the code: `src/lib/javaCompat.ts`, `docs/SERIALIZATION.md` (Jackson's date and
  number formats) and Java-shaped error messages stay, because clients already parse that output.
- **Known parity gaps** (`apps/api/docs/DRIVE-PARITY.md`): Google Docs HTML is byte-identical to jsoup's on the
  corpus, but PDF text from pdfjs matches pdfbox for only part of the files, so Slides/Sheets exports can get a
  new content fingerprint after the cutover: a one-time re-store and wiki re-digest of those files.
- **The OpenAPI document is thinner.** `/api/docs.json` is generated from the registered routes and lists every
  path, method and parameter, but fewer response schemas than springdoc produced. `contract/openapi.json` keeps
  the last Spring document as the reference the route coverage is checked against.
- The FCM, Gmail API, Drive and ITBA clients were tested against fakes and stubs only; their first real runs
  happen in production.

## Considered options

- **Stay on Spring Boot**: no migration risk, but the second toolchain and the memory cost stay forever.
- **Node.js instead of Bun**: viable, but the rest of the repo already runs on Bun, and Bun's built-in test
  runner, TS execution and fast boot (one server per contract test file) made the contract suite cheap.
- **Per-area cutover through Caddy** (route some paths to Bun, the rest to Java): safer per step but needs both
  apps deployed and in sync for weeks, with shared sessions and jobs split by area. Kept as the fallback at the
  plan's checkpoint B; not needed.
- **A TS migration tool (drizzle-kit migrations)**: would have forked the schema history from what production
  has; the Flyway-compatible runner keeps one history and a rollback path.

# apps/api: agent rules

Spring Boot 3, Java 21, Postgres 16, Maven. Not part of the bun workspace. `README.md` here covers setup and env;
`MIGRATION.md` §4/§6/§8 holds the original architecture plan. Feature docs (the living specs for the API) are in
`docs/`; `docs/agents/spec-map.json` at the repo root says which doc covers which package.

## Commands (run from `apps/api`)

```
./mvnw -B -ntp verify                          # unit + integration tests (what CI runs; ITs need Docker)
./mvnw test -Dtest=ClassName#methodName        # single unit test
docker compose up -d                           # postgres + minio + api; health: /api/actuator/health, Swagger: /api/docs
```

`./scripts/mvn` runs Maven in an `eclipse-temurin:21-jdk` container when no JDK 21 is installed. If you pass
`-Dtest`, add `!*IT` (e.g. `'-Dtest=!*IT'` with `-Dsurefire.failIfNoSpecifiedTests=false`), otherwise Surefire also
runs every `*IT` class. Copy `.env.example` to `.env`; `AUTH_JWT_SECRET` is required, `ITBA_API_USE_FAKE=true` avoids
the upstream ITBA API.

## Layering

Strict one-way layering under `src/main/java/org/ceitba/api/`:
`web/` (controllers, DTOs) → `service/` → `repository/` (Spring Data JPA) → `domain/` (JPA entities). Feature
packages mirror each other across layers (`web/correction`, `service/correction`, `domain/correction`, ...).

- Entities never leave `service/`; controllers return DTO records from `web/<feature>/dto/`.
- Read-only service methods are `@Transactional(readOnly = true)`; writes are plain `@Transactional`.
- Throw domain exceptions (`common/exception/*` or a feature exception in `service/<feature>/`), never
  `ResponseStatusException`. `web/error/GlobalExceptionHandler` maps each one to HTTP; a new exception type needs a
  handler there. The error body is `ErrorResponse(error, message, path, timestamp)` and stays that shape.
- Composite primary keys use `@IdClass` (pattern: `domain/PlanSubject.java`).
- All calls to the upstream ITBA system go through `external/itba/ItbaApiClient`; other HTTP clients come from
  `config/RestClientConfig`, never `new RestClient()` in a service.
- Add an interface only when there is a second implementation or a test fake.
- Business time comes from the injected `Clock` (`config/ClockConfig`, America/Argentina/Buenos_Aires):
  `LocalDate.now(clock)`, not `LocalDate.now()`, so tests can move time.
- Controllers: constructor injection, full `/v1/...` path on each method (context path is `/api`), `@Tag`,
  `@Operation`, `@Valid @RequestBody` DTO records, `@CurrentUser User` for the caller.

## Auth

Read `docs/AUTH-AND-ROLES.md` and `docs/AUTH-SETUP.md` before touching `config/SecurityConfig`, `web/auth/*` or
`service/auth/*`. Roles are `Anonymous`, `USER`, `STAFF`, `SYNC`. The API issues its own HS256 JWTs after a
server-side Google OAuth code exchange. Every route is authenticated + allowlisted unless `SecurityConfig` says
otherwise: a new public, STAFF, MODERATOR or SYNC route needs an explicit matcher there.

User API keys (`ceitba_`, `X-Api-Key`) carry scopes `read`/`report`/`write`/`staff`/`keys` (V62, `ApiKeyScope`,
enforced in `ApiKeyFilter`); see `docs/AUTH-SETUP.md` § Scopes. Service code that grants the caller staff or moderator
powers asks `service/auth/StaffPowers`, never the `ceitba_staff`/moderator repositories directly: it withholds them
from a key without `staff`.

## Database

Hibernate runs in `validate` mode; Flyway (`src/main/resources/db/migration/`) is the only schema tool. Two
schemas, `public` and `wiki`. Never edit a migration that has merged; add a new one with the `flyway-migration`
skill (it also handles the test mirror in `src/test/resources/db/test-migration/`). Migrations are
**expand/contract**: two API colors overlap during a deploy, so the old jar runs against the new schema. Add tables,
nullable/defaulted columns and indexes together with the code; `DROP`, `RENAME`, `NOT NULL` on existing columns and
type changes go one release later (`docs/DEPLOY.md`). Do not set `hibernate.jdbc.time_zone` (it shifts `LocalTime`
columns; `LocalTemporalZoneIT` enforces this).

Postgres runs the `pgvector/pgvector` image (Debian) in compose and in the ITs: the wiki pages' embeddings live in
`wiki.kb_page_chunk` (`docs/SUBJECT-WIKI.md` "Embeddings"), computed by the self-hosted `ceitba-embeddings` compose
service (llama.cpp + EmbeddingGemma 2); the vector column is not JPA-mapped, only native queries touch it.

## Tests

- `*Test` = unit (Surefire), `*IT` = integration (Failsafe, Testcontainers).
- ITs get their database from `support/SharedPostgres`:
  `static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();`.
- Prefer the existing fakes over Mockito when one fits: `service/kb/InMemoryRepo`, `service/mail/MutableClock`,
  `service/media/InMemoryObjectStorage`, `FakePushGateway`, `InMemoryMailLedger` (all under `src/test/java`).
- Every behaviour change or bug fix comes with a test that fails without it.

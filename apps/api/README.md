# CEITBA-API

REST API for managing ITBA student and club data — careers, plans, subjects, classrooms, commissions, and the wiki layer (bookmarks, notes, comments, edit proposals). Backs the CEITBA community apps and integrates with the ITBA backend.

**Stack**: Spring Boot 3.3 / Java 21 / PostgreSQL 16 / Hibernate / Flyway / Spring Security (Google OIDC).

The repo was migrated from NestJS + Prisma in 2026; the migration plan and per-PR record live in [MIGRATION.md](MIGRATION.md).

## Quick start (Docker — recommended)

```sh
git clone https://github.com/CEITBA/CEITBA-API.git
cd CEITBA-API
cp .env.example .env             # edit values, especially AUTH_SYNC_API_KEY
docker compose up -d             # postgres + ceitba-api
curl http://localhost:8080/api/actuator/health
```

Swagger UI: http://localhost:8080/api/docs · OpenAPI spec: http://localhost:8080/api/docs.json

## Local dev (host JDK)

Requires JDK 21. We recommend [SDKMAN](https://sdkman.io/) (`sdk install java 21-tem`) or the [Adoptium installer](https://adoptium.net/).

```sh
docker compose up -d postgres                    # just the database
./mvnw spring-boot:run                            # runs the app on :8080
```

## Local dev (no host JDK)

Use `./scripts/mvn` — runs Maven inside a JDK-21 container. Caches `~/.m2` on the host so subsequent runs are fast. Mounts the Docker socket so Testcontainers (used in tests) can spin up sibling Postgres containers.

```sh
./scripts/mvn -B verify             # full build + tests
./scripts/mvn spring-boot:run       # run the app
```

## Tests

```sh
./mvnw verify                       # unit + integration (Testcontainers Postgres)
./mvnw test                         # unit only
./scripts/mvn -B verify             # same, via container — no host JDK
```

## Configuration

All config flows through env vars; see [`.env.example`](.env.example). Highlights:

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `jdbc:postgresql://localhost:5432/ceitba_db` | JDBC URL |
| `AUTH_ALLOWED_DOMAINS` | `itba.edu.ar` | Comma-separated email domains admitted by the JWT converter |
| `AUTH_ALLOWED_EMAILS` | _(empty)_ | Comma-separated explicit email allowlist (for accounts not on an allowed domain) |
| `AUTH_JWT_AUDIENCE` | _(empty)_ | Optional Google OAuth client ID to require in the `aud` claim |
| `AUTH_SYNC_API_KEY` | _(empty)_ | Required value for the `X-API-Key` header on `/api/v1/sync/**` |
| `SYNC_ENABLED` | `false` | Toggle the twice-daily `@Scheduled` data-sync job |
| `ITBA_API_BASE_URL` / `ITBA_API_TOKEN` | _(empty)_ | ITBA backend connection |
| `ITBA_API_USE_FAKE` | `false` | Swap in `FakeItbaApiClient` (no network) |

## Auth

Roles are `Anonymous`, `USER`, `STAFF`, and `SYNC` (machine). Full guide — including how to bootstrap the first STAFF member, assign/revoke roles, and add new authorized users — is in [`docs/AUTH-AND-ROLES.md`](docs/AUTH-AND-ROLES.md).

Quick version:
* The API issues its **own** HS256 JWTs after a Google sign-in: web SPAs get one in an HttpOnly cookie via the server-side OAuth flow (`GET /v1/auth/google`); the mobile app exchanges a Google ID token at `POST /v1/auth/google/mobile` for an access + rotating refresh token pair. Google tokens are never accepted as bearer tokens.
* Spring Security validates our JWT; the email allowlist (`AUTH_ALLOWED_DOMAINS` ∪ `AUTH_ALLOWED_EMAILS`) is enforced by an `AuthorizationManager`, and a custom converter adds `ROLE_STAFF` if the user has an active `ceitba_staff` row.
* `User` rows are JIT-provisioned (no signup endpoint). The first `STAFF` member is bootstrapped via SQL — see the guide.
* `/api/v1/sync/**` is gated by a static `X-API-Key` header (env `AUTH_SYNC_API_KEY`).

## Endpoints

| Path | Method | Auth |
|---|---|---|
| `/api`, `/api/health`, `/api/actuator/health` | GET | public |
| `/api/v1/careers/**` | GET | public |
| `/api/v1/subjects/**`, `/api/v1/plans/**` | GET | public |
| `/api/v1/classrooms/**` | GET | public |
| `/api/v1/classrooms/conflicts` | POST | public |
| `/api/v1/commissions?plan=` | GET | public |
| `/api/v1/highlights` | GET | public |
| `/api/v1/highlights/all` | GET | Google JWT + `ROLE_STAFF` |
| `/api/v1/highlights`, `/api/v1/highlights/{id}` | POST, PUT, DELETE | Google JWT + `ROLE_STAFF` |
| `/api/v1/benefits`, `/api/v1/benefit-cards` | GET | public (writes: `ROLE_STAFF`) |
| `/api/v1/users/**` | GET, POST `/create` | Google JWT + `ROLE_STAFF` |
| `/api/v1/wiki/bookmarks/{id}` | GET | public |
| `/api/v1/wiki/bookmarks/{id}` | POST/PUT/DELETE | Google JWT |
| `/api/v1/staff/**` | GET, POST, DELETE | Google JWT + `ROLE_STAFF` |
| `/api/v1/sync/**` | POST | `X-API-Key` |

Full list (with examples + schemas) in `/api/docs`.

**Migration parity** (i.e. how the Spring API differs from the previous NestJS version): see [`docs/MIGRATION-PARITY.md`](docs/MIGRATION-PARITY.md). TL;DR: 100% migrated; admin-style writes for careers and subject-plans are gated behind `ROLE_STAFF`.

## Database

* Schema lives in `src/main/resources/db/migration/`. **Flyway is the only thing that changes the schema.**
* Hibernate runs in `validate` mode — entities are checked against the schema at startup; mismatches fail boot.
* Two schemas: `public` (academic + identity) and `wiki` (notes, comments, bookmarks, proposals).
* See [docs/MIGRATION-RUNBOOK.md](docs/MIGRATION-RUNBOOK.md) for first-time prod setup (Flyway baseline against the existing Prisma-managed DB).

To rebuild the local DB from scratch:

```sh
docker compose down -v && docker compose up -d postgres
./mvnw spring-boot:run    # Flyway runs V1__baseline.sql + any later Vn__*.sql
```

## Conventions for contributors

Read [MIGRATION.md §8 (Onboarding checklist)](MIGRATION.md). Short version:

1. Layers are one-way: `web → service → repository → domain`.
2. Entities never escape `service/`. Controllers return DTOs (records).
3. `@Transactional(readOnly=true)` on read methods; plain `@Transactional` on writes.
4. Throw domain exceptions; the `GlobalExceptionHandler` translates to HTTP. Never `throw new ResponseStatusException`.
5. Schema changes go in a new `V<n>__<desc>.sql` migration. **Never edit a migration that has merged.**
6. Composite PKs use `@IdClass`. Pattern lives in `domain/PlanSubject.java`.
7. External calls go through `external/itba/ItbaApiClient`. Don't `new RestClient()` in a service.
8. Add an interface only if you have a second implementation or a test fake.

## License

MIT. See [LICENSE](LICENSE).

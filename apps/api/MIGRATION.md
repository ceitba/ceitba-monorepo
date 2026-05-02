# MIGRATION.md — CEITBA-API: NestJS → Spring Boot

> **Scope**: Migrate the production CEITBA-API from NestJS 11 + Prisma 6 + PostgreSQL to Spring Boot 3 + Hibernate/JPA + Flyway + PostgreSQL.
>
> **Note on the brief**: the original ask said "Express.js + Prisma". The repo is actually **NestJS 11**, which already exposes a controller/service/repository layout with DI and decorators. The architectural shape carries over to Spring Boot almost 1:1 — this is a translation, not a rewrite of patterns.

---

## 1. What this app actually does

Public REST API at `/api/...`. Surface today:

| Area | Routes | Notes |
|---|---|---|
| Health | `GET /api`, `GET /api/health` | Trivial |
| Users | `POST /api/v1/users/create`, `GET /api/v1/users` | `UserRepositoryImpl` is **mostly stubs** (TODOs for old Supabase RPCs). Treat as greenfield in Java. |
| Careers | `GET/POST/PUT/DELETE /api/v1/careers`, `GET /api/v1/careers/plans` | CRUD + grouped read |
| Subjects | `GET /api/v1/subjects?plan=...`, `GET /api/v1/subjects/:id` | "by plan" goes through external ITBA API |
| Subject-by-plan | `GET/POST/PUT/DELETE /api/v1/plans/...` | Year/semester/section/elective filters |
| Classrooms | `GET /api/v1/classrooms`, `/building/:b`, `/day/:d`, `POST /conflicts` | Time-overlap logic in `TimeSlot.overlaps` and `ClassroomSchedule.conflictsWith` |
| Data sync | `POST /api/v1/sync/...` | Manual + cron (12h) ingestion from ITBA API |
| Wiki bookmarks | `GET/POST/PUT/DELETE /api/v1/wiki/bookmarks/:subjectId` | Reads `req.user.id` but **no auth filter is wired** — security gap to fix during migration |
| Swagger | `/api/docs`, `/api/docs.json` | |

External dependencies:
- **ITBA API** — XML/JSON over HTTP with token-in-URL auth (`/careerPlans/{token}`, `/courseCommissions/{token}`)
- **Supabase** — referenced via env var `SUPABASE_ACCESS_TOKEN` but not actually consumed in current Prisma code (legacy from pre-Prisma era)
- **Cron** — `@nestjs/schedule` running `0 0,12 * * *` to call full sync

Database: PostgreSQL with two schemas — `public` (user, careers, plan, subject, commission, plan_subject, commission_time, ceitba_staff) and `wiki` (subject_difficulty, subject_comment, subject_comment_vote, subject_note, subject_note_vote, career_note, career_note_vote, subject_wiki_page, subject_wiki_edit_proposal, Subject_Bookmarks).

**Schema bug to fix during migration**: `user.career_id` is `UUID` while `careers.id` is `VARCHAR(25)`. There is no FK constraint enforcing the link, and the types are incompatible. Fix as part of PR 2 (Flyway baseline) — see §5.

---

## 2. Project structure (Spring Boot)

Flat, layered, junior-readable. One module. Java 21 + Spring Boot 3.3.

```
ceitba-api/
├── pom.xml                         # Maven (or build.gradle.kts — pick one and stick to it)
├── src/main/
│   ├── java/org/ceitba/api/
│   │   ├── CeitbaApiApplication.java
│   │   ├── config/                 # SecurityConfig, OpenApiConfig, RestClientConfig, CorsConfig
│   │   ├── web/                    # Controllers + request/response DTOs + exception handler
│   │   │   ├── user/               # UserController, dto/
│   │   │   ├── career/
│   │   │   ├── subject/
│   │   │   ├── plan/
│   │   │   ├── classroom/
│   │   │   ├── sync/
│   │   │   ├── wiki/
│   │   │   ├── health/
│   │   │   └── error/              # GlobalExceptionHandler (@ControllerAdvice)
│   │   ├── service/                # @Service classes — business logic
│   │   │   ├── user/
│   │   │   ├── subject/
│   │   │   ├── plan/
│   │   │   ├── classroom/
│   │   │   ├── sync/
│   │   │   └── wiki/
│   │   ├── repository/             # Spring Data JPA repositories
│   │   ├── domain/                 # JPA @Entity classes + a few embedded value objects
│   │   ├── external/               # ITBA API client (RestClient + DTOs that match XML/JSON shape)
│   │   │   └── itba/
│   │   ├── scheduling/             # @Scheduled jobs
│   │   └── common/                 # Shared exceptions, time utils, enums
│   └── resources/
│       ├── application.yml
│       ├── application-dev.yml
│       ├── application-prod.yml
│       └── db/migration/           # Flyway: V1__baseline.sql, V2__..., etc.
└── src/test/java/org/ceitba/api/   # Mirror of main packages
```

**Why this layout** (rules a junior must know):

- **`web/` is the only place HTTP exists.** No `HttpServletRequest`, status codes, or `@RequestMapping` outside `web/`.
- **`service/` owns business logic and transactions.** `@Transactional` lives here, never on controllers or repositories.
- **`repository/` is one-liners.** Methods named after queries; no business decisions.
- **`domain/` is JPA entities and small value objects.** No Spring annotations.
- **`external/` wraps third-party APIs.** The rest of the app talks to interfaces in `external/itba/`, never to `RestClient` directly.
- **DTOs live next to controllers, in `web/<feature>/dto/`.** Entities never escape past `service/`.

No `domain/<feature>/{services,repositories,interfaces,models,dto,exceptions}` mega-tree like today's NestJS code. The current tree creates 6+ files for every concept; the proposed structure creates 3–4 (entity, repo, service, controller).

---

## 3. Domain model — Prisma → JPA

Mapping table. Column types stay identical (Flyway preserves the schema); these are JPA annotations only.

| Prisma model | JPA entity | Table | Notes |
|---|---|---|---|
| `User` | `User` | `public.user` | UUID id; `careerId` is currently typed `Uuid` but should be `VARCHAR(25)` (see §5). Use `@Table(schema="public", name="user")` — `user` is reserved in PG, quote it. |
| `Career` | `Career` | `public.careers` | String PK (`VARCHAR(25)`). 1:N → `Plan`. |
| `Plan` | `Plan` | `public.plan` | `@ManyToOne` → `Career`. |
| `Subject` | `Subject` | `public.subject` | String PK. Hub of many wiki relations. |
| `Commission` | `Commission` | `public.commission` | String PK. 1:N → `CommissionTime`, `cascade = ALL, orphanRemoval = true`. |
| `CommissionTime` | `CommissionTime` | `public.commission_time` | **Composite PK** `(courseId, day, hourFrom)` — use `@IdClass(CommissionTimeId.class)` or `@EmbeddedId`. Pick one and use the same pattern everywhere. Recommended: `@IdClass` (less ceremony for a junior reader). |
| `PlanSubject` | `PlanSubject` | `public.plan_subject` | **Composite PK** `(subjectId, planId)`. `dependencies String[]` is a Postgres `text[]` — map with Hibernate 6's `@JdbcTypeCode(SqlTypes.ARRAY)` + `@Column(columnDefinition="varchar(255)[]")`. |
| `CeitbaStaff` | `CeitbaStaff` | `public.ceitba_staff` | PK = `userId` (1:1 with `User`). `@OneToOne(@MapsId)`. |
| `SubjectDifficulty` | `SubjectDifficulty` | `wiki.subject_difficulty` | Composite PK `(subjectId, userId)`. |
| `SubjectComment` | `SubjectComment` | `wiki.subject_comment` | UUID PK. 1:N → `SubjectCommentVote`. |
| `SubjectCommentVote` | `SubjectCommentVote` | `wiki.subject_comment_vote` | Composite PK `(commentId, userId)`. |
| `SubjectNote` | `SubjectNote` | `wiki.subject_note` | UUID PK. |
| `SubjectNoteVote` | `SubjectNoteVote` | `wiki.subject_note_vote` | Composite PK. |
| `CareerNote` | `CareerNote` | `wiki.career_note` | UUID PK. |
| `CareerNoteVote` | `CareerNoteVote` | `wiki.career_note_vote` | Composite PK. |
| `SubjectWikiPage` | `SubjectWikiPage` | `wiki.subject_wiki_page` | PK = `subjectId` (1:1 with `Subject`). |
| `SubjectWikiEditProposal` | `SubjectWikiEditProposal` | `wiki.subject_wiki_edit_proposal` | UUID PK. Two FKs to `User` (`proposedBy`, `reviewedBy`) — disambiguate associations. |
| `SubjectBookmark` | `SubjectBookmark` | `wiki.Subject_Bookmarks` (preserve casing) | Composite PK `(subjectId, userId)`. |

**Enums**: `SubjectType`, `DayOfWeek`, `CeitbaBranch`, `CeitbaStaffRole`, `VoteType`, `ProposalStatus` → Java `enum`s annotated `@Enumerated(EnumType.STRING)` with `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` so Hibernate uses the existing PG enum types. **Do not** convert to lookup tables — the data already lives in PG enum form.

**Relations that need attention**:

1. **`User` is a hub** — 12 `@OneToMany` collections in Prisma. In JPA, **don't map all of them as fields on `User`**. Map the inverse only where you actually need to traverse it (probably nowhere in the API today). For the rest, query through the child repository (`subjectCommentRepository.findByUserId(...)`). This avoids `LazyInitializationException` traps and keeps `User` readable.
2. **`Subject` is a hub** for the wiki schema — same rule.
3. **`CommissionTime` ↔ `Commission`** — keep `@OneToMany` from `Commission` since the sync logic mutates the collection. Use `cascade = ALL, orphanRemoval = true` and use `@OrderBy` for deterministic output.
4. **Composite PKs** (`PlanSubject`, `CommissionTime`, all `*Vote` and `*Bookmark`) — pick one approach (`@IdClass` recommended) and apply uniformly. Document in onboarding checklist.
5. **`text[]` on `PlanSubject.dependencies`** — easy to get wrong. Use `@JdbcTypeCode(SqlTypes.ARRAY)` on a `List<String>`. Add an integration test that round-trips.
6. **Two FKs to `User` from `SubjectWikiEditProposal`** — must specify `@JoinColumn` names (`proposed_by`, `reviewed_by`) explicitly.

---

## 4. Layer responsibilities — concrete rules

| Layer | What goes here | What does NOT |
|---|---|---|
| `web/` (controller) | `@RestController`, request mapping, validation (`@Valid`), DTO ↔ DTO mapping, OpenAPI annotations. Returns DTOs. | Business logic. DB calls. Transactions. Construction of domain entities. |
| `web/<f>/dto/` | Request and response DTOs (records). Bean Validation annotations. | Persistence annotations. Cross-layer leakage of JPA entities. |
| `service/` | Business logic, orchestration of multiple repositories, `@Transactional`, calls to `external/`, mapping entity → DTO. | HTTP types (`HttpStatus`, `ResponseEntity`). Direct SQL. |
| `repository/` | `interface FooRepository extends JpaRepository<Foo, Id>` with derived queries or `@Query`. | Business decisions ("if not found, throw"). Multi-entity orchestration. |
| `domain/` | `@Entity`, `@Embeddable`, lifecycle hooks. Small invariant checks in constructors only when cheap. | Spring annotations. References to repositories or services. |
| `external/itba/` | `RestClient` calls, response parsing, retry/timeout config. Outputs domain types or local DTOs. | Anything specific to controllers or DB. |
| `scheduling/` | `@Scheduled` glue that calls a service method. Nothing else. | The actual sync logic — that's in `service/sync/`. |
| `common/` | Shared utilities (time parsing, enums shared across features), base exceptions. | Anything feature-specific. |

**Mapping rules**:
- Entity → response DTO mapping happens in the service layer, returning DTOs to the controller.
- No MapStruct unless mapping volume justifies it (probably not at current size). Hand-written `static` methods in a `Mapper` class next to the DTO are fine.
- Constructors on records do the work; avoid Lombok unless the team already standardizes on it.

**Transaction boundaries**:
- `@Transactional` on service methods. Read methods get `@Transactional(readOnly = true)`.
- Never on controllers, repositories, or entities.

**Exception handling**:
- Domain exceptions in `common/exception/` (or per-feature when truly local). Subclass a sealed `DomainException`.
- `@ControllerAdvice` in `web/error/GlobalExceptionHandler.java` is the **only** thing that converts exceptions to HTTP status codes. Controllers throw, do not translate.

---

## 5. Where DDD applies, and where it does not

Most of this app is **CRUD over a known schema with one external feed**. Don't reach for tactical DDD for the sake of it.

### Apply lightweight DDD here:

- **Value objects in `domain/`**:
  - `TimeSlot` (already exists, has overlap logic) → `@Embeddable` value object. Keep `overlaps()` as a method.
  - `DayOfWeek` → just a Java enum.
- **A small domain service** for **classroom conflict detection**. The conflict logic (overlap check across `(building, classroom, day, time)`) is non-trivial and belongs alongside `TimeSlot`/`ClassroomSchedule`. Put it in `service/classroom/ConflictDetector.java`, called from `ClassroomService`.
- **Sync orchestration** (`service/sync/DataSyncService`) is a use case — it has a clear input/output contract (`DataSyncResult`) and orchestrates four repositories + one external client. Keep it as a single `@Service` with private helper methods, the way the NestJS version does. **No event sourcing. No CQRS. No saga.** It's a batch upsert.

### Do NOT apply DDD here:

- **`Career`, `Plan`, `Subject`, `User` CRUD** — JPA entities + Spring Data repository + `@Service` is enough. No aggregate roots, no factories, no repositories-as-collections. Anemic-but-clear is the right answer.
- **Wiki bookmarks** — pure CRUD on a join table. Two-line service methods.
- **Subject-by-plan organized response** — it's projection logic. Keep it in the service as a private method that builds the nested map. Don't invent a `SubjectPlanProjection` aggregate.

**Rule of thumb for the team**: if a class has fewer than ~5 methods and no invariants beyond "non-null/non-negative", it's data, not a domain object. Don't promote it.

**Tech debt to flag, not solve now**: the `User` entity is overloaded (auth identity + academic info + staff role). Splitting it would be a separate, post-migration refactor. Note it in the README, do not block the migration on it.

---

## 6. Flyway migration strategy

**Goal**: Spring Boot manages the schema going forward; existing PG data is untouched; Prisma migrations stop being authoritative once cutover lands.

### Approach

1. **Snapshot the live schema** as Flyway `V1__baseline.sql` from a freshly-migrated DB (`pg_dump --schema-only --no-owner --no-privileges`). Hand-edit to:
   - Drop the `_prisma_migrations` table reference (Flyway will create its own `flyway_schema_history`).
   - Fix the `user.career_id` type from `UUID` → `VARCHAR(25)` and add the missing FK to `careers(id)`. Include a data-cleanup statement that nulls out any rows where the cast would fail. This is the only schema *change* in the baseline; everything else is verbatim.
2. **Configure Flyway** with `spring.flyway.baseline-on-migrate=true`, `spring.flyway.baseline-version=1`, `spring.flyway.schemas=public,wiki`, `spring.flyway.default-schema=public`. The `wiki` schema must be in the schemas list because Flyway needs to track it.
3. **Cutover policy**: from PR 2 onward, **all schema changes go through Flyway only**. Prisma migrations are frozen — do not run `prisma migrate dev` against any environment that has been touched by Flyway.
4. **Local dev DB**: rebuild from scratch using Flyway. Provide a Make target / Gradle task that drops and recreates.
5. **Production cutover**: run `flyway baseline -baselineVersion=1` against prod (one-time op) before deploying the Spring Boot app for the first time. Document this exact command in `docs/MIGRATION-RUNBOOK.md`.
6. **Seed data**: port `prisma/migrations/seed_real_careers_and_plans.sql` to a Flyway repeatable migration `R__seed_real_careers_and_plans.sql` (re-runnable on every deploy) **only if** the current seed is idempotent (uses `ON CONFLICT DO NOTHING` or equivalent). Otherwise port as a one-shot `V2__seed_careers.sql`.

### What `V1__baseline.sql` contains

- Two `CREATE SCHEMA IF NOT EXISTS` (`public` is implicit, just `wiki`).
- All enum types (`subject_type`, `day_of_week`, `ceitba_branch`, `ceitba_staff_role`, `wiki.vote_type`, `wiki.proposal_status`).
- All tables with current columns and constraints.
- All indexes.
- All FKs, with the `user.career_id` correction noted above.

### Hibernate side

- `spring.jpa.hibernate.ddl-auto=validate` from day one. Never `update`, never `create-drop`. If a Hibernate validation error fires, the Flyway migration is wrong — fix the migration, not the entity.

---

## 7. Interfaces and abstractions

The current NestJS code has an interface for **every** service and **every** repository (`UserServiceInterface`, `UserRepository`, `SubjectServiceInterface`, etc.). Most have exactly one implementation and zero swappability needs. **Do not port this pattern.** Each unnecessary interface is a navigation tax on every reader.

### Rules for the Spring Boot codebase

- **Spring Data repositories**: the interface IS the repository. Don't add a second layer.
- **Services**: concrete `@Service` classes, no interface. Inject the class directly. Spring's testability does not require interfaces — Mockito mocks classes fine, and `@MockBean` works on concrete types.
- **Add an interface only when**:
  1. Two or more implementations exist or are imminent (e.g., `ItbaApiClient` could plausibly have a `FakeItbaApiClient` for tests/local dev — yes, add the interface).
  2. The implementation crosses a process boundary (HTTP client, message broker) — these benefit from a fake for tests.
  3. A public extension point is intentional and documented.

### Concrete decisions for this app

| Component | Interface? | Why |
|---|---|---|
| `UserService`, `CareerService`, etc. | No | One impl, no swap need |
| `UserRepository`, `CareerRepository`, etc. | Yes (Spring Data) | The framework requires it |
| `ItbaApiClient` | **Yes** | External HTTP, needs a fake for sync tests; fake returns canned XML/JSON |
| `DataSyncService` | No | Orchestrator with no swap need |
| `ConflictDetector` (classroom logic) | No | Internal helper |

The current code's `ApiClient` / `ApiFactory` indirection in `shared/external-apis/` is the right shape — just port it as `external/itba/ItbaApiClient` (interface) + `RestClientItbaApiClient` (impl) + a test fake.

---

## 8. Onboarding checklist

A new dev should be able to read these in 10 minutes and contribute without breaking the architecture.

1. **Layers are one-way**: `web → service → repository → domain`. Never call upward. Never skip a layer (no controller-to-repository).
2. **Entities never escape `service/`**. If you see a `@RestController` returning a `@Entity`, it's a bug.
3. **Transactions live on services**, with `@Transactional(readOnly = true)` on read paths and plain `@Transactional` on writes. Don't sprinkle elsewhere.
4. **DTOs are records**, defined in `web/<feature>/dto/`. Add Bean Validation annotations there.
5. **Exceptions**: throw a domain exception from the service. The `GlobalExceptionHandler` translates to HTTP. Don't `throw new ResponseStatusException`.
6. **Schema changes**: write a `V<n>__<desc>.sql` Flyway migration. Run locally with `./mvnw spring-boot:run -Dspring-boot.run.profiles=dev`. **Never edit a migration that has been merged to main.**
7. **JPA composite PKs use `@IdClass`** — pattern documented in `domain/PlanSubject.java`. Copy it.
8. **External calls go through `external/itba/ItbaApiClient`**. Don't `new RestClient()` in a service.
9. **Add an interface only if you have a second implementation or test fake.** No `XxxService` + `XxxServiceImpl` for the sake of symmetry.
10. **Tests**: unit-test services with mocked repositories; integration-test repositories with `@DataJpaTest` + Testcontainers (Postgres). Don't write controller tests that mock the service — write `@SpringBootTest` end-to-end smoke tests for happy paths.
11. **OpenAPI docs are mandatory**: every controller method gets `@Operation` + `@ApiResponse`. The Swagger UI at `/swagger-ui.html` must work.
12. **Logging**: use SLF4J via `LoggerFactory.getLogger`. No `System.out`. Log levels: `INFO` for sync milestones, `DEBUG` for per-record detail, `WARN` for recoverable, `ERROR` only for bugs.

---

# PR sequence

Each PR aims for **<400 lines changed** and a single reviewable concern. The app stays partially working until **PR 11 (cutover)** — that is the **point of no return**. PRs 1–10 land alongside the existing NestJS app; PR 11 deletes it.

Strategy is **endpoint-by-endpoint cutover via a reverse proxy**: in dev/staging, both apps run; the proxy routes a growing list of paths to Spring Boot. Once all paths are switched, NestJS comes down.

---

### PR 1 — Bootstrap Spring Boot project

**Created**: `pom.xml` (Spring Boot 3.3, Java 21, deps: web, validation, data-jpa, postgresql, flyway, springdoc-openapi, testcontainers); `src/main/java/org/ceitba/api/CeitbaApiApplication.java`; empty package skeleton; `application.yml` with `spring.profiles.active=dev`; `application-dev.yml`, `application-prod.yml`; `.mvn/wrapper`.

**Reviewer must check**:
- Java 21 selected (matches deployment target).
- No `@EnableJpaRepositories` yet (no entities — would fail).
- `application.yml` has `spring.jpa.hibernate.ddl-auto: validate`.
- `springdoc.swagger-ui.path: /swagger-ui.html` is set.
- `pom.xml` does **not** include Lombok unless the team has agreed (a junior-readable choice is to avoid it).

**Acceptance**: `./mvnw spring-boot:run` starts the app on a different port than the NestJS app (e.g., 8080 vs 3000) and prints "Started CeitbaApiApplication". `/actuator/health` returns 200.

**Decisions**:
- Java 21 over 17: virtual threads + records, current LTS.
- Maven over Gradle: lower friction for new contributors; pick whichever the team already uses elsewhere if applicable.
- `springdoc-openapi` over Swagger 2: it's the current standard.

---

### PR 2 — Flyway baseline + DB type fix

**Created**: `src/main/resources/db/migration/V1__baseline.sql`; Flyway config in `application.yml` (`spring.flyway.schemas: public,wiki`, `spring.flyway.baseline-on-migrate: true`, `spring.flyway.baseline-version: 1`); `docs/MIGRATION-RUNBOOK.md` (one-time `flyway baseline` command for prod).

**Reviewer must check**:
- The baseline file is the output of `pg_dump --schema-only --no-owner --no-privileges` against a freshly-migrated dev DB, **with two edits**: (1) `user.career_id` retyped from `UUID` → `VARCHAR(25)` plus FK to `careers(id)`, (2) prep statement to null out any orphan `career_id` values before the type change.
- No data DML in the baseline (only DDL).
- Both schemas (`public`, `wiki`) and all enums are present.
- The `Subject_Bookmarks` table preserves its mixed-case name (it is referenced this way by Prisma — changing it would silently break NestJS during the dual-run window).
- `spring.jpa.hibernate.ddl-auto: validate` is still set.

**Acceptance**: dropping the local DB and running `./mvnw spring-boot:run` recreates the full schema via Flyway. Running NestJS afterward against the same DB still passes its existing manual smoke checks (since the schema is byte-equivalent except for the `career_id` type fix).

**Decisions**:
- Baseline at V1 (not "absorb existing Prisma timestamp filenames"): cleaner mental model, and Prisma's history table will be deleted on cutover anyway.
- The `career_id` type fix lands here, not in a later PR, because we need the FK to express the relation in JPA later. Bundling it with the baseline avoids a "schema-change PR" later.

---

### PR 3 — Domain entities + repositories (read-only baseline)

**Created**: `domain/` (all `@Entity` classes from §3); `repository/` (one Spring Data interface per aggregate root: `UserRepository`, `CareerRepository`, `PlanRepository`, `SubjectRepository`, `CommissionRepository`, `PlanSubjectRepository`, `CeitbaStaffRepository`, plus the wiki-schema repos).

**Reviewer must check**:
- **No** `@OneToMany` on `User` for the 12 relations — they are reachable through child repos only. Only `User ↔ CeitbaStaff` (1:1) is mapped both ways.
- Composite PKs use `@IdClass` consistently; the `*Id` classes are `record`s with `equals`/`hashCode` correct (records get this for free).
- `PlanSubject.dependencies` is `List<String>` with `@JdbcTypeCode(SqlTypes.ARRAY)` and `@Column(columnDefinition = "varchar(255)[]")`.
- All enums use `@Enumerated(EnumType.STRING)` + `@JdbcTypeCode(SqlTypes.NAMED_ENUM)`. Names match the PG type exactly (`subject_type`, `day_of_week`, `wiki.vote_type`, etc.).
- `SubjectWikiEditProposal` has two distinct `@ManyToOne User` mappings with explicit `@JoinColumn(name = "proposed_by")` and `@JoinColumn(name = "reviewed_by")`.
- `Subject_Bookmarks` table name preserves casing (`@Table(schema = "wiki", name = "\"Subject_Bookmarks\"")`).
- `@Table(schema = "public", name = "user")` quotes `user` (reserved word).

**Acceptance**: `./mvnw test` passes a single integration test that uses `@DataJpaTest` + Testcontainers Postgres, runs Flyway, and `count()`s every repository (each returns 0). No Hibernate validation errors at startup.

**Decisions**:
- `@IdClass` over `@EmbeddedId`: the body of the entity stays flat (no `getId().getSubjectId()`), which a junior reading the code will appreciate.
- No `@OneToMany` from `User`: avoids a 12-collection god-entity and cuts the surface area for `LazyInitializationException`.

---

### PR 4 — Health + OpenAPI + global exception handler

**Created**: `web/health/HealthController.java` (mirrors NestJS `getApiStatus` and `getHealth`); `config/OpenApiConfig.java` (title, version, bearer auth scheme); `web/error/GlobalExceptionHandler.java` (`@ControllerAdvice` mapping `EntityNotFoundException` → 404, `ConstraintViolationException` → 400, fallback → 500).

**Reviewer must check**:
- Response shape of `/api` and `/api/health` is identical to the NestJS version (so a proxy switch is invisible to clients). Compare against `src/presentation/v1/controllers/health.controller.ts`.
- `setGlobalPrefix('api')` is replicated via `spring.mvc.servlet.path: /api` (or `@RequestMapping("/api/...")` on every controller — pick one, document it).
- Error responses follow a consistent JSON shape (`{ "error": "...", "message": "...", "path": "...", "timestamp": "..." }`).

**Acceptance**: `curl localhost:8080/api/health` returns the same JSON keys as NestJS. Swagger UI at `/swagger-ui.html` lists Health endpoints.

**Decisions**:
- Use a global prefix `/api` to match the NestJS app exactly. This is what makes a path-based proxy cutover straightforward.

---

### PR 5 — Career + Subject reads

**Created**: `web/career/CareerController.java`, `web/career/dto/`, `service/career/CareerService.java`; `web/subject/SubjectController.java`, `web/subject/dto/`, `service/subject/SubjectService.java`. Read endpoints only: `GET /api/v1/careers`, `GET /api/v1/careers/:id`, `GET /api/v1/careers/plans`, `GET /api/v1/subjects/:id`.

**Reviewer must check**:
- No business logic in controllers (each method should be 1–3 lines: validate, call service, return).
- Services return DTOs, not entities. Verify with a grep: no `Subject` or `Career` entity types in `web/`.
- `GET /api/v1/careers/plans` produces the same shape as the NestJS version (compare with `getCareerPlans()` in the existing controller).
- `@Transactional(readOnly = true)` is on the service read methods.

**Acceptance**: Diff JSON output from NestJS vs Spring Boot for the four endpoints listed. Same shape, same data. (Hand-run; no automated parity tests yet — that's PR 12.)

**Decisions**:
- Read-only first: writes have more failure modes, so we pile up confidence on reads before tackling writes.

---

### PR 6 — Subject-by-plan reads + ITBA API client

**Created**: `external/itba/ItbaApiClient.java` (interface with `getSubjectsByPlan`, `getCommissions`, `getCommissionsBySubject`); `external/itba/RestClientItbaApiClient.java` (Spring 6 `RestClient` impl); `external/itba/dto/` (records that mirror the XML/JSON shape — `ITBACareerPlans`, `ITBASection`, `ITBASubject`, `ITBACourseCommission`, etc.); `external/itba/FakeItbaApiClient.java` (returns canned data, used in tests); `service/plan/SubjectPlanService.java`; `web/plan/SubjectPlanController.java` for `GET /api/v1/plans/:planId/subjects`, `GET /api/v1/subjects?plan=...`, `GET /api/v1/plans/:planId/subject/:subjectId`, `GET /api/v1/plans/subjects/:subjectId/plans`.

**Reviewer must check**:
- The `RestClient` impl handles array-or-object normalization the same way the NestJS version does (the ITBA API returns either `section: {...}` or `section: [{...}]` depending on count). Port the `Array.isArray ? x : [x]` pattern.
- Building name normalization (`External` → `Online`, `Sede Distrito Financiero` → `SDF`, etc.) lives in **one place** — the client mapper, not split across services.
- Subjects "99.52" and "99.56" are still skipped (the existing comment says "ITBA"; preserve the behavior, port the comment).
- The "organized by section/year/semester" projection logic in `SubjectPlanService.getSubjectsByPlanOrganized` is ported as a private helper; not its own class. Output shape matches `SectionSubjectsDto` exactly.
- `FakeItbaApiClient` is used in tests — no live calls in CI.

**Acceptance**: With `ITBA_API_TOKEN` set, `GET /api/v1/subjects?plan=S10-Rev23` against Spring Boot returns the same JSON as NestJS. Unit test for `SubjectPlanService.getSubjectsByPlanOrganized` against `FakeItbaApiClient` passes.

**Decisions**:
- Keep the array-or-single normalization at the boundary, not deeper. The XML-to-JSON gateway leaks this — it's an external misfeature we wrap, not a domain concept.

---

### PR 7 — Classroom queries + conflict detection

**Created**: `service/classroom/ClassroomService.java`; `service/classroom/ConflictDetector.java`; `web/classroom/ClassroomController.java`; `web/classroom/dto/`; `domain/TimeSlot.java` as `@Embeddable` (or plain value record if not persisted directly — it is computed from `commission_time.hour_from`/`hour_to`).

**Reviewer must check**:
- `TimeSlot.overlaps(TimeSlot)` matches the existing TS implementation (open intervals: `start1 < end2 && start2 < end1`).
- Online classrooms are still filtered out from the "by building" grouping.
- `POST /api/v1/classrooms/conflicts` matches the input DTO (`classroom`, `building`, `day`, `hourFrom`, `hourTo`).
- No JPA entities leak through — the controller returns `ClassroomDto` / `ClassroomScheduleDto`.

**Acceptance**: Manual diff of the four classroom endpoints against NestJS. Conflict detection unit-tested with overlapping-edge-cases (touching boundaries should NOT conflict — `09:00-10:00` and `10:00-11:00` is fine).

**Decisions**:
- `ConflictDetector` is a class, not a static helper. It's the one place where the "where is the logic for conflicts?" question has an obvious answer.

---

### PR 8 — Data sync service + cron job

**Created**: `service/sync/DataSyncService.java`; `web/sync/DataSyncController.java`; `web/sync/dto/DataSyncResult.java`; `scheduling/DataSyncJob.java` (`@Scheduled(cron = "0 0 0,12 * * *")` — note the 6-field Spring cron format vs the 5-field Unix one in NestJS); guarded by `@ConditionalOnProperty("sync.enabled")` for non-prod.

**Reviewer must check**:
- The cron expression is **6 fields** (Spring), not 5 (Unix). NestJS used `0 0,12 * * *` (5-field) which is hours `0` and `12`. Spring equivalent: `0 0 0,12 * * *` (sec/min/hour). **Off-by-one cron expressions are a classic foot-gun.**
- The upsert logic (`subject`, `subject_plan`, `commission`) is identical in observable behavior. Diff the loop in `DataSyncService.syncSubjectsAndPlans` and `syncCommissions` against the NestJS version line-by-line.
- The "missing subject placeholder" path (where a commission references a subject that does not exist, so a stub `Subject(code, code, 0)` is created) is preserved with a `// TODO: real subject name`.
- The 5 endpoints under `/api/v1/sync` have identical paths and accept the same query params (`year`, `period`, `levels`).
- `@Transactional` is set per-batch, not per-record (otherwise sync of 1000 commissions does 1000 commits). Probably one transaction per career-plan, one per commission level.

**Acceptance**: Run `POST /api/v1/sync/all` against a clean dev DB, then run the same against NestJS pointed at a separate clean DB. Diff the two DBs with `pg_dump --data-only`; they should be identical (modulo timestamps).

**Decisions**:
- One `DataSyncService` class, no event sourcing, no per-step strategy pattern. The current monolithic structure is correct for this size.
- Schedule one transaction per career-plan loop iteration (not the whole sync) so a single bad plan doesn't roll back everything.

---

### PR 9 — User CRUD (real implementations)

**Created**: `service/user/UserService.java` (real, not stubs); `web/user/UserController.java`; `web/user/dto/CreateUserRequest.java`, `UserResponse.java`. Endpoints: `POST /api/v1/users/create`, `GET /api/v1/users` (later: `GET /:id`, `PUT /:id`, `DELETE /:id` — only if the NestJS equivalents exist; today they don't).

**Reviewer must check**:
- The current NestJS `UserRepositoryImpl` is **mostly stubs** (`throw new Error(...)`). Do **not** port the stubs. Implement directly with Spring Data.
- The schema bug fix from PR 2 (`career_id` is now `VARCHAR(25)` with FK to `careers`) is reflected in the entity — `User.career` is `@ManyToOne`, `Plan` is similarly an FK.
- `POST /create` returns 201 with the same JSON shape as the NestJS endpoint claims (id, email, name, file_number, career_id, plan).
- `GET /api/v1/users` does not blow up (NestJS path returns from a thrown stub). This PR is the one where that endpoint **starts working**.

**Acceptance**: Smoke test: `POST /create` then `GET /` returns the user. Foreign-key violation on bad `career_id` returns 400 (not 500), via `GlobalExceptionHandler`.

**Decisions**:
- Don't preserve the NestJS bugs. The current `UserRepositoryImpl` is non-functional; this PR is its first real implementation, in Java.

---

### PR 10 — Authentication: Google OIDC + API key for sync

**Created**: `config/SecurityConfig.java` (Spring Security with `oauth2ResourceServer().jwt()` pointed at Google's discovery doc); `web/auth/CurrentUser.java` (annotation + `HandlerMethodArgumentResolver` that returns the authenticated `User` entity, JIT-provisioned on first sight); `web/auth/ApiKeyFilter.java` (static-key filter for `/api/v1/sync/**`); `service/auth/UserProvisioningService.java` (upsert `User` row from Google ID-token claims).

**Why this design**:
- The current NestJS `WikiBookmarkController` reads `req.user?.id` but **no auth filter is wired** — endpoints are silently open. We fix this as part of the migration.
- We use **Google as the OIDC provider** rather than building our own login. Frontend uses Google Sign-In (standard at ITBA), gets an ID token, sends as `Authorization: Bearer <id_token>`. Spring Security validates the JWT against Google's JWKS — **zero login code, no password storage, no email verification, no session table**. Google does all of it.
- For sync endpoints (called by cron / ops, not humans), a static `X-API-Key` header is enough. Don't put OAuth on machine-to-machine paths.

**Endpoint policy**:
| Path | Auth |
|---|---|
| `GET /api/health`, `GET /api/v1/careers/**`, `GET /api/v1/subjects/**`, `GET /api/v1/plans/**`, `GET /api/v1/classrooms/**`, `GET /api/v1/wiki/bookmarks/:id` | Public |
| `POST/PUT/DELETE /api/v1/wiki/bookmarks/:id`, all of `/api/v1/users/**` | Google ID token, email must end in `@itba.edu.ar` |
| `POST /api/v1/sync/**` | `X-API-Key` matching env `SYNC_API_KEY` |

**Reviewer must check**:
- `application.yml` has `spring.security.oauth2.resourceserver.jwt.issuer-uri: https://accounts.google.com` and `audiences:` set to the Google OAuth client ID.
- The JIT-provisioning code is **idempotent**: first call creates a `User` row from `(email, name)` claims; subsequent calls do not duplicate. Use `INSERT ... ON CONFLICT (email) DO NOTHING RETURNING ...` (or repo `findByEmail` + `save`).
- Email domain is enforced (`@itba.edu.ar`) inside the JWT converter, not in every controller. Reject with 403 if mismatched.
- API key is read from env, not hardcoded. Missing/wrong key returns 401, not 500.
- The four wiki endpoints (`GET`, `POST`, `PUT`, `DELETE /:subjectId`) match in path and verb. `DELETE` returns 204 idempotently. `GET` returns `{ count, bookmarked: false }` for anonymous users (no auth required for read).
- A `@CurrentUser User user` controller-method param works for the protected endpoints (no boilerplate `SecurityContextHolder` lookups in controllers).

**Acceptance**:
- `POST /api/v1/wiki/bookmarks/93.12` with no token → 401.
- With a valid Google ID token whose email is `@gmail.com` → 403.
- With a valid token whose email is `@itba.edu.ar` → 200, and a `User` row exists.
- `POST /api/v1/sync/all` with no `X-API-Key` → 401. With wrong key → 401. With correct key → 200.

**Decisions**:
- Google OIDC over rolling our own auth: zero code to maintain, MFA is Google's problem, password reset is Google's problem.
- JIT user provisioning over a separate signup flow: the user becomes "real" the first time they hit a protected endpoint with a valid token. Simpler than a `/register` route.
- API key over OAuth client-credentials for sync: cron is not a federated identity; one shared secret is fine and avoids a token-refresh dance.
- Email allowlist in the JWT converter: the alternative (per-controller `@PreAuthorize`) duplicates the rule and is easy to forget on new endpoints.

---

### PR 11 — **Cutover: remove NestJS**, update Docker, update CI ⚠️ POINT OF NO RETURN

**Deleted**: `src/` (NestJS), `prisma/` (Prisma — the schema is now Flyway's responsibility), `nest-cli.json`, `tsconfig.json`, `package.json`, `package-lock.json`, `jest.config.js`. **Updated**: `infrastructure/docker/Dockerfile` to multi-stage `eclipse-temurin:21-jdk` build, `docker-compose.yml`, `docker-compose.prod.yml`, `README.md`, `.github/` workflows.

**Reviewer must check**:
- All endpoints from §1 are implemented in Spring Boot (cross-reference against the table in §1; nothing missing).
- The reverse-proxy config (whatever's in front of the cluster) no longer routes any path to the NestJS service.
- `docker-compose up` starts only the Spring Boot service (and Postgres). No leftover `ceitba-api-dev` (Node) target.
- README's "Installation" and "Usage" sections are rewritten for Java/Maven. Old `npm` commands removed.
- `.env.example` no longer mentions Node-specific vars (`NODE_ENV` → removed; `ENABLE_CRON` → renamed to `SYNC_ENABLED` or kept with same semantics — pick one and document).
- CI runs `./mvnw verify` not `npm test`. Test stage uses Testcontainers (Docker-in-Docker or socket mount).
- `docs/MIGRATION-RUNBOOK.md` is updated with the deployment day instructions: `flyway baseline -baselineVersion=1` against prod, then deploy the JAR.

**Acceptance**: A fresh checkout, no Node installed, `./mvnw spring-boot:run` boots the full app. `docker-compose up` is green. `/api/docs` (or `/swagger-ui.html`) lists every endpoint. Smoke tests against the deployed staging environment pass for every endpoint.

**Decisions**:
- Hard cutover, not gradual: keeping both stacks alive past this point creates a maintenance tax with no upside. Once endpoint-parity is proven in staging, delete NestJS.
- Drop `prisma/` entirely. Flyway is the schema source of truth from this commit forward; keeping Prisma migrations as historical artifacts only invites confusion.

---

### PR 12 — Optional cleanup: remove unused interfaces, simplify

**Updated**: any `XxxService` interface that was ported defensively but has only one implementation gets inlined; OpenAPI annotations get reviewed for accuracy; any TODOs left from PR 6's "real subject name" placeholder are filed as Linear/GitHub issues with concrete owners.

**Reviewer must check**:
- After deletions, the import graph is the same or smaller. No accidentally-broken builds.
- The "rules" in §7 are followed across the codebase: no service-with-one-impl interface remains except `ItbaApiClient`.
- A `CONTRIBUTING.md` (or similar) is created from §8.

**Acceptance**: All tests still green. Class count drops measurably (track in PR description).

**Decisions**:
- Save this for a separate PR rather than mixing with cutover, so any "oh we did need that interface" surprises don't block the cutover landing.

---

## Quick reference: what stays similar from NestJS to Spring Boot

| NestJS concept | Spring Boot equivalent |
|---|---|
| `@Controller`, `@Get`/`@Post` | `@RestController`, `@GetMapping`/`@PostMapping` |
| `@Module` + DI | `@Configuration` + Spring's `ApplicationContext` (mostly automatic) |
| `@Injectable()` + constructor inject | `@Service` + constructor injection (no annotation needed on constructor) |
| `@Body`, `@Query`, `@Param` | `@RequestBody`, `@RequestParam`, `@PathVariable` |
| `class-validator` (`@IsString`, `@IsEmail`) | Bean Validation (`@NotBlank`, `@Email`) on records |
| `ValidationPipe` | Auto-active via `@Valid` on controller params |
| `PrismaService` | `EntityManager` (rarely used directly) + Spring Data repositories |
| `@nestjs/swagger` decorators | `springdoc-openapi` `@Operation`, `@ApiResponse` |
| `@Cron(...)` from `@nestjs/schedule` | `@Scheduled(cron = "...")` (six-field format) |
| Custom `DomainException` hierarchy | Same idea; sealed classes available in Java 21 |
| `@Inject(TOKEN)` provider tokens | Constructor injection by type; use `@Qualifier` if multiple beans |

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

One repo, five apps (the mobile app is a separate repo, `ceitba/CEITBApp`):

| Dir | What | Stack |
|---|---|---|
| `apps/api` | Backend for everything below | Spring Boot 3, Java 21, Postgres, Maven (not part of the JS workspace) |
| `apps/web` | Main CEITBA site + `/manage` staff admin (benefits, users, orgs), served at `/` | React 18 + Vite + TS |
| `apps/scheduler` | "Combinador de Horarios": schedule builder, saved schedules, share sessions, served at `/scheduler/` | React 18 + Vite + TS |
| `apps/newsletter` | Student newsletter (articles, events, org follows, admin area), served at `/newsletter/` | React 18 + Vite, **plain JS (JSX)** |
| `apps/mcp` | MCP server for AI assistants: stdio + Streamable HTTP with OAuth, served at `mcp.ceitba.org.ar/mcp` | Bun + TS, `@modelcontextprotocol/sdk` |
| `packages/scheduler-core` | Pure schedule generator shared by `apps/scheduler` and `apps/mcp` | TS (source-only package) |

`infra/caddy/` is the production reverse proxy. `docs/EDITORIAL_UI_SYSTEM.md` defines the shared warm/editorial
Tailwind look: read it before UI work in any web app.

**Release flow**: feature PRs merge into `dev` with real merge commits (`--no-ff`); one reviewed `dev → main` PR is
merged with a merge commit. Only `main` deploys. `.github/workflows/ci.yml` runs on PRs and `dev` pushes;
`deploy.yml` runs on `main`. Both use `dorny/paths-filter` to run only the apps a change touches (`packages/**`,
the root `package.json`/`bun.lock` and `.github/spa-apps.json` count for every web app). The API deploys before the
web apps in the same push. Keep actions pinned to commit SHAs.

---

## Web apps (bun workspaces)

From the repo root:
```
bun install
bun run dev                                  # all three apps
bun run --filter @ceitba/scheduler dev       # one app
bun run build | lint                         # all apps; build = tsc + vite build (newsletter: vite build only)
```
There is no JS test runner for the SPAs; lint + build is their only CI gate. `apps/mcp` and `packages/scheduler-core`
use `bun test` (`bun run test`). Copy each app's `.env.example` → `.env.local` and point it at a local API.

- **Hosting**: Caddy serves `/api/*` → API, `/ceitba-media/*` → MinIO, `/scheduler*` → `/var/www/scheduler`,
  `/newsletter*` → `/var/www/itbanews` (`/itbanews*` 301s to `/newsletter`), everything else → `/var/www/main`
  (web). All apps use `try_files … /index.html` fallback. Production build env lives in `.github/spa-apps.json`.
- **Base path**: `vite.config` sets `base` from `VITE_BASE_PATH`. The router basename must strip the trailing slash
  (`BASE_URL.replace(/\/+$/, '')`), otherwise opening the bare `/scheduler` or `/newsletter` renders a blank page.
- **Shared auth**: all apps authenticate against the API with an **HttpOnly session cookie** (the API-issued JWT).
  Login = redirect to `${API}/auth/google?redirect_uri=<VITE_GOOGLE_REDIRECT_URI>`; session = `GET /auth/me`;
  logout = `POST /auth/logout`. Apps never read/write tokens in JS; every fetch uses `credentials: 'include'`.
- **Client pattern**: each app has `src/api/client.ts|js` with `apiRequest`/`apiGet`/`apiSend` and an
  `ApiError(message, status, code)` built from the API's `{error, message}` body (the code is in `error`). Auth/prefs
  live in hand-rolled module-level stores (`src/store/authStore`, `prefsStore`). Theme/language sync to the user
  profile and are cached in `localStorage` (`prefs.theme`, `prefs.lang`).
- **API URL env differs per app**: web/newsletter use `VITE_API_URL` **including** `/api/v1`; scheduler uses
  `VITE_CEITBA_API_URL` as **origin only** and appends `/api/v1` itself.
- **i18n**: `i18next`/`react-i18next` with `src/locales/{es,en}.json` in every app.
- **web**: `src/pages/sections/` are the public home tabs; `src/pages/manage/` is the STAFF-only admin.
- **scheduler**: generation is a pure `generateSchedules(subjects, options, blockedTimes)` in
  `packages/scheduler-core` (re-exported by `src/services/scheduler.ts`, also used by `apps/mcp`; capped at
  `MAX_GENERATED_SCHEDULES`); `src/utils/ics.ts` builds calendar exports in
  `America/Argentina/Buenos_Aires`; `src/api/schedules.ts`/`share.ts` back saved schedules and share sessions.
- **newsletter**: the contributor/suggestion flow is a `localStorage` mock hidden behind
  `CONTRIBUTIONS_ENABLED = false` (`src/config/features.js`). Dates are `YYYY-MM-DD` strings: parse them with
  `src/utils/dates.js`, never `new Date(str)` (UTC → off by one day in Argentina).

---

## API (`apps/api`)

Run Maven from `apps/api`:
```
./mvnw -B -ntp verify                          # unit + integration tests (what CI runs; ITs need Docker)
./mvnw test -Dtest=ClassName#methodName        # single test
docker compose up -d                           # postgres + minio + api; health: /api/actuator/health, Swagger: /api/docs
```
`./scripts/mvn` runs Maven in an `eclipse-temurin:21-jdk` container when no JDK 21 is installed. If you pass
`-Dtest`, add `!*IT` (e.g. `'-Dtest=!*IT'` with `-Dsurefire.failIfNoSpecifiedTests=false`), otherwise Surefire also
runs every `*IT` class. Copy `.env.example` to `.env`; `AUTH_JWT_SECRET` is required, `ITBA_API_USE_FAKE=true` avoids
the upstream ITBA API.

Strict one-way layering under `src/main/java/org/ceitba/api/`:
`web/` (controllers, DTOs) → `service/` → `repository/` (Spring Data JPA) → `domain/` (JPA entities).
- Entities never leave `service/`; controllers return DTO records.
- Read-only service methods are `@Transactional(readOnly = true)`.
- Throw domain exceptions only, never `ResponseStatusException`; `GlobalExceptionHandler` maps them to HTTP.
- Composite primary keys use `@IdClass`.
- All calls to the upstream ITBA system go through `external/itba/ItbaApiClient`.

Auth: read `docs/AUTH-AND-ROLES.md` and `docs/AUTH-SETUP.md` before touching `SecurityConfig`, `web/auth/*` or
`service/auth/*`. Roles are `Anonymous`, `USER`, `STAFF`, `SYNC`. The API issues its own HS256 JWTs after a
server-side Google OAuth code exchange.

Database: Hibernate in `validate` mode; Flyway (`src/main/resources/db/migration/`) is the only schema tool. Two
schemas, `public` and `wiki`. Do not set `hibernate.jdbc.time_zone` (it shifts `LocalTime` columns; a guard test
enforces this).


User API keys (`ceitba_`, `X-Api-Key`) carry scopes `read`/`write`/`staff` (V54, `ApiKeyScope`, enforced in
`ApiKeyFilter`); see `docs/AUTH-SETUP.md` § Scopes. New DDL migrations need a test mirror in
`src/test/resources/db/test-migration/` and a bump of `spring.flyway.target` (see its README).

---

## MCP server (`apps/mcp`)

Read `apps/mcp/README.md`. Tools live in `src/tools/*` and are declared with `defineTool` (access: public, user,
staff or moderator; plus `write` and `capability`). Sessions only list the tools they can use. Students are read-only:
`write` tools must be staff or moderator tools. Descriptions are Spanish first, then `EN:`. Return compact,
trimmed JSON (`src/trim.ts`), never raw API payloads. Hosted mode is stateless Streamable HTTP and acts as its own
OAuth 2.1 server. It bridges Google sign-in through `POST /v1/auth/google/mobile` and stores only an encrypted,
scoped API key per login (`src/oauth/provider.ts`). Tests (`bun test`) run against an in-process fake API
(`test/fakeApi.ts`).

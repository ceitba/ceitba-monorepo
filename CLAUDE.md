# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

One repo, two apps (the mobile app is a separate repo, `ceitba/CEITBApp`):

| Dir | What | Stack |
|---|---|---|
| `apps/api` | Backend for everything below | Spring Boot 3, Java 21, Postgres, Maven (not part of the JS workspace) |
| `apps/web` | The whole frontend, one SPA: main site + `/manage` staff admin + Apuntes at `/`, the "Combinador de Horarios" at `/scheduler`, the student newsletter at `/newsletter` | React 18 + Vite + TS |

`infra/caddy/` is the production reverse proxy. `docs/EDITORIAL_UI_SYSTEM.md` defines the shared warm/editorial
Tailwind look: read it before UI work. Build UI from the shared kit in `apps/web/src/components/ui` (buttons,
fields, tabs, toggles, badges, alerts, toasts, skeletons, empty/error states; `Modal`/`ConfirmDialog`) instead of
hand-rolling markup, and keep one navigation bar per page (§6 "Navigation depth").

**Release flow**: feature PRs merge into `dev` with real merge commits (`--no-ff`); one reviewed `dev → main` PR is
merged with a merge commit. Only `main` deploys. `.github/workflows/ci.yml` runs on PRs and `dev` pushes;
`deploy.yml` runs on `main`. Both use `dorny/paths-filter` to run only the apps a change touches (`packages/**`,
the root `package.json`/`bun.lock` and `.github/spa-apps.json` count for web). The API deploys before the web app in
the same push. Keep actions pinned to commit SHAs.

---

## Web app (`apps/web`, bun workspace)

From the repo root:
```
bun install
bun run dev                                  # Vite dev server, :5173
bun run build | lint                         # build = tsc (app + workers) + vite build
```
There is no JS test runner; lint + build is the only CI gate. Copy `apps/web/.env.example` → `.env.local` and point
it at a local API.

One SPA, one router (a data router, so pages can use `useBlocker`), one shell. Layout:
- `src/` root: the shared core and the main site. `api/client.ts` (`apiRequest`/`apiGet`/`apiSend`, `ApiError(message,
  status, code, data)` from the API's `{error, message}` body, the code is in `error`; network failures throw
  `NETWORK_ERROR`), `store/authStore.ts` + `prefsStore.ts` (hand-rolled module-level stores), `context/ThemeContext`,
  `components/` (`Navbar`, `Footer`, `AuthMenu`, `SectionHeader`), `pages/sections/` (public home tabs),
  `pages/manage/` (STAFF-only admin), `pages/apuntes/`.
- `src/scheduler/`: the "Combinador de Horarios", lazily mounted at `/scheduler/*` (`SchedulerApp.tsx`).
- `src/newsletter/`: the student newsletter, lazily mounted at `/newsletter/*` (`NewsletterApp.tsx`); its admin
  dashboard (`/newsletter/admin/*`) keeps its own full-screen chrome instead of the app shell.

Rules for the sections:
- Route paths inside a section are relative to its mount point, but `Link`/`navigate()` take absolute paths: build
  them with `schedulerPath('/saved')` / `newsletterPath('/events')` (`<section>/paths.ts`).
- Each section's strings are its own i18n namespace (`scheduler`, `newsletter`), added lazily from
  `<section>/locales/` and made the default for its subtree with `I18nextProvider defaultNS`. Shared components
  render outside that provider and use the default `translation` namespace (`src/locales/`).
- Shared modules come from `@/` (= `src/`). Don't add a per-section API client, auth store or theme handling.
- The newsletter's dark-mode remaps of plain `bg-white`/`border-border` are scoped to `.newsletter-scope`; elsewhere
  use `dark:` variants with the `night-*` tokens.

- **Hosting**: Caddy serves `/api/*` → API, `/ceitba-media/*` → MinIO, `/itbanews*` 301s to `/newsletter`,
  everything else → `/var/www/main` with `try_files … /index.html`. Production build env lives in
  `.github/spa-apps.json`. `/var/www/scheduler` and `/var/www/itbanews` (the old standalone builds) are no longer
  served.
- **Auth**: an **HttpOnly session cookie** (the API-issued JWT). Login = redirect to
  `${API}/auth/google?redirect_uri=<VITE_GOOGLE_REDIRECT_URI>` (`/auth/callback`; the old apps' callbacks
  `/scheduler/auth/callback` and `/newsletter/admin/callback` are still routed); the page to come back to travels in
  sessionStorage (`startGoogleSignIn(returnTo)`). Session = `GET /auth/me`; logout = `POST /auth/logout`. Never
  read/write tokens in JS; every fetch uses `credentials: 'include'`. Theme/language sync to the user profile and are
  cached in `localStorage` (`prefs.theme`, `prefs.lang`).
- `VITE_API_URL` **includes** `/api/v1`.
- **scheduler**: generation is a pure `generateSchedules(subjects, options, blockedTimes)` in `services/` (capped at
  `MAX_GENERATED_SCHEDULES`, run in a Web Worker); `utils/ics.ts` builds calendar exports in
  `America/Argentina/Buenos_Aires`; `api/schedules.ts`/`share.ts` back saved schedules and share sessions.
- **newsletter**: API shapes are in `newsletter/types.ts`. The contributor/suggestion flow is a `localStorage` mock
  hidden behind `CONTRIBUTIONS_ENABLED = false` (`config/features.ts`). Dates are `YYYY-MM-DD` strings: parse them
  with `utils/dates.ts`, never `new Date(str)` (UTC → off by one day in Argentina).
- **Lint**: the React Compiler rules of `eslint-plugin-react-hooks` 7 are enforced in `src/scheduler/` only so far
  (see `eslint.config.js`).

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

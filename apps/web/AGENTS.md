# apps/web: agent rules

The whole frontend, one SPA: the main site + `/manage` staff admin + Apuntes at `/`, the "Combinador de Horarios"
at `/scheduler`, the student newsletter at `/newsletter`. React 18 + Vite + TypeScript. UI follows
`docs/EDITORIAL_UI_SYSTEM.md` (binding; read it before UI work).

## Commands (repo root)

```
bun install
bun run dev                                  # Vite dev server, :5173
bun run build | lint                         # build = tsc (app + workers) + vite build; lint --max-warnings 0
```

There is no JS test runner: lint + build is the whole CI gate. Copy `apps/web/.env.example` → `.env.local` and point
it at a local API. `VITE_API_URL` **includes** `/api/v1`. Production build env is in `.github/spa-apps.json`.

## Layout

One router (a data router, so pages can use `useBlocker`), one shell (`Navbar`, `Footer`, `AuthMenu`).

- `src/` root: the shared core and the main site. `api/client.ts` (`apiRequest`/`apiGet`/`apiSend`,
  `ApiError(message, status, code, data)` from the API's `{error, message}` body, the code is in `error`; network
  failures throw `NETWORK_ERROR`), `store/authStore.ts` + `prefsStore.ts` (hand-rolled module-level stores),
  `context/ThemeContext`, `components/`, `pages/sections/` (public home tabs), `pages/manage/` (STAFF-only admin),
  `pages/apuntes/`. Guards: `AuthGuard`, `StaffGuard`, `CapabilityGuard` (`apps/api/docs/CAPABILITIES.md`).
- `src/scheduler/`: the scheduler section, lazily mounted at `/scheduler/*` (`SchedulerApp.tsx`).
- `src/newsletter/`: the newsletter section, lazily mounted at `/newsletter/*` (`NewsletterApp.tsx`); its admin
  dashboard (`/newsletter/admin/*`) keeps its own full-screen chrome instead of the app shell.

## Section rules

- Route paths inside a section are relative to its mount point, but `Link`/`navigate()` take absolute paths: build
  them with `schedulerPath('/saved')` / `newsletterPath('/events')` (`<section>/paths.ts`).
- Shared modules come from `@/` (= `src/`). Don't add a per-section API client, auth store or theme handling;
  feature API modules sit next to their section (`src/scheduler/api/*.ts`) on top of `@/api/client`.
- The newsletter's dark-mode remaps of plain `bg-white`/`border-border` are scoped to `.newsletter-scope`; elsewhere
  use `dark:` variants with the `night-*` tokens.
- Lint: the React Compiler rules of `eslint-plugin-react-hooks` 7 are enforced in `src/scheduler/` only so far
  (`eslint.config.js`). New sections should opt in.

## i18n

`i18next`/`react-i18next`. Every user-facing string goes through `t()`; Spanish is the primary locale and every
`es`/`en` pair keeps the same keys (the `i18n-key` skill; `scripts/checks/locales.mjs` checks it).

| Namespace | Files |
|---|---|
| `translation` (default; shared components) | `src/locales/{es,en}.json` |
| Apuntes | `src/locales/apuntes.{es,en}.json` (loaded by `src/i18nApuntes.ts`) |
| `scheduler` | `src/scheduler/locales/{es,en}.json` |
| `newsletter` | `src/newsletter/locales/{es,en}.json` |

Section namespaces are added lazily and made the default for the subtree with `I18nextProvider defaultNS`; shared
components render outside that provider and use `translation`. Dates format with `es-AR` / `en-US`.

## Auth and prefs

HttpOnly session cookie (the API-issued JWT). Login = redirect to
`${API}/auth/google?redirect_uri=<VITE_GOOGLE_REDIRECT_URI>` (`/auth/callback`; the old callbacks
`/scheduler/auth/callback` and `/newsletter/admin/callback` are still routed); the page to come back to travels in
sessionStorage (`startGoogleSignIn(returnTo)`). Session = `GET /auth/me`; logout = `POST /auth/logout`. Never
read/write tokens in JS; every fetch uses `credentials: 'include'`. Theme/language sync to the user profile and are
cached in `localStorage` (`prefs.theme`, `prefs.lang`).

## Section notes

- **scheduler**: generation is the pure `generateSchedules(subjects, options, blockedTimes)` in `services/` (capped
  at `MAX_GENERATED_SCHEDULES`, run in a Web Worker, `workers/` + `tsconfig.worker.json`): keep it free of fetches,
  stores and DOM. `utils/ics.ts` builds calendar exports in `America/Argentina/Buenos_Aires`;
  `api/schedules.ts`/`share.ts` back saved schedules and share sessions, `api/corrections.ts` schedule corrections.
  English has ordinal plural keys (`_ordinal_one`, ...) that Spanish does not need.
- **newsletter**: API shapes are in `newsletter/types.ts`. The contributor/suggestion flow is a `localStorage` mock
  hidden behind `CONTRIBUTIONS_ENABLED = false` (`config/features.ts`; `apps/api/docs/SPA-MIGRATION.md` is the plan to
  move it onto the API). Dates are `YYYY-MM-DD` strings: parse them with `utils/dates.ts`, never `new Date(str)`
  (UTC → off by one day in Argentina).

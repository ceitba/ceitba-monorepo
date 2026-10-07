# Web apps: shared rules (web, scheduler, newsletter)

Read before changing any of the three SPAs. App-specific rules are in `apps/<app>/AGENTS.md`; the visual system is
`docs/EDITORIAL_UI_SYSTEM.md`.

## Workspace

Bun workspaces from the repo root: `bun install`, `bun run dev|build|lint`, `--filter @ceitba/<app>` for one app.
There is no JS test runner: lint (`--max-warnings 0`) + production build is the whole gate, so keep both green.
Copy each app's `.env.example` → `.env.local` and point it at a local API. Lockfile: `bun.lock` changes only through
`bun install`/`bun add`.

## Patterns every app follows

- **Base path**: `vite.config` sets `base` from `VITE_BASE_PATH`. The router basename strips the trailing slash
  (`BASE_URL.replace(/\/+$/, '')`), otherwise the bare `/scheduler` or `/newsletter` renders a blank page.
- **API client**: `src/api/client.ts|js` exports `apiRequest`/`apiGet`/`apiSend` and `ApiError(message, status,
  code)` built from the API's `{error, message}` body (the code is in `error`). Feature modules in `src/api/` call
  these; components never call `fetch` directly. Every request sends `credentials: 'include'`.
- **API URL env differs per app**: web/newsletter `VITE_API_URL` **includes** `/api/v1`; scheduler
  `VITE_CEITBA_API_URL` is the **origin only**.
- **State**: auth/prefs live in hand-rolled module-level stores (`src/store/authStore`, `prefsStore`). Theme and
  language sync to the user profile and are cached in `localStorage` (`prefs.theme`, `prefs.lang`).
- **i18n**: `i18next`/`react-i18next` with `src/locales/{es,en}.json`. Every user-facing string goes through `t()`;
  Spanish is the primary locale and both files keep the same keys (the `i18n-key` skill). Dates format with
  `es-AR` / `en-US`.
- **Production env** for each app is in `.github/spa-apps.json` (the `spa-app` skill adds a new app).

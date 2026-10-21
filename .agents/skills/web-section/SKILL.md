---
name: web-section
description: "Add a new section to the web app (a lazily mounted area like /scheduler or /newsletter), or change where the web app is served: router mount, paths helper, i18n namespace, Caddy route and build env. Use when creating apps/web/src/<section> or changing a base path, www dir or production env."
---

# Add a web section (or move where the app is served)

The frontend is one SPA (`apps/web`); a product area is a **section**: a folder under `apps/web/src/` lazily
mounted at `/<section>/*`. Copy the shape of `src/scheduler/` (`SchedulerApp.tsx`, `paths.ts`, `locales/`). Rules
are in `apps/web/AGENTS.md`.

## Steps

1. **Folder**: `apps/web/src/<section>/` with `<Section>App.tsx` (the section's routes, relative to its mount) and
   `paths.ts` exporting `<section>Path(sub)` for absolute links.
2. **Mount**: add a lazy route `/<section>/*` in `src/App.tsx` next to the scheduler and newsletter ones, inside the
   shared shell unless the section needs full-screen chrome (like `/newsletter/admin/*`).
3. **i18n**: `src/<section>/locales/{es,en}.json` as the `<section>` namespace, registered lazily in
   `src/<section>/i18n<Section>.ts` and set as the subtree default with `I18nextProvider defaultNS` (copy
   `src/scheduler/i18nScheduler.ts` and `SchedulerApp.tsx`). Navbar labels go in `src/locales/` (`translation`).
4. **Shared core only**: `@/api/client`, `@/store/authStore`, `@/store/prefsStore`, `ThemeContext`. Feature API
   modules go in `src/<section>/api/`. No per-section client, auth store or theme handling.
5. **Navigation**: add the section link to the `SECTIONS` list in `src/components/Navbar.tsx` (with `capability` if gated) (label key in
   `src/locales/`).
6. **Lint**: keep the React Compiler rules on for the new folder: add it to the `ignores` of the block in
   `eslint.config.js` that turns them off for the rest of `src/` (where `src/scheduler/**` already is).
7. **Living docs**: a new feature area gets a doc and a `docs/agents/spec-map.json` entry (`spec-sync`); update the
   section list in `apps/web/AGENTS.md` and the app table in `AGENTS.md`/`README.md`.
8. **Verify**: `bun run lint` and `bun run build` from the root; open `/<section>` and a deep link with the dev
   server (deep links rely on the `try_files … /index.html` fallback).

Done when the section loads lazily at `/<section>`, deep links and absolute links work, and lint + build are green.

## Changing where the app is served

Caddy (`infra/caddy/Caddyfile`) serves the build from `/var/www/main` with a `try_files {path} /index.html` fallback;
the build env (`VITE_BASE_PATH`, `VITE_API_URL`, `VITE_GOOGLE_REDIRECT_URI`) is in `.github/spa-apps.json`, from which
CI and deploy build their matrix. A new redirect origin must be in `SAFE_REDIRECT_ORIGINS`
(`apps/api/src/features/auth/redirects.ts`) and, if cross-origin, `CORS_ALLOWED_ORIGINS` in `apps/api/src/http/security.ts`:
route those to the `security-reviewer` subagent. Caddy changes restart Caddy on deploy and must ship in a release
*after* the build they point at is live: list that ordering in the PR body.

A separate app under `apps/<new>` (rare) also needs a `workspaces` entry in the root `package.json`, an entry in
`spa-apps.json`, and an `<app>:` block in the `dorny/paths-filter` filters of both `ci.yml` and `deploy.yml` (plus the
manual-run list in `deploy.yml`).

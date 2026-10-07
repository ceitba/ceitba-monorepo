---
name: spa-app
description: "Add a new web app (SPA) to the monorepo or change where an existing one is served: workspace, CI/deploy wiring, Caddy route and production env. Use when creating apps/<new-app> or changing an app's base path, www dir or build env."
---

# Add or move a web app

A web app is wired in six places; CI derives its matrix from `.github/spa-apps.json`, but the path filters are
written out by hand in both workflows.

## Steps

1. **App**: `apps/<app>/` with `package.json` named `@ceitba/<app>` and `dev`/`build`/`lint` scripts
   (`lint` uses `--max-warnings 0`). Copy the setup of `apps/scheduler` (TS) or `apps/newsletter` (JS): `vite.config`
   `base` from `VITE_BASE_PATH`, router basename `BASE_URL.replace(/\/+$/, '')`, `src/api/client`, `src/store`,
   `src/locales/{es,en}.json`, Tailwind config from `docs/EDITORIAL_UI_SYSTEM.md` §15–16, `.env.example`,
   `AGENTS.md` + `CLAUDE.md` (`@AGENTS.md`).
2. **Workspace**: add `apps/<app>` to `workspaces` in the root `package.json`, then `bun install` to update
   `bun.lock`.
3. **Build env**: add `{app, package, dir, www, env}` to `.github/spa-apps.json` with the production
   `VITE_BASE_PATH`, API URL and `VITE_GOOGLE_REDIRECT_URI`.
4. **Path filters**: add an `<app>:` block (`apps/<app>/**` + `*shared`) to the `dorny/paths-filter` filters in
   **both** `.github/workflows/ci.yml` and `deploy.yml`, and add the app to the manual-run list
   (`'["web","scheduler","newsletter"]'`) in `deploy.yml`.
5. **Caddy**: add the route to `infra/caddy/Caddyfile` (`handle_path`/`handle` with `try_files {path} /index.html`
   fallback) before the catch-all, serving `/var/www/<www>`. The VPS directory must exist before the first deploy:
   note that in the PR body.
6. **OAuth**: the new `VITE_GOOGLE_REDIRECT_URI` must be on an origin in `SAFE_REDIRECT_ORIGINS`
   (`apps/api/src/main/java/org/ceitba/api/web/auth/AuthController.java`), otherwise login falls back to
   `FRONTEND_URL`. Same origin as the site needs no change; a new origin also needs CORS (`SecurityConfig`) and
   goes to the `security-reviewer` subagent.
7. **Docs**: app table in `README.md` and `AGENTS.md`, hosting line in `AGENTS.md`.
8. **Verify**: `bun install --frozen-lockfile`, `bun run --filter @ceitba/<app> lint` and `build` with the env from
   step 3; `jq . .github/spa-apps.json`.

Done when CI builds the app from a PR touching only `apps/<app>/**` and every manual step is listed in the PR body.

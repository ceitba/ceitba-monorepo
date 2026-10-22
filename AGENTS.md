# AGENTS.md

Canonical instructions for every coding agent in this repo (Claude Code, Codex, Kiro, Cursor, Copilot, ...).
`CLAUDE.md` files only import this one. Each app has its own `apps/<app>/AGENTS.md` with app rules: read it
before changing that app.

## Repository layout

One repo, three apps (the mobile app is a separate repo, `ceitba/CEITBApp`):

| Dir | What | Stack |
|---|---|---|
| `apps/api` | Backend for everything below | Bun + TS, Hono, Drizzle, zod, Postgres 16 + pgvector (`@ceitba/api`; a Spring Boot app until 2026, `docs/adr/0004-api-runs-on-bun.md`) |
| `apps/web` | The whole frontend, one SPA: main site + `/manage` staff admin + Apuntes at `/`, the "Combinador de Horarios" at `/scheduler`, the student newsletter at `/newsletter` | React 18 + Vite + TS |
| `apps/mcp` | MCP server for AI assistants: stdio + Streamable HTTP with OAuth, served at `/mcp` (plus `/.well-known/*/mcp`) | Bun + TS, `@modelcontextprotocol/sdk` |
| `packages/scheduler-core` | Pure schedule generator shared by `apps/web` (scheduler) and `apps/mcp` | TS (source-only package) |

`infra/caddy/` is the production reverse proxy. Domain vocabulary is in `GLOSSARY.md`; lasting decisions are in
`docs/adr/`.

## Workflow (spec-driven)

Read `docs/agents/workflow.md` before starting any feature, schema change, auth/security change or change that
spans more than one app: it says when a spec is required and which skills run in which order. The short version:
decide first (`/grill-with-docs`), record the decision (`/to-spec` issue for multi-session work), build test-first
(`/implement`, `/tdd`), review (`/code-review` + the reviewer subagents), then keep the **living docs** in sync
(`spec-sync` skill) in the same PR.

**Living docs** are the specs that stay true after merge: `docs/*.md`, `apps/*/docs/*.md` and the app READMEs.
`docs/agents/spec-map.json` maps code paths to the doc that describes them. Any change to behaviour (bug fixes
included) updates the mapped doc in the same PR, or the PR states "No spec impact" with a reason.

## Git, commits and PRs

- Branch from `main` (`feat/…`, `fix/…`, `chore/…`, `docs/…`); PRs target `main`. Never commit or push to `main`
  directly. A reviewed PR merges through the merge queue with a merge commit (see CI), and every merge into `main`
  deploys what it changed: before queueing one, a human runs `/release` (the `release` skill) for its deploy risks. There is no `dev`
  branch on the remote; the `dev` conditions left in hooks and workflows are inert.
- Commits and PR titles follow Conventional Commits: `type(scope): imperative summary`. Types: `feat`, `fix`,
  `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`. Scopes are the app or area:
  `api`, `web`, `scheduler`, `newsletter`, `infra`, `ci`, `deps`, `agents`, or a feature area (`wiki`, `digest`,
  `apuntes`, ...). `scripts/checks/commit-msg.mjs` is the source of truth.
- PR bodies follow the `pr` skill: Summary, Evidence, Merge Danger, plus the living-docs status.
- Guardrails are enforced, not advisory: lefthook git hooks (`lefthook.yml`, installed by `bun install`) and agent
  hooks (`.claude/settings.json`, `.codex/hooks.json`, `.kiro/hooks/`, all calling `scripts/agent-hooks/`) block
  pushes to `main`/`dev`, `--no-verify`, force pushes, edits to merged migrations, env files, `bun.lock` and
  generated agent files, and run the repo checks before an agent stops. When a hook blocks you, fix the cause.

## CI

`main` merges go through GitHub's **merge queue** (ruleset "PRs & conventional commits"): "Merge when ready" queues an
approved PR, the queue runs `ci.yml` on the PR merged with the latest `main` (the API tests run there when the API
changed) and merges it with a merge commit only if the single required check, `ci-ok`, passes. `ci-ok` passes when
every `ci.yml` job passed or was skipped, so path-filtered jobs never block by not reporting; a new `ci.yml` job
must be added to its `needs`.

`.github/workflows/ci.yml` runs on PRs and the merge queue; `deploy.yml` runs on `main`. Both use `dorny/paths-filter`
to run only what a change touches (`packages/**`, the root `package.json`/`bun.lock` and `.github/spa-apps.json`
count for web and MCP). The API runs on `apps/api/**` or `infra/**`, and on a root `package.json`/`bun.lock` change
only when `scripts/checks/api-deps-changed.mjs` says the production dependency closure of `@ceitba/api` changed (a
web-only dependency bump neither tests nor redeploys it; `apps/api/docs/DEPLOY.md`). The API deploys before the web app and the MCP server in the same push. Keep actions pinned to full commit SHAs with a
`# vX.Y.Z` comment. `pr-checks.yml` runs on every PR: the repo checks, the Conventional Commits PR title, the
living-docs check against the PR body and a gitleaks scan. Dependabot (`.github/dependabot.yml`) opens weekly
version updates against `main`.

## Cross-app rules

- **Specs and docs are written in English** unless a doc says otherwise. Only UI copy is bilingual (es/en).
- **UI work**: read `docs/EDITORIAL_UI_SYSTEM.md` first. It is binding. Build UI from the shared kit in
  `apps/web/src/components/ui` instead of hand-rolling markup, and keep one navigation bar per page (§6 "Navigation
  depth").
- **Auth**: the web app authenticates against the API with an **HttpOnly session cookie** (the API-issued JWT);
  JS never reads or writes tokens and every fetch uses `credentials: 'include'`. Details in `apps/web/AGENTS.md`;
  the mobile app uses the token endpoints in `apps/api/docs/AUTH-SETUP.md`.
- **Hosting**: Caddy serves `/api/*` → the healthy API color (blue/green, `apps/api/docs/DEPLOY.md`), `/ceitba-media/*` → MinIO, `/mcp`, `/mcp/*` and
  `/.well-known/{oauth-protected-resource,oauth-authorization-server,openid-configuration}/mcp` → MCP server,
  `/itbanews*` 301s to `/newsletter`, link-preview crawlers (WhatsApp, Telegram, Slack…) asking for
  `/newsletter/articles/{id}` → the API's Open Graph page (`GET /v1/articles/{id}/preview`),
  `/sitemap.xml` → the API (`GET /v1/articles/sitemap.xml`: newsletter home, published articles, the events list + events; `robots.txt` is a static file in `apps/web/public`),
  everything else → `/var/www/main` with `try_files … /index.html`. `/var/www/scheduler` and `/var/www/itbanews`
  (the old standalone builds) are no longer served. Production build env lives in `.github/spa-apps.json`.
- **Migrations are expand/contract** (zero-downtime deploys): during a deploy the old API image keeps serving
  against the schema the new one just migrated. Additive changes (new tables, nullable or defaulted columns,
  indexes) ship with the code that uses them; `DROP`, `RENAME`, `NOT NULL` on existing columns and type changes
  ship one release later, once no deployed code uses the old shape. Details in `apps/api/docs/DEPLOY.md`.
- **Scheduled jobs run in one process at a time**: every new job in a feature's `jobs.ts` takes a `JobLock` with a
  new, never-reused id in `apps/api/src/jobs/joblock.ts` (`apps/api/docs/DEPLOY.md` "Scheduled jobs").
- **Secrets** never enter the repo: `.env`/`.env.local` stay local, `.env.example` gets placeholders only.
  `.gitleaks.toml` is the scanner config; rotate a leaked secret rather than allowlisting it.

## Commands

```
bun install                                  # every workspace's deps + git hooks (repo root)
bun run dev | build | lint                   # the web app (apps/web), apps/api, apps/mcp and packages/*
bun run test                                 # bun test in apps/api (needs Docker), apps/mcp and packages/scheduler-core
cd apps/api && bun contract/run.ts           # API contract suite against a real server (needs Docker)
bun run check                                # repo checks: locales, migrations, workflows, agents, living docs
bun run agents:sync                          # regenerate per-tool subagent files from .agents/agents/
```

The bun version is pinned once, in `packageManager` of the root `package.json`; CI reads it from there.

## Agent skills

Skills live in `.agents/skills/` (symlinked into `.claude/skills/` and `.kiro/skills/`). Community skills come
from `mattpocock/skills` (pinned in `skills-lock.json`, update with `npx skills update`); project skills are
`flyway-migration`, `api-endpoint`, `i18n-key`, `web-section`, `kb-wiki`, `release` and `spec-sync`. Reviewer
subagents are defined once in `.agents/agents/` and generated for each tool by `node scripts/agents/sync.mjs`.

### Issue tracker

GitHub Issues on `ceitba/ceitba-monorepo`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

# AGENTS.md

Canonical instructions for every coding agent in this repo (Claude Code, Codex, Kiro, Cursor, Copilot, ...).
`CLAUDE.md` files only import this one. Each app has its own `apps/<app>/AGENTS.md` with app rules: read it
before changing that app.

## Repository layout

One repo, two apps (the mobile app is a separate repo, `ceitba/CEITBApp`):

| Dir | What | Stack |
|---|---|---|
| `apps/api` | Backend for everything below | Spring Boot 3, Java 21, Postgres, Maven (not part of the JS workspace) |
| `apps/web` | The whole frontend, one SPA: main site + `/manage` staff admin + Apuntes at `/`, the "Combinador de Horarios" at `/scheduler`, the student newsletter at `/newsletter` | React 18 + Vite + TS |

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

- Branch from `dev` (`feat/…`, `fix/…`, `chore/…`, `docs/…`); PRs target `dev`. Never commit or push to `main`
  or `dev` directly. Feature PRs merge into `dev` with real merge commits (`--no-ff`); one reviewed `dev → main`
  PR is merged with a merge commit. Only `main` deploys.
- Commits and PR titles follow Conventional Commits: `type(scope): imperative summary`. Types: `feat`, `fix`,
  `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`. Scopes are the app or area:
  `api`, `web`, `scheduler`, `newsletter`, `infra`, `ci`, `deps`, `agents`, or a feature area (`wiki`, `digest`,
  `apuntes`, ...).
- PR bodies follow the `pr` skill: Summary, Evidence, Merge Danger, plus the living-docs status.

## CI

`.github/workflows/ci.yml` runs on PRs and `dev` pushes; `deploy.yml` runs on `main`. Both use `dorny/paths-filter`
to run only what a change touches (`packages/**`, the root `package.json`/`bun.lock` and `.github/spa-apps.json`
count for web). The API deploys before the web app in the same push. Keep actions pinned to full commit SHAs with a
`# vX.Y.Z` comment.

## Cross-app rules

- **Specs and docs are written in English** unless a doc says otherwise. Only UI copy is bilingual (es/en).
- **UI work**: read `docs/EDITORIAL_UI_SYSTEM.md` first. It is binding.
- **Auth**: the web app authenticates against the API with an **HttpOnly session cookie** (the API-issued JWT);
  JS never reads or writes tokens and every fetch uses `credentials: 'include'`. Details in `apps/web/AGENTS.md`;
  the mobile app uses the token endpoints in `apps/api/docs/AUTH-SETUP.md`.
- **Hosting**: Caddy serves `/api/*` → API, `/ceitba-media/*` → MinIO, `/itbanews*` 301s to `/newsletter`,
  everything else → `/var/www/main` with `try_files … /index.html`. Until the Caddy cutover ships (it must land in a
  release *after* the merged app is live), `/scheduler*` and `/newsletter*` still serve the old standalone builds
  from `/var/www/scheduler` and `/var/www/itbanews`. Production build env lives in `.github/spa-apps.json`.
- **Secrets** never enter the repo: `.env`/`.env.local` stay local, `.env.example` gets placeholders only.
  `.gitleaks.toml` is the scanner config; rotate a leaked secret rather than allowlisting it.

## Commands

```
bun install                                  # web deps (repo root)
bun run dev | build | lint                   # the web app (apps/web)
cd apps/api && ./mvnw -B -ntp verify         # API unit + integration tests (needs Docker)
node scripts/agents/sync.mjs [--check]       # regenerate per-tool subagent files from .agents/agents/
```

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

# Contributing

## Flow

1. Find or open an issue. Features, schema changes, auth changes and cross-app changes need a spec issue first
   (`docs/agents/workflow.md` explains when and how; coding agents run it with the bundled skills).
2. Branch from `dev`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
3. Commit with Conventional Commits: `type(scope): imperative summary`, e.g. `fix(scheduler): keep blocked times
   on reload`. Scopes: `api`, `web`, `scheduler`, `newsletter`, `infra`, `ci`, `deps`, `agents` or a feature area.
4. Open the PR into `dev` with a Conventional Commits title and the PR template filled in. Update the living docs
   (`docs/agents/spec-map.json`) in the same PR, or explain why there is no spec impact.
5. Feature PRs merge into `dev` with a merge commit. Releases are one reviewed `dev` → `main` PR; every push to
   `main` deploys the apps it changed.

## Local checks

`bun install` at the root installs the git hooks (lefthook):

| Hook | Runs |
|---|---|
| pre-commit | gitleaks on staged changes (if installed: `brew install gitleaks`), ESLint on staged SPA files, and the repo checks matching the staged files |
| commit-msg | Conventional Commits (`scripts/checks/commit-msg.mjs`) |
| pre-push | `bun run check` (locales, migrations, workflows, agents; living docs as a warning) |

CI runs the same scripts, so skipping a hook only moves the failure to the PR. The API tests are not in a hook
(they need Docker and take minutes): run `./mvnw -B -ntp verify` in `apps/api` before pushing API changes.

## PR checks

`.github/workflows/pr-checks.yml` runs on every PR (and when its title or body is edited): the repo checks above,
the PR title as a Conventional Commit, the living-docs check (into `dev` only; tick "No spec impact" with a reason
in the template to opt out) and a gitleaks scan of the PR's commits. `ci.yml` still runs lint + build for touched
web apps and the API tests. Dependabot opens grouped weekly updates against `dev`; security updates go to `main`.

## Coding standards

These are the standards sources reviews (human and `/code-review`) check against:

- `AGENTS.md`: cross-app rules (auth, hosting, secrets, CI pinning, docs language).
- `apps/api/AGENTS.md`: API layering, exceptions, transactions, Flyway, tests.
- `docs/agents/web-apps.md` and `apps/<app>/AGENTS.md`: SPA patterns (API client, stores, i18n, base path).
- `docs/EDITORIAL_UI_SYSTEM.md`: the binding UI system for every web app.
- `GLOSSARY.md`: names for domain concepts in code, UI copy and docs.
- `docs/adr/`: decisions that new code must not silently contradict.

## Working with coding agents

Any agent works: rules live in `AGENTS.md` (Claude Code reads them through `CLAUDE.md`). Skills are in
`.agents/skills/` and reviewer subagents in `.agents/agents/`; see `AGENTS.md` → "Agent skills".

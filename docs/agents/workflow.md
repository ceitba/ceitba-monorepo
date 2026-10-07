# Workflow: spec-driven development

How work moves from idea to merged PR in this repo. The skills named here are in `.agents/skills/`; `/ask-matt`
routes you when unsure. Decisions behind this flow: `docs/adr/0002-living-docs-are-the-specs.md`.

## Does this change need a spec?

A **spec** (a GitHub issue written by `/to-spec`, labelled `spec`) is required for:

- a new feature or a new user-visible behaviour,
- a schema change (new Flyway migration with DDL),
- an auth, roles, `SecurityConfig` or permission change,
- a change spanning more than one app (e.g. API endpoint + SPA screen).

Exempt: bug fixes, refactors without behaviour change, chores, dependency bumps, CI, docs-only changes. Exempt work
still keeps the living docs in sync (below).

When the work fits one agent session, the grilling notes plus the PR body are enough: skip `/to-spec` and go
straight to `/implement`, but link or create an issue that records the decision.

## Flows

**Feature (spec required):**

1. `/grill-with-docs`: settle the design; it updates `GLOSSARY.md` and writes ADRs for lasting decisions.
2. `/to-spec`: publish the decisions as a spec issue. Multi-session work: `/to-tickets` cuts it into tracer-bullet
   tickets (sub-issues with blocking edges).
3. Branch from `dev` (`feat/<slug>`), then `/implement` the spec or one ticket. It works test-first via `/tdd` at the
   seams agreed in the spec.
4. Use the project skills where they apply: `flyway-migration`, `api-endpoint`, `i18n-key`, `spa-app`.
5. Review: `/code-review` against `dev`, plus the reviewer subagents that match the diff (`api-architecture-reviewer`
   for `apps/api`, `migration-reviewer` for migrations, `security-reviewer` for auth/permissions/secrets,
   `ui-reviewer` for SPA UI). Fix findings before opening the PR.
6. `spec-sync`: update the living docs for the behaviour you changed.
7. `/pr`: write the PR body (template in `.github/pull_request_template.md`), PR into `dev`, `Closes #<ticket>`.

**Bug:** `/diagnosing-bugs` (reproduce, minimise, regression test first) → fix → `spec-sync` (a fix that changes
documented behaviour updates the doc; a fix that makes code match the doc says so) → `/pr`.

**Large or foggy work:** `/wayfinder` to map decisions across sessions, then `/to-spec #<map>`.

**Release:** the `release` skill (`dev` → `main` PR).

## Living docs

The spec issue is a snapshot; the **living docs** are what stays true: `docs/*.md`, `apps/*/docs/*.md`, app READMEs
and `AGENTS.md` files. `docs/agents/spec-map.json` maps code paths to the doc that describes them, and CI checks
that a PR touching a mapped path also touches its doc, unless the PR body ticks "No spec impact" with a reason.

- A new feature area gets a new doc in the matching `docs/` folder and a new `spec-map.json` entry.
- Lasting "why" goes in `docs/adr/`; vocabulary in `GLOSSARY.md`; behaviour and contracts in the feature doc.
- Docs and specs are written in English.

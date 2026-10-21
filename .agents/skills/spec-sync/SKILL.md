---
name: spec-sync
description: "Keep the living docs in sync with a change before opening a PR. Use after any behaviour change, bug fix, new endpoint, schema change or config/env change, and whenever a PR check reports a missing doc update."
---

# Sync the living docs

The living docs (`docs/*.md`, `apps/*/docs/*.md`, app READMEs, `AGENTS.md` files) are this repo's specs; spec
issues are snapshots (`docs/adr/0002-living-docs-are-the-specs.md`). A merged PR leaves them true.

## Steps

1. **List the change**: `git diff --name-only origin/main...HEAD` (plus uncommitted files).
2. **Find the docs**: match each changed path against `docs/agents/spec-map.json`. Also grep `docs/` and
   `apps/*/docs/` for the class, endpoint, env var or table names you touched: docs often cite code
   ("Code: `service/correction/…`").
3. **Update each doc** where the change alters what it says: rules, status codes, endpoints, env vars, defaults,
   limits, code pointers, migration numbers. Edit in place in the doc's existing style; a doc describes current
   behaviour, not history. Bug fixes: if the code now matches the doc, nothing to edit; if the doc described the
   bug, fix the doc.
4. **New area**: a feature with no doc gets one in the matching folder (`apps/api/docs/<FEATURE>.md` for API
   features, `docs/` for cross-app) and an entry in `spec-map.json`.
5. **Decisions and words**: a lasting "why" becomes an ADR in `docs/adr/` (format in the `domain-modeling` skill); a
   new domain term goes into `GLOSSARY.md`.
6. **Agent rules**: a new convention, command or gotcha goes into the nearest `AGENTS.md`.
7. **Record it** in the PR body's "Living docs" section: the docs updated, or "No spec impact: <reason>" (e.g. pure
   refactor, test-only).

Done when every changed path that `spec-map.json` maps has its doc updated or a stated reason, and no doc cites code
that the change renamed or removed.

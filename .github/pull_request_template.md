<!--
Title: Conventional Commits, e.g. "fix(scheduler): keep blocked times on reload" (CI checks it).
Target: main (merge queue). Coding agents: the `pr` skill writes this body; keep these headings.
-->

Closes #

## Summary

<!-- The smallest view that makes the change clear: pseudocode, call tree, component or file tree. -->

## Evidence

<!-- Before/after: failing → passing test, command output, or screenshots for UI changes (light and dark, es and en). -->

## Merge danger

**Door:** <!-- one-way (migration, data, external contract) or two-way -->

**Blast radius:** <!-- one word: api, web, scheduler, newsletter, infra, all -->

<!-- Manual steps after deploy: VPS .env vars, OAuth URIs, new /var/www dirs, data fixes. "None" if none. -->

## Living docs

<!-- docs/agents/spec-map.json; CI fails when mapped code changes without its doc. Tick one. -->

- [ ] Updated: <!-- docs/ or apps/*/docs/ files, GLOSSARY.md, ADRs -->
- [ ] No spec impact: <!-- reason, e.g. refactor without behaviour change -->

## Checklist

- [ ] Spec issue linked (features, schema, auth, cross-app; see `docs/agents/workflow.md`)
- [ ] Tests cover the change (API: a test that fails without it)
- [ ] Migrations follow the `flyway-migration` skill (test mirror + target)
- [ ] UI text in both `es` and `en`; UI follows `docs/EDITORIAL_UI_SYSTEM.md`
- [ ] Reviewer subagents run where they apply (api-architecture, migration, security, ui)

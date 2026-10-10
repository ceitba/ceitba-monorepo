---
name: kb-wiki
description: "Write subject wiki pages locally from published Apuntes and import them into a local API (interim KB pipeline)."
disable-model-invocation: true
---

# Write and import subject wiki pages

The interim, agent-driven version of the wiki pipeline (`apps/api/docs/SUBJECT-WIKI.md`, page format and
validator rules). Runs against the **local** drive stack, never production.

## Steps

1. **Stack up** (from `apps/api`): `cp .env.drive.example .env.drive` (fill `AUTH_JWT_SECRET`), then
   `docker compose --env-file .env.drive -f docker-compose.drive.yml up -d --build`. It runs the dev profile with dev
   login on `http://localhost:8081/api`. Published Apuntes must exist for the target subjects.
2. **Scratch dir**: `W=$(mktemp -d)/kb && mkdir -p "$W" && cp apps/api/scripts/kb/*.py apps/api/scripts/kb/KB-WRITER.md "$W"`.
   Everything below runs with `cd "$W"`.
3. **Export**: `python3 export_kb.py` writes `kb-input/<subject>/_files.json` + `<fileId>.txt`. It reads from the
   container `ceitba-drive-postgres-1` (the compose project `ceitba-drive`); check `docker ps` if it is named
   differently.
4. **Write** pages for the requested subjects following `KB-WRITER.md` exactly (it is the writer brief). For many
   subjects, give each subagent a disjoint set of subjects and the brief.
5. **Link**: `python3 link_kb.py kb-output <subject> ...`, then `python3 link_kb.py kb-output --check`.
6. **Validate**: `python3 validate_kb.py kb-output <subject> ...` must print no `REJECT`.
7. **Import**: `apps/api/scripts/kb-import.sh "$W/kb-output" [baseUrl]` (default
   `http://localhost:8081/api/v1`; `KB_REPLACE=false` to keep existing pages). Report accepted / rejected / removed
   per subject.

Done when validation is clean and the import reports no rejected pages. Scratch output stays out of the repo.

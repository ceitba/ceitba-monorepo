---
name: release
description: "Open the dev → main release PR (CEITBA monorepo)."
disable-model-invocation: true
---

# Release dev → main

Only `main` deploys (`.github/workflows/deploy.yml`): the API first, then each changed web app. One reviewed
`dev → main` PR per release, merged with a merge commit.

## Steps

1. `git fetch origin` and confirm `origin/dev` is ahead: `git log --oneline origin/main..origin/dev`. Empty → stop.
2. Check `dev` is green: `gh run list --branch dev --workflow CI --limit 3`. A red run → stop and report.
3. Collect what ships: merged PRs in `git log --merges --oneline origin/main..origin/dev` and the apps touched
   (`git diff --stat origin/main...origin/dev -- apps infra .github`).
4. Flag deploy risks in the body:
   - new prod migrations (`apps/api/src/main/resources/db/migration`): they run on API start, irreversible;
   - `SecurityConfig` or auth changes;
   - `infra/caddy` changes (Caddy restarts);
   - new env vars the VPS `.env` needs (grep the diff of `.env.example`, `application*.yml`);
   - manual steps listed in the merged PRs.
5. Open it: `gh pr create --base main --head dev --title "chore(release): <YYYY-MM-DD>" --body …` with sections
   **Ships** (PR list grouped by app), **Deploy risks**, **Manual steps** (VPS env, OAuth, directories) and
   **Rollback** (revert the merge on `main`, then run Deploy manually).
6. Do not merge it: a human reviews and merges with a merge commit.

Done when the PR is open and every migration, env var and manual step from step 4 is listed.

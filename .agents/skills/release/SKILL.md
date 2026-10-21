---
name: release
description: "List the deploy risks of a PR before it enters the main merge queue (CEITBA monorepo)."
disable-model-invocation: true
---

# Release a PR into main

There is no `dev` branch: PRs target `main`, merge through the merge queue with a merge commit, and every merge
deploys what it changed (`.github/workflows/deploy.yml`: the API first, then each changed web app and the MCP
server). So each PR is its own release; this skill writes its deploy notes before a human queues it.

## Steps

1. `git fetch origin` and take the PR's range: `git log --oneline origin/main..HEAD` (or `gh pr view <n>`). Empty → stop.
2. Check the PR is green: `gh pr checks <n>`. A red required check → stop and report.
3. Collect what ships: the apps touched (`git diff --stat origin/main...HEAD -- apps infra .github packages`).
4. Flag deploy risks:
   - new prod migrations (`apps/api/src/main/resources/db/migration`): they run on API start, irreversible, and
     must be expand/contract (`apps/api/docs/DEPLOY.md`);
   - access-policy (`apps/api/src/http/auth/policy.ts`) or auth changes;
   - `infra/caddy` changes (Caddy restarts);
   - new env vars the VPS `.env` needs (grep the diff of `apps/api/.env.example`, `apps/api/src/config/sections/`);
   - manual steps the PR body lists.
5. Put them in the PR body's **Merge Danger** section (the `pr` skill), with **Manual steps** (VPS env, OAuth,
   directories) and **Rollback** (revert the merge commit on `main`, which deploys the previous state).
6. Do not merge it: a human approves and queues it ("Merge when ready").

Done when the PR body lists every migration, env var and manual step from step 4.

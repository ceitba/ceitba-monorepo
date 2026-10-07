# apps/scheduler: agent rules

"Combinador de Horarios": schedule builder, saved schedules and share sessions, served at `/scheduler/`. React 18 +
Vite + TypeScript (strict, `@/*` path alias, a separate `tsconfig.worker.json` for `src/workers/`). Shared web-app
rules are in `docs/agents/web-apps.md`; read it first. UI follows `docs/EDITORIAL_UI_SYSTEM.md`.

- Schedule generation is the pure `generateSchedules(subjects, options, blockedTimes)` in `src/services/`, capped
  at `MAX_GENERATED_SCHEDULES`. Keep it pure: no fetches, no stores, no DOM.
- `src/utils/ics.ts` builds calendar exports in `America/Argentina/Buenos_Aires`.
- `src/api/schedules.ts` / `share.ts` back saved schedules and share sessions; `corrections.ts` backs schedule
  corrections (`apps/api/docs/SCHEDULE-CORRECTIONS.md`).
- API URL env: `VITE_CEITBA_API_URL` is the **origin only**; the client appends `/api/v1` itself.
- Locales: `src/locales/{es,en}.json`. English has ordinal plural keys (`_ordinal_one`, ...) that Spanish does not
  need; that is expected.
- Gate: `bun run --filter @ceitba/scheduler lint` and `build`.

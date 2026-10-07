# apps/web: agent rules

Main CEITBA site plus the STAFF-only `/manage` admin. React 18 + Vite + TypeScript (strict, `noUnusedLocals`).
Shared web-app rules are in `docs/agents/web-apps.md`; read it first. UI follows `docs/EDITORIAL_UI_SYSTEM.md`.

- `src/pages/sections/` are the public home tabs; `src/pages/manage/` is the STAFF admin.
- Route guards: `AuthGuard`, `StaffGuard`, `CapabilityGuard` (feature gates from the API's capabilities, see
  `apps/api/docs/CAPABILITIES.md`).
- API modules live in `src/api/*.ts` on top of `src/api/client.ts`.
- Locales: `src/locales/{es,en}.json`, plus `apuntes.{es,en}.json` for the Apuntes area (loaded by
  `src/i18nApuntes.ts`).
- API URL env: `VITE_API_URL` **including** `/api/v1`.
- Gate: `bun run --filter @ceitba/web lint` and `build` (`tsc -p tsconfig.app.json && vite build`).

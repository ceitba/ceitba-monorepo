# apps/newsletter: agent rules

Student newsletter (articles, events, org follows, admin area), served at `/newsletter/`. React 18 + Vite in
**plain JavaScript (JSX)**: do not add TypeScript files or `tsc` here. Shared web-app rules are in
`docs/agents/web-apps.md`; read it first. UI follows `docs/EDITORIAL_UI_SYSTEM.md` and the newsletter brand notes in
`DESING.md`.

- Dates are `YYYY-MM-DD` strings: parse them with `src/utils/dates.js`, never `new Date(str)` (UTC → off by one
  day in Argentina).
- The contributor/suggestion flow is a `localStorage` mock hidden behind `CONTRIBUTIONS_ENABLED = false`
  (`src/config/features.js`). `apps/api/docs/SPA-MIGRATION.md` is the plan to move it onto the API.
- `src/pages/admin/` is the staff area (guarded by `src/admin/AdminAuthGuard.jsx`), including the weekly digest
  admin (`apps/api/docs/WEEKLY-DIGEST.md`).
- API URL env: `VITE_API_URL` **including** `/api/v1`.
- Gate: `bun run --filter @ceitba/newsletter lint` and `build` (`vite build` only).

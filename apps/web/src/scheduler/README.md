# Combinador de Horarios

Schedule builder for ITBA students, served at `/scheduler` as a section of the CEITBA web app (`apps/web`). Run,
build and lint it with the rest of the app (see the repository `CLAUDE.md`).

## Features

- Browse subjects by career and study plan
- Select commissions (course sections) with conflict detection
- Drag-and-drop course prioritization
- Automatic schedule combination generator (in a Web Worker)
- Visual weekly calendar preview
- Export schedule as PDF, image, or `.ics` calendar file
- Saved schedules, comparisons and live share sessions for signed-in users

## Structure

```
scheduler/
├── SchedulerApp.tsx  section entry: routes (relative to /scheduler) and the "scheduler" i18n namespace
├── paths.ts          schedulerPath() for links and navigate()
├── api/              saved schedules, share sessions, corrections
├── components/       UI components (SchedulerHeader is the section's bar under the app Navbar)
├── hooks/            custom React hooks
├── locales/          es/en strings
├── pages/            page-level components
├── services/         scheduler algorithm
├── types/            TypeScript types
├── utils/            utility functions
└── workers/          Web Worker entry points
```

---

Developed with care by the **IT Team CEITBA**: Ian Dalton, Lautaro Bonseñor, Camila Lee, Uriel Sosa Vázquez.

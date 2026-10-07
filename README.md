# CEITBA

The platform of CEITBA, the student center of ITBA, served at [ceitba.org.ar](https://ceitba.org.ar).

| App | Dir | Served at | Stack |
|---|---|---|---|
| API | `apps/api` | `/api` | Spring Boot 3, Java 21, Postgres |
| Web: main site + staff admin, Combinador de Horarios, Newsletter | `apps/web` | `/`, `/scheduler`, `/newsletter` | React 18, Vite, TypeScript |

The mobile app lives in its own repo, [ceitba/CEITBApp](https://github.com/ceitba/CEITBApp).

## Running locally

You need Docker, a JDK 21 (or just Docker, see `apps/api/scripts/mvn`) and [bun](https://bun.sh).

```sh
# API + Postgres + MinIO
cd apps/api && cp .env.example .env   # fill AUTH_JWT_SECRET: openssl rand -base64 32
docker compose up -d

# Web app (from the repo root)
bun install
bun run dev
```

The web app reads its API URL from `apps/web/.env.local` (copy its `.env.example`).

### Fake data and dev login

To click through everything without real ITBA data or a Google login:

1. In `apps/api/.env` set `SPRING_PROFILES_ACTIVE=dev`, `AUTH_DEV_LOGIN_ENABLED=true`, `ITBA_API_USE_FAKE=true` and
   `ITBA_API_FAKE_FROM_DB=true`, then `docker compose up -d` and wait for `/api/actuator/health`.
2. `apps/api/scripts/dev-seed.sh` loads fake users, newsletter articles and events, the staff page, benefits and
   scheduler plans/commissions. Dates are relative to today; re-run it any time to re-anchor them.
3. In `apps/web/.env.local` set `VITE_API_URL=/api/v1`, `VITE_DEV_LOGIN=true` and run the dev server with
   `DEV_API_PROXY=http://localhost:8080` so the page and the API share one origin (the session cookie needs it).
4. Use "Dev login" in the navbar with one of the emails listed at the top of `apps/api/scripts/dev-seed.sql`
   (e.g. `dev-staff@itba.edu.ar` for staff, `estudiante@itba.edu.ar` for a student).

## Repository layout

```
apps/        api (Maven) and web (bun workspace)
infra/       Caddy reverse proxy config for production
docs/        cross-app docs (EDITORIAL_UI_SYSTEM.md: the shared UI design system)
.github/     CI (ci.yml) and deploys (deploy.yml); spa-apps.json holds the web app's build settings
```

## Contributing

Branch from `dev` and open your PR into `dev`. Releases are a reviewed `dev` → `main` PR; every push to
`main` deploys the apps it changed.

## License

[AGPL-3.0](LICENSE). Newsletter code (now `apps/web/src/newsletter`) written before the move to this repository was
also released under the MIT license (`apps/web/src/newsletter/LICENSE`).

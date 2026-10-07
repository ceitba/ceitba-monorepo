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

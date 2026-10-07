# CEITBA

The platform of CEITBA, the student center of ITBA, served at [ceitba.org.ar](https://ceitba.org.ar).

| App | Dir | Served at | Stack |
|---|---|---|---|
| API | `apps/api` | `/api` | Spring Boot 3, Java 21, Postgres |
| Main site + staff admin | `apps/web` | `/` | React 18, Vite, TypeScript |
| Combinador de Horarios | `apps/scheduler` | `/scheduler/` | React 18, Vite, TypeScript |
| Newsletter | `apps/newsletter` | `/newsletter/` | React 18, Vite, JavaScript |
| MCP server for AI assistants ([connect guide](apps/mcp/CONECTAR.md)) | `apps/mcp` | `/mcp` | Bun, TypeScript, MCP SDK |

The mobile app lives in its own repo, [ceitba/CEITBApp](https://github.com/ceitba/CEITBApp).

## Running locally

You need Docker, a JDK 21 (or just Docker, see `apps/api/scripts/mvn`) and [bun](https://bun.sh).

```sh
# API + Postgres + MinIO
cd apps/api && cp .env.example .env   # fill AUTH_JWT_SECRET: openssl rand -base64 32
docker compose up -d

# Web apps (from the repo root)
bun install
bun run dev
```

Each web app reads its API URL from `apps/<app>/.env.local` (copy its `.env.example`).
See each app's README for details.

## Repository layout

```
apps/        api (Maven), the three web apps and the MCP server (bun workspaces)
packages/    shared TS packages (scheduler-core: the schedule generator)
infra/       Caddy reverse proxy config for production
docs/        cross-app docs (EDITORIAL_UI_SYSTEM.md: the shared UI design system)
.github/     CI (ci.yml) and deploys (deploy.yml); spa-apps.json holds each web app's build settings
```

## Contributing

Branch from `dev` and open your PR into `dev`. Releases are a reviewed `dev` → `main` PR; every push to
`main` deploys the apps it changed.

## License

[AGPL-3.0](LICENSE). Code in `apps/newsletter` written before the move to this repository was also released under the
MIT license (`apps/newsletter/LICENSE`).

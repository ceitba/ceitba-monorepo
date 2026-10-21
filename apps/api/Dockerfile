# CEITBA API (apps/api, Bun). Build from the repo root, since it needs the
# Bun workspace (bun.lock):
#   docker build -f apps/api/Dockerfile -t ghcr.io/ceitba/ceitba-api .
# Port 8080, context path /api, health at /api/actuator/health.
FROM oven/bun:1.4.2-alpine

WORKDIR /app

# ITBA runs on Argentina time: the default zone of the process (session
# TimeZone, cron jobs without a zone).
RUN apk add --no-cache tzdata
ENV TZ=America/Argentina/Buenos_Aires

# Every workspace manifest is needed for a --frozen-lockfile install; only this
# app's production dependencies are installed.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY apps/api/package.json apps/api/
COPY packages/scheduler-core/package.json packages/scheduler-core/
RUN bun install --frozen-lockfile --production --filter '@ceitba/api'

# The code, and the SQL migrations src/db/migrate.ts applies on boot
# (src/main/resources/db/migration; the test mirrors are .dockerignored).
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/

ENV NODE_ENV=production \
    PORT=8080 \
    SPRING_PROFILES_ACTIVE=prod

USER bun
WORKDIR /app/apps/api
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/actuator/health || exit 1
# SIGTERM: readiness goes 503, SHUTDOWN_DRAIN, then a graceful stop (src/main.ts).
STOPSIGNAL SIGTERM
CMD ["bun", "src/main.ts"]

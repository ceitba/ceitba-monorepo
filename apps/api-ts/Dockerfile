# CEITBA API, Bun rewrite (apps/api-ts). Build from the repo root, since it
# needs the Bun workspace (bun.lock) and the Flyway SQL files of apps/api:
#   docker build -f apps/api-ts/Dockerfile -t ghcr.io/ceitba/ceitba-api-ts .
# Same port (8080), context path (/api) and health check as the Java image.
FROM oven/bun:1.4.2-alpine

WORKDIR /app

# ITBA runs on Argentina time: the default zone of the process (session
# TimeZone, cron jobs without a zone) like the Java image's TZ.
RUN apk add --no-cache tzdata
ENV TZ=America/Argentina/Buenos_Aires

# Every workspace manifest is needed for a --frozen-lockfile install; only this
# app's production dependencies are installed.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY apps/api-ts/package.json apps/api-ts/
COPY packages/scheduler-core/package.json packages/scheduler-core/
RUN bun install --frozen-lockfile --production --filter '@ceitba/api-ts'

# The schema is owned by the Flyway SQL in apps/api (src/db/migrate.ts reads it).
COPY apps/api/src/main/resources/db/migration apps/api/src/main/resources/db/migration
COPY apps/api-ts/src apps/api-ts/src
COPY apps/api-ts/tsconfig.json apps/api-ts/

ENV NODE_ENV=production \
    PORT=8080 \
    SPRING_PROFILES_ACTIVE=prod

USER bun
WORKDIR /app/apps/api-ts
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/actuator/health || exit 1
# SIGTERM: readiness goes 503, SHUTDOWN_DRAIN, then a graceful stop (src/main.ts).
STOPSIGNAL SIGTERM
CMD ["bun", "src/main.ts"]

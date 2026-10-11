# CEITBA MCP server (hosted, Streamable HTTP + OAuth). Build from the repo root,
# since it needs the Bun workspace (bun.lock, packages/scheduler-core):
#   docker build -f apps/mcp/Dockerfile -t ghcr.io/ceitba/ceitba-mcp .
FROM oven/bun:1.4.2-alpine

WORKDIR /app

# Every workspace manifest is needed for a --frozen-lockfile install; only the
# MCP app's production dependencies are installed.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/scheduler-core/package.json packages/scheduler-core/
RUN bun install --frozen-lockfile --production --filter '@ceitba/mcp'

COPY packages/scheduler-core/src packages/scheduler-core/src
COPY apps/mcp/src apps/mcp/src

# SQLite OAuth store lives on a volume.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    MCP_DB_PATH=/data/mcp.sqlite

USER bun
WORKDIR /app/apps/mcp
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
CMD ["bun", "src/http.ts"]

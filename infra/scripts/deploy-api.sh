#!/usr/bin/env bash
# Blue/green deploy of the API without downtime (apps/api/docs/DEPLOY.md).
# Run from the API's compose project directory (~/CEITBA-API on the VPS):
#
#   1. find the color that is serving (ceitba-api-blue / ceitba-api-green, or
#      the pre-blue/green ceitba-api container) and pick the other one;
#   2. pull its image and start it next to the old one;
#   3. wait until Docker reports it healthy (the server booted and applied the
#      pending migrations). If it never does, stop it, leave the old color
#      serving and fail;
#   4. give Caddy's health checks time to see it, then stop the old color
#      (graceful: stop_grace_period lets requests and mail in flight finish).
#
# The image is API_IMAGE from .env (default ghcr.io/ceitba/ceitba-api:latest);
# pinning an older tag there and re-running this script is the rollback.
#
# Env: PULL=0 skips the pull (local rehearsal with a locally built image);
# HEALTH_TIMEOUT (s, default 300); CADDY_SETTLE (s, default 6, more than
# Caddy's health_interval + health_timeout); COMPOSE_FILE (default
# docker-compose.yml alone, so a local override file never applies here).
set -euo pipefail

export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
PULL="${PULL:-1}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
CADDY_SETTLE="${CADDY_SETTLE:-6}"
BLUE=ceitba-api-blue
GREEN=ceitba-api-green
LEGACY=ceitba-api # container_name before blue/green; remove with Caddy's fallback

log() { echo "deploy-api: $*"; }

# Container id of a running service, empty if it isn't running.
running_id() { docker compose ps -q --status running "$1" 2>/dev/null || true; }
created_at() { docker inspect -f '{{.Created}}' "$1"; }
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1"; }

blue_id=$(running_id "$BLUE")
green_id=$(running_id "$GREEN")
legacy_id=$(docker ps -q --filter "name=^${LEGACY}\$" --filter status=running)

if [ -n "$blue_id" ] && [ -n "$green_id" ]; then
  # A previous deploy died between steps 2 and 4. Keep the healthy one
  # serving and redeploy the other; if both (or neither) are healthy, keep the
  # newer one.
  blue_health=$(health "$blue_id") green_health=$(health "$green_id")
  if [ "$blue_health" = healthy ] && [ "$green_health" != healthy ]; then new=$GREEN old=$BLUE
  elif [ "$green_health" = healthy ] && [ "$blue_health" != healthy ]; then new=$BLUE old=$GREEN
  elif [[ "$(created_at "$blue_id")" < "$(created_at "$green_id")" ]]; then new=$BLUE old=$GREEN
  else new=$GREEN old=$BLUE; fi
elif [ -n "$blue_id" ]; then
  new=$GREEN old=$BLUE
elif [ -n "$green_id" ]; then
  new=$BLUE old=$GREEN
else
  new=$BLUE old=""
fi
serving="$old"
if [ -n "$legacy_id" ]; then serving="${serving:+$serving and }$LEGACY (pre-blue/green)"; fi
log "serving: ${serving:-nothing}; deploying: $new"

# Everything except the API, as `docker compose up -d` did before (postgres,
# MinIO, the one-shot minio-init, embeddings). Unchanged services are left alone.
mapfile -t deps < <(docker compose config --services | grep -vxE "$BLUE|$GREEN")
docker compose up -d "${deps[@]}"

if [ "$PULL" = 1 ]; then docker compose pull "$new"; fi
docker compose up -d --no-deps "$new"
new_id=$(docker compose ps -q "$new")

log "waiting for $new to be healthy (timeout ${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
restarts=$(docker inspect -f '{{.RestartCount}}' "$new_id")
while :; do
  # "<state> <restart count> <health>": a container that crashes is restarted
  # by its restart policy and its health goes back to "starting", so a crash
  # loop shows as a growing restart count, not as an exited state.
  read -r state count status < <(docker inspect -f \
    '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$new_id")
  [ "$status" = healthy ] && break
  if [ "$status" = unhealthy ] || [ "$count" -gt "$restarts" ] || [ "$state" = exited ] || [ "$state" = dead ] \
      || [ "$SECONDS" -ge "$deadline" ]; then
    log "$new did not become healthy (state: $state, restarts: $((count - restarts)), health: $status); keeping ${old:-$LEGACY} and rolling back"
    docker compose logs --no-color --tail 150 "$new" || true
    docker compose stop "$new" || true
    exit 1
  fi
  sleep 2
done
log "$new is healthy"

# Caddy prefers the first healthy upstream and only learns that $new is up
# from its own checks: wait for one before taking $old away.
sleep "$CADDY_SETTLE"

if [ -n "$old" ]; then
  log "stopping $old"
  docker compose stop "$old"
fi
if [ -n "$legacy_id" ]; then
  log "stopping and removing $LEGACY (pre-blue/green)"
  docker stop -t 90 "$LEGACY" >/dev/null
  docker rm "$LEGACY" >/dev/null
fi
log "done: $new is serving"

#!/usr/bin/env bash
# Loads scripts/dev-seed.sql (fake users, newsletter content, scheduler data,
# dates relative to today) into a LOCAL Postgres container. Re-runnable.
# Start the API once first so Flyway has created the schema.
#
#   ./scripts/dev-seed.sh                       # the compose container (ceitba-postgres)
#   PG_CONTAINER=my-pg ./scripts/dev-seed.sh    # any other local container
set -euo pipefail

cd "$(dirname "$0")"
container="${PG_CONTAINER:-ceitba-postgres}"
db="${POSTGRES_DB:-ceitba_db}"
user="${POSTGRES_USER:-postgres}"

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -q -U "$user" -d "$db" < dev-seed.sql
echo "Seeded $db in $container. Dev-login emails are listed at the top of scripts/dev-seed.sql."

#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

npm run db:generate
npm run db:push

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  npm run db:seed
fi

echo "Database schema is up to date."

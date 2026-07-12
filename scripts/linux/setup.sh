#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 22 LTS before running this script." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm before running this script." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Review it before exposing the service publicly."
fi

set -a
. ./.env
set +a

mkdir -p data

npm ci
npm run db:generate
npm run db:migrate:deploy

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  npm run db:seed
fi

npm run build

echo "Setup complete. Start with: scripts/linux/start.sh"

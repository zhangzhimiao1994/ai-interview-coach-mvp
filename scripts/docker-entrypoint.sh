#!/bin/sh
set -eu

mkdir -p /app/data

echo "Applying database migrations..."
npm run db:migrate:deploy

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  npm run db:seed
fi

echo "Starting application..."
exec "$@"

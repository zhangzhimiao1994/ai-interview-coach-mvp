#!/bin/sh
set -eu

mkdir -p /app/data

echo "Preparing Prisma client..."
npx prisma generate

echo "Applying database schema..."
npx prisma db push --skip-generate

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  npm run db:seed
fi

echo "Starting application..."
exec "$@"

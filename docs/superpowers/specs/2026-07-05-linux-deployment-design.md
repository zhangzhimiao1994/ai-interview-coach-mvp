# Linux Deployment Design

## Goal

Make the AI interview coach MVP deployable on a Linux server without depending on the Windows development environment.

## Deployment Modes

The project supports two Linux deployment modes:

1. Docker Compose as the preferred production path.
2. Native Linux Node.js scripts for servers that do not use Docker.

Both modes run the same Next.js application and Prisma SQLite database schema.

## Docker Mode

Docker Compose builds the app image, stores SQLite data in a named volume, exposes port 3000, and runs a small entrypoint script before starting the app.

The entrypoint performs:

- Prisma client generation.
- SQLite schema sync through `prisma db push`.
- Optional seed data creation when `RUN_DB_SEED=true`.
- Production app start through `npm run start`.

SQLite data is stored at `/app/data/prod.db` inside the container and mounted through the `app-data` Docker volume.

## Native Linux Mode

Native Linux deployment uses shell scripts under `scripts/linux/`:

- `setup.sh` installs dependencies, creates `.env` when missing, prepares Prisma, and builds the app.
- `migrate.sh` applies Prisma schema changes and optionally seeds data.
- `start.sh` starts the app with `HOSTNAME=0.0.0.0`.

The scripts are POSIX shell compatible and avoid Windows-specific paths.

## Production Notes

The MVP currently uses SQLite because it is simple to deploy and enough for first validation. For multi-user production traffic, the next database step should be PostgreSQL with Prisma migrations.

For public access, run the app behind Nginx with HTTPS. The app itself listens on `0.0.0.0:3000` by default.

## Verification

Deployment changes must pass:

- `npm test`
- `npm run build`

Docker files are checked structurally in this environment, but a full Docker image build depends on the target host having Docker installed.

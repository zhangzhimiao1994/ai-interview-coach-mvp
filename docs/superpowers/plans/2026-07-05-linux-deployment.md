# Linux Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Docker-first Linux deployment while also supporting native Linux server deployment scripts.

**Architecture:** Keep the app as a Next.js monolith with Prisma SQLite. Add portable shell scripts that prepare the database before the production server starts.

**Tech Stack:** Next.js, Prisma, SQLite, Docker Compose, POSIX shell, optional Nginx/systemd/PM2 documentation.

---

### Task 1: Docker Runtime

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `scripts/docker-entrypoint.sh`

- [ ] Add a Node 22 Alpine Docker image that installs dependencies, generates Prisma client, builds Next.js, and starts through a shell entrypoint.
- [ ] Add a Docker Compose service named `interview-coach` that maps `${PORT:-3000}:3000` and mounts a named `app-data` volume to `/app/data`.
- [ ] Add a Docker entrypoint that runs `npx prisma generate`, `npx prisma db push`, optional seed, then executes the passed command.

### Task 2: Native Linux Scripts

**Files:**
- Create: `scripts/linux/setup.sh`
- Create: `scripts/linux/migrate.sh`
- Create: `scripts/linux/start.sh`
- Create: `scripts/linux/ai-interview-coach.service`
- Create: `ecosystem.config.cjs`

- [ ] Add setup script for dependency installation, env bootstrap, Prisma generation, DB sync, optional seeding, and production build.
- [ ] Add migrate script for safe repeatable schema updates.
- [ ] Add start script that binds to `0.0.0.0`.
- [ ] Add sample systemd service and PM2 ecosystem file.

### Task 3: Documentation And Verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/mvp-handoff.md`
- Create: `docs/linux-deployment.md`

- [ ] Document Docker Compose deployment.
- [ ] Document native Linux deployment.
- [ ] Document Nginx reverse proxy, update flow, database backup, and rollback.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Commit and push the completed deployment update.

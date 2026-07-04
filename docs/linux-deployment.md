# Linux Deployment Guide

This project can run on Linux in two ways:

1. Docker Compose, recommended for most servers.
2. Native Node.js scripts, useful when the server already has Node.js and a process manager.

The app listens on port `3000` by default and stores SQLite data in `data/prod.db` for native Linux, or `/app/data/prod.db` inside Docker.

## Option A: Docker Compose

### 1. Prepare the server

Install Docker and Docker Compose on the Linux server.

Clone the repository:

```bash
git clone git@github.com:zhangzhimiao1994/ai-interview-coach-mvp.git
cd ai-interview-coach-mvp
```

Create the environment file:

```bash
cp .env.example .env
```

For Docker Compose, use:

```env
DATABASE_URL="file:/app/data/prod.db"
PORT=3000
RUN_DB_SEED=false
```

Use `RUN_DB_SEED=true` only when you want demo templates and demo data.

### 2. Start

```bash
docker compose up -d --build
```

Open:

```text
http://your-server-ip:3000
```

### 3. View logs

```bash
docker compose logs -f interview-coach
```

### 4. Stop

```bash
docker compose down
```

Do not delete the Docker volume unless you intentionally want to remove the SQLite database.

## Option B: Native Linux Node.js

### 1. Server requirements

- Linux server
- Node.js 22 LTS
- npm
- Git

Clone the repository:

```bash
git clone git@github.com:zhangzhimiao1994/ai-interview-coach-mvp.git
cd ai-interview-coach-mvp
```

Create and review `.env`:

```bash
cp .env.example .env
```

For native Linux, use:

```env
DATABASE_URL="file:./data/prod.db"
PORT=3000
RUN_DB_SEED=false
```

### 2. First setup

```bash
chmod +x scripts/linux/*.sh
scripts/linux/setup.sh
```

### 3. Start directly

```bash
scripts/linux/start.sh
```

### 4. Run with PM2

Install PM2:

```bash
npm install -g pm2
```

Start:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Check status:

```bash
pm2 status
pm2 logs ai-interview-coach
```

### 5. Run with systemd

Copy the project to:

```text
/opt/ai-interview-coach-mvp
```

Install the service:

```bash
sudo cp scripts/linux/ai-interview-coach.service /etc/systemd/system/ai-interview-coach.service
sudo systemctl daemon-reload
sudo systemctl enable ai-interview-coach
sudo systemctl start ai-interview-coach
```

Check status:

```bash
sudo systemctl status ai-interview-coach
journalctl -u ai-interview-coach -f
```

## Nginx Reverse Proxy

Example Nginx site:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Use Certbot or your cloud provider to enable HTTPS before sharing the service publicly.

## Updating The Server

### Docker

```bash
git pull
docker compose up -d --build
```

### Native Linux

```bash
git pull
scripts/linux/setup.sh
pm2 restart ai-interview-coach
```

For systemd:

```bash
git pull
scripts/linux/setup.sh
sudo systemctl restart ai-interview-coach
```

## Backup SQLite Data

### Docker

```bash
docker compose exec interview-coach sh -c 'mkdir -p /app/data/backups && cp /app/data/prod.db /app/data/backups/prod-$(date +%Y%m%d-%H%M%S).db'
```

### Native Linux

```bash
mkdir -p data/backups
cp data/prod.db data/backups/prod-$(date +%Y%m%d-%H%M%S).db
```

## Rollback

Find a previous version:

```bash
git log --oneline
```

Roll back code:

```bash
git checkout <commit-id>
```

Then rebuild:

```bash
docker compose up -d --build
```

Or for native Linux:

```bash
scripts/linux/setup.sh
pm2 restart ai-interview-coach
```

If a database schema changed, restore a backup before rolling back to an older version.

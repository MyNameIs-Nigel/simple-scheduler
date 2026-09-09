# Deployment & Operations

This document outlines the container architecture, automated CI/CD pipeline, Docker Compose deployment, and runtime operations for `simple-scheduler`.

---

## Architecture & Ingress

The scheduler is deployed on a private host behind an external reverse proxy / Cloudflare Tunnel.

```
       Internet
          │
          ▼
┌───────────────────┐
│ Cloudflare Edge   │  (TLS termination, DNS)
└─────────┬─────────┘
          │ Tunnel
          ▼
┌───────────────────┐
│ Cloudflare Tunnel │  (Runs on dedicated edge machine)
└─────────┬─────────┘
          │ LAN HTTP (e.g. http://192.168.1.50:3000)
          ▼
┌────────────────────────────────────────────────────────┐
│ Host Machine                                           │
│                                                        │
│  ┌──────────────────────┐    ┌──────────────────────┐  │
│  │   simple-scheduler   │    │      Watchtower      │  │
│  │      Container       │    │      Container       │  │
│  │  (Node.js / App)     │    │  (Auto-updates app)  │  │
│  └──────────┬───────────┘    └──────────┬───────────┘  │
│             │                           │              │
│       binds │ ./data              mounts│ /var/run/    │
│             ▼                           ▼ docker.sock  │
│      [scheduler.db]                                    │
└────────────────────────────────────────────────────────┘
```

---

## Continuous Integration & Delivery

Automated builds and tests are handled by GitHub Actions (`.github/workflows/publish.yml`):

1. **Trigger**: Pushes to `main` or semantic version tags (`v*`).
2. **Quality Gate (`test` job)**:
   - Installs dependencies using `pnpm install --frozen-lockfile`.
   - Runs `pnpm lint`.
   - Runs `pnpm test` (Vitest integration and unit tests).
   - Runs `pnpm build` (verifies Next.js standalone compile and TypeScript types).
3. **Build & Publish (`publish` job)**:
   - Uses `docker/build-push-action` with Docker Buildx.
   - Builds multi-platform images (`linux/amd64`, `linux/arm64`).
   - Pushes to GitHub Container Registry (`ghcr.io/mynameis-nigel/simple-scheduler`).

---

## Docker Compose Setup

### Initial Setup on Host

```bash
# 1. Clone repository
git clone https://github.com/MyNameIs-Nigel/simple-scheduler.git
cd simple-scheduler

# 2. Configure environment
cp .env.example .env
# Edit .env with your Google OAuth credentials, SESSION_SECRET, and SITE_URL

# 3. Start the containers
docker compose up -d
```

### Container Services (`docker-compose.yml`)

1. **`scheduler`**:
   - Runs the Next.js standalone build.
   - Mounts `./data` to `/app/data` containing the SQLite database.
   - Runs with `restart: unless-stopped`.
   - Carries label `com.centurylinklabs.watchtower.enable: "true"`.

2. **`watchtower`**:
   - Pinned to `containrrr/watchtower:1.7.1` with `DOCKER_API_VERSION=1.48`.
   - Periodically polls GHCR (every 300s by default).
   - Recreates the `scheduler` container whenever a new image is pushed to `:latest`.
   - Automatically cleans up old image layers (`WATCHTOWER_CLEANUP=true`).

---

## Container Permissions (`docker-entrypoint.sh`)

Docker bind mounts arrive owned by the host user (frequently `root`). The `scheduler` image runs as a non-privileged user (UID `1001`, `nextjs`).

To eliminate manual host-side permission adjustments:
1. `docker-entrypoint.sh` starts as `root`.
2. It executes `chown -R nextjs:nodejs /app/data` to ensure write access.
3. Drops privileges to UID 1001 via `su-exec nextjs:nodejs`.
4. Executes `scripts/migrate.mjs` to apply pending database migrations.
5. Launches `node server.js`.

The runtime server never runs as root.

---

## Backup & Recovery

All persistent application data lives inside the `./data/` directory:
- `scheduler.db`: SQLite database.
- `scheduler.db-wal`: Write-Ahead Log.
- `scheduler.db-shm`: Shared-memory index.

### Live Backup Procedure
Because SQLite is run in WAL mode, you can safely create a consistent online backup without stopping the container:

```bash
docker compose exec scheduler sqlite3 /app/data/scheduler.db ".backup '/app/data/backup-$(date +%Y%m%d%H%M).db'"
```

Alternatively, stop the stack and copy the directory:
```bash
docker compose stop
rsync -a ./data/ /backups/scheduler-data/
docker compose start
```

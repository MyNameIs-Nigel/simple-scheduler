# Configuration Reference

All settings in `simple-scheduler` are read from environment variables at startup. No settings are baked into the container image, ensuring the same container artifact runs in local development, staging, or production.

---

## Environment Variable Schema

Environment validation is performed via Zod in `lib/env.ts`. Any missing or invalid configuration variable causes the process to fail immediately on boot with a message identifying the offending variable.

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | **Yes** | — | Google OAuth 2.0 Client ID created in Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | **Yes** | — | Google OAuth 2.0 Client Secret. |
| `ADMIN_EMAIL` | **Yes** | — | The single Google account email permitted to sign in to `/admin`. Compared case-insensitively. |
| `SESSION_SECRET` | **Yes** | — | Cryptographic key used to sign session cookies (minimum 32 characters). |
| `SITE_URL` | **Yes** | — | Canonical public URL (e.g. `https://schedule.nigel-smith.dev`). No trailing slash. Used for OAuth callbacks, feed URLs, and RFC 5545 UIDs. |
| `SCHEDULER_TIMEZONE` | No | `UTC` | IANA Timezone identifier (e.g., `America/New_York`, `Europe/London`). Used for calendar display, day grouping, and `.ics` `VTIMEZONE` generation. |
| `DATABASE_PATH` | No | `./data/scheduler.db` | Absolute or relative path to the SQLite database file. In Docker, defaults to `/app/data/scheduler.db`. |
| `SYNC_ENABLED` | No | `true` | Enables/disables the background calendar synchronization worker. Set to `false` during automated tests. |
| `SYNC_INTERVAL_MINUTES` | No | `30` | Interval in minutes between background checks for subscribed external `.ics` feeds (bounds: 5 to 1440). |
| `SYNC_ALLOW_PRIVATE_HOSTS` | No | `false` | When `false`, subscription URLs pointing to loopback or private RFC 1918 addresses (`127.0.0.1`, `10.x`, `192.168.x`) are rejected. |
| `BIND_ADDRESS` | No | `0.0.0.0` | Host interface for Docker Compose port binding. |
| `HOST_PORT` | No | `3000` | Host port mapped to container port 3000. |
| `WATCHTOWER_POLL_INTERVAL`| No | `300` | Frequency in seconds that Watchtower checks GHCR for updated container images. |

---

## Setting Up Credentials

### 1. Generating `SESSION_SECRET`

Generate a secure random secret of 32+ characters:

```bash
openssl rand -base64 32
```

### 2. Google OAuth 2.0 Setup

To configure authentication:

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **APIs & Services** → **Credentials**.
3. Click **Create Credentials** → **OAuth client ID**.
4. Set application type to **Web application**.
5. Add **Authorized redirect URIs**:
   - Production: `https://<SITE_URL>/api/auth/callback/google`
   - Local: `http://localhost:3000/api/auth/callback/google`
6. Copy the **Client ID** and **Client Secret** into your `.env` file.
7. Set `ADMIN_EMAIL` to the Google account address you will use to manage the scheduler.

> **Security Note:**
> Any Google account can initiate authentication against Google, but only `ADMIN_EMAIL` is accepted by the callback handler in `app/api/auth/callback/google/route.ts`. Any other account is immediately rejected and issued no session cookie.

---

## Example `.env` File

```env
# Public domain & routing
SITE_URL=https://schedule.nigel-smith.dev
SCHEDULER_TIMEZONE=America/New_York

# Authentication
GOOGLE_CLIENT_ID=1234567890-example.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-exampleSecretKey123
ADMIN_EMAIL=nigel@example.com
SESSION_SECRET=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# Storage & Database
DATABASE_PATH=./data/scheduler.db

# Subscription Syncing
SYNC_ENABLED=true
SYNC_INTERVAL_MINUTES=30
SYNC_ALLOW_PRIVATE_HOSTS=false

# Docker Host Binding
BIND_ADDRESS=0.0.0.0
HOST_PORT=3000
```

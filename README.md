# simple-scheduler

A self-hosted personal schedule for [schedule.nigel-smith.dev](https://schedule.nigel-smith.dev).

Publicly readable, privately editable. Events live in SQLite; the `.ics` feeds
are generated from the database on every request, so there is no exported file
that can drift out of sync with what you edited.

- **Public** — month, week and agenda views at `/`
- **Subscribable** — `/calendars/<slug>.ics` per calendar, `/calendars/all.ics` combined
- **Subscribed calendars** — mirror a remote `.ics` URL, refreshed automatically
- **Published feeds** — merge any set of calendars into one subscribable URL
- **Admin** — Google SSO, restricted to one address, at `/admin`
- **Recurring events** — full RRULE with per-occurrence skips and edits
- **Import** — seed from an existing `.ics` export

Built with Next.js 16, React 19, Tailwind v4, Drizzle and better-sqlite3.
Theme shared with [nigel-smith.dev](https://nigel-smith.dev).

---

## Configuration

Every setting is read from the environment at startup. Nothing is baked into the
image, so the same artifact runs against `localhost` or the public hostname
without a rebuild.

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth 2.0 client secret |
| `ADMIN_EMAIL` | yes | The one Google account allowed to edit. Compared case-insensitively. |
| `SESSION_SECRET` | yes | Session signing key, 32+ chars. `openssl rand -base64 32` |
| `SITE_URL` | yes | Public origin, no trailing slash. Used for OAuth redirects, feed URLs and event UIDs. |
| `SCHEDULER_TIMEZONE` | no | IANA zone for display and `.ics` output. Default `UTC`. |
| `DATABASE_PATH` | no | SQLite file. Default `./data/scheduler.db`. |
| `SYNC_ENABLED` | no | Background poller for subscribed calendars. Default `true`. |
| `SYNC_INTERVAL_MINUTES` | no | How often a subscribed calendar is re-fetched. Default `30`. |
| `SYNC_ALLOW_PRIVATE_HOSTS` | no | Allow subscription URLs on a private network. Default `false`. |

Invalid configuration fails at boot with a message naming the offending
variable, rather than surfacing at the first sign-in.

### Google OAuth setup

1. Google Cloud Console → **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth client ID** → *Web application*
3. Authorised redirect URIs:
   - `https://schedule.nigel-smith.dev/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (local development)

Only `ADMIN_EMAIL` can sign in. Any other Google account is rejected at the
callback and never receives a session cookie.

---

## Deployment

The image is built and pushed to GHCR by `.github/workflows/publish.yml` on
every push to `main`, after lint, tests and a production build pass. The
deployment host pulls it — there is no self-hosted runner, and CI never touches
the server.

The cloudflared tunnel runs on a **separate edge machine**; point its ingress
rule at `http://<this-host>:3000`. Nothing tunnel-related runs in this stack.

On the deployment host:

```bash
# One-time
git clone https://github.com/MyNameIs-Nigel/simple-scheduler.git
cd simple-scheduler
cp .env.example .env   # then fill it in

# Bring the stack up
docker compose up -d
```

After that, a merge to `main` deploys itself: the stack includes **Watchtower**,
which polls GHCR every `WATCHTOWER_POLL_INTERVAL` seconds (default 300) and
recreates the container when a new image is published. Because state lives
entirely in the mounted `./data` directory, that is just a container swap —
migrations run automatically at startup, before the server binds.

Watchtower only touches containers carrying the
`com.centurylinklabs.watchtower.enable` label, so nothing else on the host is in
scope. It is pinned to `containrrr/watchtower:1.7.1` and carries
`DOCKER_API_VERSION=1.48`: that release is from November 2023, the project is
archived, and without the override it negotiates Docker API 1.25, which Engine
29 refuses outright — the container crash-loops and nothing deploys, silently,
because the app itself keeps running. `nickfedor/watchtower` is an actively
maintained fork that needs no override, if this ever wants replacing. Two things to be clear-eyed about: it needs the Docker socket, which is
root-equivalent access to the host, and there is no approval step — a bad image
reaching `:latest` is live within one poll interval. The CI gate (lint, tests
and a production build must pass before the publish job runs) stands in for that.

Watchtower recreates a container from its *existing* config and never re-reads
`docker-compose.yml`, so a change to that file still needs `docker compose up -d`
by hand. `docker compose pull && docker compose up -d` also still works if you
want to force a deploy immediately.

`docker-compose.yml` also honours `BIND_ADDRESS` (default `0.0.0.0`) and
`HOST_PORT` (default `3000`). Bind to the LAN address the edge machine reaches,
or `127.0.0.1` if you ever colocate the tunnel.

### Data directory permissions

The container runs as uid 1001, while a bind-mounted `./data` arrives owned by
whoever owns it on the host — usually root. The image's own `chown` cannot help,
because Docker overlays the host directory and its ownership at start. So the
entrypoint starts as root, fixes ownership on `/app/data`, and drops to uid 1001
via `su-exec` before doing anything else. The server never runs as root, and no
host-side `chown` is needed.

### Backups

The mounted `data/` directory is the entire backup surface: the SQLite file plus
its `-wal` and `-shm` siblings. Copy it with the container stopped, or use
`sqlite3 scheduler.db ".backup 'out.db'"` while it runs.

---

## Subscribed calendars and published feeds

These two features are separate, and they compose. Together they answer "my work
shifts are published at a URL, my meetings are not, and I want one calendar with
both."

### Subscribing to a calendar

Give a calendar a **subscription URL** (`https://`, or the `webcal://` form most
publishers hand out) and it becomes a **read-only mirror** of that file:

- Events are fetched every `SYNC_INTERVAL_MINUTES`, plus on demand from the
  **Sync now** button on `/admin/calendars`.
- The poller sends `If-None-Match` / `If-Modified-Since`, so the steady state is
  a `304` and no work at all.
- The source owns the calendar completely. Its events cannot be edited in the
  admin GUI, anything already on the calendar is removed by the first sync, and
  anything the source drops is removed on the next one. The Server Actions
  enforce this themselves, not just the UI.
- Published `UID`s are **ours**, never the source's. Some publishers regenerate
  UIDs on every export, and echoing those out would show subscribers the whole
  calendar being deleted and recreated on every poll.
- `SEQUENCE` moves only when an event's visible content actually changed, so a
  poll every 30 minutes does not re-notify every subscriber of every event.
- **Descriptions from the source are discarded.** Publishers bury tracking links
  and internal identifiers there — Deputy appends a mobile deep link carrying the
  tenant hostname and the roster ID to every shift — and a mirrored calendar
  usually exists in order to be published, where anyone with the URL can read it.
  Summary, location, times and recurrence are kept. The strip happens before the
  content hash, so an upstream description-only edit is correctly no change.

Two safety behaviours worth knowing, because both are silent otherwise:

- A source that parses to **zero events** while the calendar holds some is
  treated as a failure, not as an empty calendar. A truncated response or an
  expired link serving a login page must not delete a month of shifts.
- A failed sync leaves the mirrored events exactly as they were and records the
  reason on `/admin/calendars`.

Subscription URLs on a private network (`localhost`, `10.x`, `192.168.x`, a NAS
on the LAN) are refused unless `SYNC_ALLOW_PRIVATE_HOSTS=true`, so a mistyped
address cannot make the server fetch something on its own network.

### Publishing a merged feed

A **feed** (`/admin/feeds`) maps a slug to a set of calendars and serves them as
one `.ics`:

```
/calendars/work-shifts.ics    shifts only     (subscribed, mirrored)
/calendars/meetings.ics       your own events
/calendars/work-combined.ics  BOTH, one feed  ← hand this one out
/calendars/all.ics            every public calendar
```

A calendar in a feed is published there **even when it is marked private**. That
is the point: the raw mirror can stay off the public site while its events still
reach the feed. Only the feed's own public toggle hides the feed.

Calendar slugs, feed slugs and the reserved word `all` share one namespace, since
all three resolve through `/calendars/<slug>.ics`. Uniqueness is checked across
all of them.

---

## Local development

```bash
pnpm install
cp .env.example .env.local     # set SITE_URL=http://localhost:3000
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Optional sample data across four calendars, including a recurring series with a
skipped and a moved occurrence:

```bash
node --env-file=.env.local scripts/dev-seed.mjs
```

| Command | |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm start` | Production build and run |
| `pnpm test` | Vitest |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |

---

## How it works

**Storage.** All instants are UTC epoch milliseconds. Conversion into
`SCHEDULER_TIMEZONE` happens only at the edges — the calendar UI and the `.ics`
writer. Five tables: `calendars`, `events`, `event_overrides` (per-occurrence
edits, keyed by `RECURRENCE-ID`), and `published_feeds` with its
`published_feed_calendars` membership join.

**Recurrence.** The `rrule` library has no timezone awareness, so expansion runs
in "floating UTC": local wall-clock components go in, the zone is reattached on
the way out. Without that a weekly 14:00 meeting drifts by an hour across a DST
boundary. `UNTIL` is stored and emitted as UTC, per RFC 5545, and converted to
the same floating basis before comparison.

**Syncing.** The poller is started from `instrumentation.ts` when the server
boots, and lives in the server process — correct for a single container, and the
thing that would have to move first if this were ever scaled out. `register()`
only schedules; awaiting a network fetch there would delay every deploy by
however long the slowest remote calendar takes to answer.

**Feeds.** Generated per request from the database — never written to disk, so
an admin edit is live immediately with no file to fall out of sync. Timed events
carry `TZID` plus a real `VTIMEZONE` with DST rules; a bare UTC `DTSTART` would
make recurring events drift in subscribers' clients. `SEQUENCE` increments on
every edit, without which clients ignore updates. An `ETag` makes the common
unchanged poll cost a `304`.

**Auth.** A hand-rolled Google OAuth flow with PKCE, verifying the `id_token`
against Google's JWKS. Chosen over Auth.js v5, which is still beta with unproven
Next 16 support; for a single hard-coded admin this is a much smaller surface.
Sessions are stateless `jose`-signed cookies.

Authorisation lives in `lib/auth/dal.ts` and is called by every admin page **and
every Server Action** — actions are reachable by direct POST regardless of what
the UI renders. `proxy.ts` (Next 16's rename of `middleware.ts`) only does an
optimistic cookie-presence redirect; it runs on prefetches and is not a security
boundary.

---

## Notes

Two packages are in `serverExternalPackages` and must stay there:
`better-sqlite3` ships a native binary, and `@touch4it/ical-timezones` reads
tzdata from its own package directory — bundled, its generator silently returns
nothing and feeds ship `TZID` references with no matching `VTIMEZONE`.

This project tracks a Next.js version with breaking changes relative to most
training data. `AGENTS.md` is maintained by `next dev`; the bundled docs under
`node_modules/next/dist/docs/` are the authority.

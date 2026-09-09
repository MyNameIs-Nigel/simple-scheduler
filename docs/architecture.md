# System Architecture

This document describes the internal architecture, design principles, data flow, and invariants of `simple-scheduler`.

---

## High-Level Overview

`simple-scheduler` is structured as a unified Next.js 16 application running on Node.js. It functions both as an interactive web application (public schedule views and admin console) and as an RFC 5545 iCalendar feed server.

```
                      ┌──────────────────────────────────────┐
                      │          Cloudflare Tunnel           │
                      └──────────────────┬───────────────────┘
                                         │ HTTP
                                         ▼
                      ┌──────────────────────────────────────┐
                      │        Next.js App Server            │
                      │                                      │
   Public User        │  GET /               (Month/Week/    │
   ───────────────────┼►                     Agenda views)   │
                      │                                      │
   Calendar Client    │  GET /calendars/*.ics (Dynamic feeds) │
   ───────────────────┼►                                     │
                      │                                      │
   Admin Browser      │  /admin/*            (Management UI) │
   ───────────────────┼► POST Server Actions (CRUD / Sync)   │
                      │                                      │
   Background Poller  │  instrumentation.ts   (Cron runner)  │
   ───────────────────┼► lib/sync/runner.ts                  │
                      └──────────────────┬───────────────────┘
                                         │ In-Process SQLite
                                         ▼
                      ┌──────────────────────────────────────┐
                      │       SQLite Database (data/)        │
                      │  calendars, events, overrides, feeds │
                      └──────────────────────────────────────┘
```

### Key Architectural Invariants

1. **Storage in UTC Epoch Milliseconds**:
   All event instants (`dtstart`, `dtend`, `recurrenceId`, exdates) are stored as integer Unix epoch milliseconds in UTC. Timezone conversion to `SCHEDULER_TIMEZONE` occurs strictly at the rendering edges (the web UI, form inputs, and the `.ics` generator). The database never stores wall-clock strings or timezone offsets.

2. **Feeds Generated On-Demand**:
   Subscribable `.ics` files are never written to static files on disk. Instead, the route handler `app/calendars/[slug]/route.ts` calls `lib/ics/build.ts` to dynamically assemble RFC 5545 streams straight from SQLite. Edits made in the admin UI or via background sync are immediately visible on subsequent requests.

3. **In-Process Single SQLite Instance**:
   The application uses `better-sqlite3` directly within the server process. Background sync, admin mutations, and read queries all operate against the same SQLite database file using WAL (Write-Ahead Logging) mode and foreign key enforcement.

4. **Security Enforced in Data Access Layer (DAL)**:
   Routing proxies (`proxy.ts` in Next.js 16) only perform optimistic redirects for browser requests. Real authorization is enforced in `lib/auth/dal.ts` (`requireAdmin()`), which executes at the start of every admin page and Server Action.

---

## Database Schema & Storage

The database layer is managed using Drizzle ORM and stored in `./data/scheduler.db`.

```
               ┌───────────────────────┐
               │       calendars       │
               │───────────────────────│
               │ id (PK)               │
               │ slug (UNIQUE)         │
               │ name                  │
               │ accent, is_public     │
               │ source_url, etag...   │
               └───────────┬───────────┘
                           │ 1
                           │
                           │ N
               ┌───────────▼───────────┐
               │        events         │
               │───────────────────────│
               │ id (PK)               │
               │ calendar_id (FK)      │
               │ uid (UNIQUE)          │
               │ summary, description  │
               │ dtstart, dtend (ms)   │
               │ rrule, exdates        │
               │ source_uid, hash      │
               └───────────┬───────────┘
                           │ 1
                           │
                           │ N
               ┌───────────▼───────────┐
               │    event_overrides    │
               │───────────────────────│
               │ id (PK)               │
               │ event_id (FK)         │
               │ recurrence_id (ms)    │
               │ summary, dtstart...   │
               │ cancelled (bool)      │
               └───────────────────────┘

┌────────────────────────┐         ┌────────────────────────┐
│    published_feeds     │ 1     N │published_feed_calendars│
│────────────────────────┼─────────┼────────────────────────│
│ id (PK)                │         │ feed_id (FK)           │
│ slug (UNIQUE)          │         │ calendar_id (FK)       │
│ name, is_public        │         └────────────────────────┘
└────────────────────────┘
```

### Table Definitions (`db/schema.ts`)

- **`calendars`**:
  Stores calendar metadata (`slug`, `name`, `accent`, `isPublic`, `sortOrder`). Also maintains subscription state: `sourceUrl`, `sourceEtag`, `sourceLastModified`, `lastSyncedAt`, `lastSyncStatus`, and error messages.
- **`events`**:
  Contains base events. For non-recurring events, represents a single commitment. For recurring events, contains the `rrule` string and JSON array of excluded dates (`exdates`). Also stores RFC 5545 `sequence` and mirror tracking columns (`sourceUid`, `contentHash`).
- **`event_overrides`**:
  Models per-occurrence modifications or cancellations of recurring series. Keyed by `(eventId, recurrenceId)`. If an instance is rescheduled or moved, `recurrenceId` holds the original scheduled start time under the RRULE.
- **`published_feeds` & `published_feed_calendars`**:
  Enables grouping arbitrary calendars (public or private) into a single composite subscribable feed identified by a unique `slug`.

---

## Recurrence & Timezone Handling

Handling recurring events across daylight saving time transitions is notoriously tricky in JavaScript because the standard `rrule` package evaluates rules in naive UTC without timezone awareness.

### The "Floating UTC" Pattern (`lib/time.ts` & `lib/events/expand.ts`)

If a recurring event is scheduled for 14:00 in `America/New_York` (UTC-5 in winter, UTC-4 in summer), feeding real UTC instants to `rrule` causes the wall-clock time to shift by one hour across DST boundaries.

To solve this, `simple-scheduler` implements the **Floating UTC** pattern:
1. **To Floating**: Convert the local wall-clock components (year, month, day, hour, minute) in `SCHEDULER_TIMEZONE` into a JavaScript `Date` whose UTC fields match those wall-clock values (`toFloating()`).
2. **Expansion**: Run `rrule.between()` over the floating date interval.
3. **From Floating**: Convert each floating UTC result back into a true UTC epoch millisecond instant in `SCHEDULER_TIMEZONE` (`fromFloating()`).
4. **Overrides & Exclusions**: Reconcile expanded occurrences against `event_overrides` and `exdates` using `recurrenceId`.

```
[Store: UTC ms] ──► [toFloating: Wall time into UTC Date] ──► [rrule.between()]
                                                                      │
[Materialised Occurrence] ◄── [fromFloating: Attach Zone] ◄───────────┘
```

---

## Feed Generation Pipeline (`lib/ics/build.ts`)

When an iCalendar feed is requested at `/calendars/<slug>.ics`:

1. **Slug Resolution**:
   - `all`: Gathers all public calendars.
   - `<slug>`: Matches an individual public calendar, or a composite `published_feeds` entry. If matching a published feed, member calendars are included even if marked private individually.
2. **Event & Override Query**:
   Fetches all event rows and override rows for the targeted calendars.
3. **iCalendar Assembly**:
   - Generates proper RFC 5545 structures using `ical-generator`.
   - Embeds exact `VTIMEZONE` components generated from tzdata by `@touch4it/ical-timezones`.
   - Sets `TZID` on all timed events to prevent client drift.
   - Emits modified occurrences as distinct `VEVENT` components bearing `RECURRENCE-ID` and matching the parent's `UID`.
   - Emits all-day events with `VALUE=DATE` and exclusive `DTEND`.
4. **Caching & Conditional Requests**:
   - Computes a SHA-256 ETag from the generated output.
   - Compares incoming `If-None-Match` header to return `304 Not Modified` when content has not changed.

---

## Authentication & Authorization Architecture

The application has a single administrative owner defined by `ADMIN_EMAIL`.

```
User Browser                    App Server (/admin)              Google OAuth
     │                                  │                             │
     ├──────── GET /admin ─────────────►│                             │
     │                                  │ (proxy.ts redirects         │
     │◄─────── Redirect /login ─────────┤  if no session cookie)      │
     │                                  │                             │
     ├──────── GET /api/auth/google ───►│                             │
     │                                  │ Sets signed state cookie    │
     │◄─────── Redirect to Google ──────┤                             │
     │                                                                │
     ├────────────────────── Authenticate via Google ────────────────►│
     │◄───────────────────── Authorization Code ──────────────────────┤
     │                                                                │
     ├──────── GET /api/auth/callback/google?code=... ───────────────►│
     │                                  ├───── Exchange token ───────►│
     │                                  │◄──── id_token (JWKS verify)─┤
     │                                  │ Validate email === ADMIN    │
     │                                  │ Create signed session JWT   │
     │◄─────── Redirect /admin ─────────┤ (Set-Cookie: scheduler_...) │
```

### Components:
- **`lib/auth/google.ts`**: Hand-rolled OAuth 2.0 with PKCE (S256). Exchanges codes and verifies the Google `id_token` against Google's public JWKS certificates using `jose`.
- **`lib/auth/session.ts`**: Issues stateless, encrypted/signed JWTs stored in the `scheduler_session` HTTP-only cookie with a 7-day TTL.
- **`lib/auth/dal.ts`**: Provides `requireAdmin()`. Checks the session cookie signature using `SESSION_SECRET` and verifies case-insensitive equality against `ADMIN_EMAIL`.
- **`proxy.ts`**: Lightweight middleware redirecting unauthenticated browser visits from `/admin/*` to `/login`.

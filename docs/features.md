# Features & Capabilities

This guide covers the functional capabilities of `simple-scheduler`: subscribed calendar mirroring, merged feeds, recurring events, and iCalendar imports.

---

## 1. Subscribed Calendars (External Mirrors)

Subscribed calendars allow `simple-scheduler` to act as an automated aggregator of external iCalendar URLs (e.g. university timetables, work shifts, external Google Calendars).

### How Mirroring Works
- Enter an external calendar URL (`https://` or `webcal://`) in `/admin/calendars/new` or `/admin/calendars/[id]`.
- The background runner (`lib/sync/runner.ts`) polls the external source every `SYNC_INTERVAL_MINUTES` (default 30 mins).
- The synchronization engine issues conditional requests with `If-None-Match` and `If-Modified-Since`. If the source returns `304 Not Modified`, no further processing or database updates occur.
- You can manually trigger an immediate synchronization by clicking **Sync now** on `/admin/calendars`.

### Safety & Sanitization Invariants
- **Read-Only Ownership**: The external source owns the calendar completely. Events cannot be edited or added manually in the admin UI, and any manual edit is overwritten by the sync engine.
- **Stable Internal UIDs**: Upstream UIDs are mapped to `source_uid`. Stable internal UIDs (`uid@SITE_URL`) are generated and preserved. If an upstream publisher regenerates UIDs on every export, the scheduler prevents subscriber churn.
- **SEQUENCE Increments on Content Changes**: A SHA-256 hash of visible event fields (`summary`, `location`, `times`, `status`, `rrule`) is compared. The RFC 5545 `SEQUENCE` property increments only when visible event details change.
- **Description Stripping**: External descriptions often include tracking links, session identifiers, or mobile deep links (e.g. Deputy roster links). Because mirrored calendars are often re-published, external descriptions are stripped before storing and hashing.
- **Zero-Event Protection**: If an upstream fetch returns zero events while the calendar previously had events, the sync fails with an error rather than deleting the existing schedule. This prevents transient upstream outages from clearing your calendar.
- **Private Host Defense**: Subscribing to internal or loopback IP addresses (`127.0.0.1`, `192.168.x`) is rejected unless `SYNC_ALLOW_PRIVATE_HOSTS=true`.

---

## 2. Published Feeds (Merged Feeds)

Published feeds (`/admin/feeds`) allow combining multiple calendars into a single subscribable `.ics` URL.

### Single Namespace Architecture
Calendar slugs, feed slugs, and the reserved word `all` share a unified URL namespace:
- `/calendars/all.ics`: Combines all public calendars.
- `/calendars/<calendar-slug>.ics`: Streams events for a single calendar.
- `/calendars/<feed-slug>.ics`: Streams a merged collection of designated member calendars.

### Privacy Decoupling
Published feeds intentionally decouple member calendar visibility from the feed's visibility:
- A calendar can be marked `isPublic: false` (hidden from the public web interface and omitted from `/calendars/all.ics`).
- That private calendar can still be assigned to a published feed (e.g., `/calendars/work-combined.ics`).
- Subscribers to `work-combined.ics` receive those events without exposing the raw mirror to the public site.

---

## 3. Recurring Events & Overrides

`simple-scheduler` supports recurring events via RFC 5545 `RRULE` strings.

### Recurrence Options
The admin event editor supports:
- **Frequency**: Daily, Weekly (with weekday selection), Monthly, Yearly.
- **Intervals**: Every N days, weeks, months, or years.
- **End Conditions**: Never, After N occurrences (`COUNT`), or Until a specific date (`UNTIL`).

### Occurrence Overrides (`event_overrides`)
A recurring series can have individual occurrences customized or skipped:
- **Rescheduled Occurrences**: Moving a single instance creates an `event_overrides` record referencing the parent event and `recurrence_id` (the original scheduled instant).
- **Cancelled Occurrences**: When a single occurrence is skipped, an override with `cancelled: true` or an entry in `events.exdates` is stored. In iCalendar feeds, cancelled instances are emitted with `STATUS:CANCELLED` so client applications remove them properly.

---

## 4. iCalendar File Import

The admin console provides a one-time import utility at `/admin/import`:
- Upload an existing `.ics` export file from Google Calendar, Apple Calendar, or Outlook.
- Previews total events, recurring series, date ranges, and potential parsing anomalies before writing to the database.
- Normalizes timezones to `SCHEDULER_TIMEZONE` and converts all timestamps into UTC epoch milliseconds.
- Drops invalid or duplicate recurrence overrides safely while logging warnings.

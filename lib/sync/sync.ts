import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "@/db/mutations";
import { calendars, events, type Calendar, type EventRow } from "@/db/schema";
import { parseIcs, type ParsedEvent } from "@/lib/ics/import";
import { fetchIcsSource, type FetchResult } from "./fetch";

/**
 * Mirroring a remote .ics into a calendar.
 *
 * The database handle is a parameter, matching db/mutations.ts, so the rules
 * that are easy to get wrong — when SEQUENCE moves, when a missing event is
 * safe to delete, what happens to a source with no UIDs — can be tested
 * directly against a temporary file.
 *
 * The calendar's events are wholly owned by its source: the admin actions
 * refuse to edit them, and anything not present in the fetched feed is removed.
 * That is what keeps a mirror an actual mirror rather than a pile of leftovers.
 */

export type SyncOutcome = {
  ok: boolean;
  /** Nothing changed upstream — the cheap, normal case. */
  notModified?: boolean;
  created: number;
  updated: number;
  deleted: number;
  /** Rows whose content changed, i.e. the ones whose SEQUENCE moved. */
  resequenced: number;
  skippedOverrides: number;
  message: string;
};

export type SyncOptions = {
  zone: string;
  /** Host for generated UIDs, e.g. schedule.nigel-smith.dev. */
  host: string;
  now?: number;
  fetchImpl?: typeof fetch;
};

/**
 * The fields a subscriber can actually see. Anything outside this list changing
 * must not move SEQUENCE — a poll every 30 minutes would otherwise re-notify
 * every client of every event, forever.
 */
function contentHashOf(entry: ParsedEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entry.summary,
        entry.description,
        entry.location,
        entry.url,
        entry.dtstart,
        entry.dtend,
        entry.allDay,
        entry.rrule,
        entry.exdates,
        entry.status,
      ]),
    )
    .digest("base64url")
    .slice(0, 32);
}

/**
 * Descriptions from a subscribed source are dropped, always.
 *
 * The prompt for this was Deputy, which appends a mobile deep link to every
 * shift's DESCRIPTION: a couple of hundred unbroken characters carrying the
 * tenant hostname and the internal roster ID. None of that is a credential,
 * but a mirrored calendar is usually mirrored in order to be *published*, and
 * a published .ics is readable by anyone holding the URL. What is left of such
 * a description once the link is gone is typically boilerplate anyway
 * ("Breaks: Meal Break (Unpaid): 30 mins").
 *
 * Applied before the content hash is taken, so an upstream edit that only
 * touches the description is correctly seen as no change at all and does not
 * move SEQUENCE. Summary, location, times and recurrence are untouched — the
 * fields a schedule is actually read for.
 *
 * Hand-entered calendars keep their descriptions; this is only ever reached
 * for a calendar with a source URL.
 */
function stripDescription(entry: ParsedEvent): ParsedEvent {
  return entry.description === null ? entry : { ...entry, description: null };
}

/**
 * The key the sync matches on across polls.
 *
 * A UID is what the spec is for, but plenty of published feeds omit it. Falling
 * back to the event's own identifying content at least keeps an unchanged event
 * matching itself; move such an event upstream and it reads as a delete plus an
 * insert, which is the best that can be done without an identifier.
 */
function sourceKeyOf(entry: ParsedEvent): string {
  if (entry.uid) return entry.uid;
  const digest = createHash("sha256")
    .update(JSON.stringify([entry.summary, entry.dtstart, entry.dtend]))
    .digest("base64url")
    .slice(0, 24);
  return `synthetic:${digest}`;
}

/** Fetches and applies one calendar's source. Never throws; failures land in the outcome. */
export async function syncCalendarSource(
  db: Db,
  calendar: Calendar,
  opts: SyncOptions,
): Promise<SyncOutcome> {
  const now = opts.now ?? Date.now();

  if (!calendar.sourceUrl) {
    return empty("That calendar has no subscription URL.");
  }

  const result: FetchResult = await fetchIcsSource(calendar.sourceUrl, {
    etag: calendar.sourceEtag,
    lastModified: calendar.sourceLastModified,
    fetchImpl: opts.fetchImpl,
  });

  if (result.kind === "error") {
    recordFailure(db, calendar.id, result.message, now);
    return { ...empty(result.message), ok: false };
  }

  if (result.kind === "not_modified") {
    // Still stamp the time, or the calendar stays permanently "due" and we
    // re-issue the conditional GET on every tick.
    db.update(calendars)
      .set({ lastSyncedAt: now, lastSyncStatus: "ok", lastSyncError: null })
      .where(eq(calendars.id, calendar.id))
      .run();
    return { ...empty("Not modified."), ok: true, notModified: true };
  }

  const parsed = parseIcs(result.body, opts.zone);

  const existing = db
    .select()
    .from(events)
    .where(eq(events.calendarId, calendar.id))
    .all() as EventRow[];

  // A feed that yields no usable events is almost always a broken source — a
  // truncated response, a login page that happened to contain the word
  // VCALENDAR, or entries we could not read.
  if (parsed.events.length === 0) {
    // Entries were present but none survived parsing. That is a failure
    // whatever the calendar currently holds: reporting "0 added" against an
    // empty calendar would look like a clean sync of a genuinely empty
    // schedule, which is exactly the wrong thing to believe.
    if (parsed.problems.length > 0) {
      const message =
        parsed.problems.length === 1
          ? parsed.problems[0]
          : `${parsed.problems[0]} (${parsed.problems.length} entries could not be read)`;
      recordFailure(db, calendar.id, message, now);
      return { ...empty(message), ok: false };
    }

    // Nothing to read and nothing to complain about. Only suspicious if we
    // already hold events — emptying a calendar on a silent response would
    // quietly delete a month of shifts.
    if (existing.length > 0) {
      const message = "The source returned no events, so the existing ones were left alone.";
      recordFailure(db, calendar.id, message, now);
      return { ...empty(message), ok: false };
    }
  }

  const byKey = new Map<string, ParsedEvent>();
  for (const entry of parsed.events) {
    // Last one wins on a duplicate key, matching how a client reading the file
    // top to bottom would resolve it.
    byKey.set(sourceKeyOf(entry), stripDescription(entry));
  }

  const existingByKey = new Map<string, EventRow>();
  for (const row of existing) {
    if (row.sourceUid) existingByKey.set(row.sourceUid, row);
  }

  let created = 0;
  let updated = 0;
  let resequenced = 0;

  // Rows on a mirrored calendar that carry no source key predate the
  // subscription (hand-entered, or from the upload importer). The source owns
  // this calendar now, so they go with everything else that is not in the feed.
  const stale = existing.filter((row) => !row.sourceUid || !byKey.has(row.sourceUid));

  db.transaction((tx) => {
    for (const [key, entry] of byKey) {
      const hash = contentHashOf(entry);
      const row = existingByKey.get(key);

      const values = {
        summary: entry.summary,
        description: entry.description,
        location: entry.location,
        url: entry.url,
        dtstart: entry.dtstart,
        dtend: entry.dtend,
        allDay: entry.allDay,
        rrule: entry.rrule,
        exdates: entry.exdates,
        status: entry.status,
        contentHash: hash,
        updatedAt: now,
      };

      if (!row) {
        const id = `evt_${nanoid(12)}`;
        tx.insert(events)
          .values({
            id,
            calendarId: calendar.id,
            // Ours, not the source's. Deliberate — see the note on
            // events.sourceUid in db/schema.ts.
            uid: `${id}@${opts.host}`,
            sourceUid: key,
            sequence: 0,
            createdAt: now,
            ...values,
          })
          .run();
        created += 1;
        continue;
      }

      const changed = row.contentHash !== hash;
      tx.update(events)
        .set({
          ...values,
          // Unchanged rows keep their SEQUENCE and their updatedAt, so the
          // generated feed is byte-identical and subscribers get a 304.
          ...(changed
            ? { sequence: row.sequence + 1 }
            : { updatedAt: row.updatedAt, contentHash: row.contentHash }),
        })
        .where(eq(events.id, row.id))
        .run();

      updated += 1;
      if (changed) resequenced += 1;
    }

    if (stale.length > 0) {
      tx.delete(events)
        .where(
          and(
            eq(events.calendarId, calendar.id),
            inArray(
              events.id,
              stale.map((row) => row.id),
            ),
          ),
        )
        .run();
    }

    tx.update(calendars)
      .set({
        sourceEtag: result.etag,
        sourceLastModified: result.lastModified,
        lastSyncedAt: now,
        lastSyncStatus: "ok",
        lastSyncError: null,
        lastSyncCount: byKey.size,
        lastSyncSkipped: parsed.skippedOverrides,
      })
      .where(eq(calendars.id, calendar.id))
      .run();
  });

  const notes = [`${created} added`, `${resequenced} changed`, `${stale.length} removed`];
  if (parsed.skippedOverrides > 0) {
    notes.push(`${parsed.skippedOverrides} modified occurrence(s) skipped`);
  }

  return {
    ok: true,
    created,
    updated,
    deleted: stale.length,
    resequenced,
    skippedOverrides: parsed.skippedOverrides,
    message: notes.join(", "),
  };
}

function recordFailure(db: Db, calendarId: string, message: string, now: number) {
  // lastSyncedAt records the last *attempt*, failures included. Leaving it
  // untouched would keep the calendar permanently due, so a source that is
  // down would be retried on every 60s tick rather than on its own interval —
  // an impolite amount of traffic to send at a third party having a bad day.
  // lastSyncCount and the events themselves still describe the last good sync.
  db.update(calendars)
    .set({ lastSyncedAt: now, lastSyncStatus: "error", lastSyncError: message })
    .where(eq(calendars.id, calendarId))
    .run();
}

function empty(message: string): SyncOutcome {
  return {
    ok: true,
    created: 0,
    updated: 0,
    deleted: 0,
    resequenced: 0,
    skippedOverrides: 0,
    message,
  };
}

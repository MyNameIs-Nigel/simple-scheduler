import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import {
  calendars,
  eventOverrides,
  events,
  publishedFeedCalendars,
  publishedFeeds,
} from "./schema";
import * as schema from "./schema";

/**
 * Write logic, separated from the Server Actions that call it.
 *
 * The actions in app/admin/actions.ts do auth, FormData parsing and
 * revalidation; everything that actually decides what lands in the database
 * lives here. That split exists because the subtle rules — when SEQUENCE has to
 * increment, when per-occurrence overrides stop being valid, how an inclusive
 * end date becomes an exclusive DTEND — are worth testing directly, and a
 * `useActionState` action cannot be called without reproducing React's RSC
 * encoding of its bound previous state.
 *
 * The database handle is a parameter rather than the module singleton so tests
 * can run against a temporary file.
 */

export type Db = BetterSQLite3Database<typeof schema>;

export type SaveEventInput = {
  /** Absent for a create. */
  id?: string;
  calendarId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  allDay: boolean;
  /** UTC epoch ms. For all-day, midnight in the scheduler's zone. */
  dtstart: number;
  /** UTC epoch ms, exclusive. */
  dtend: number;
  rrule: string | null;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
};

export type SaveEventResult =
  | { ok: true; id: string; created: boolean; clearedOverrides: boolean }
  | { ok: false; reason: "not_found" };

export function saveEventRecord(
  db: Db,
  input: SaveEventInput,
  opts: { host: string; now?: number },
): SaveEventResult {
  const now = opts.now ?? Date.now();

  const shared = {
    calendarId: input.calendarId,
    summary: input.summary,
    description: input.description || null,
    location: input.location || null,
    url: input.url || null,
    dtstart: input.dtstart,
    dtend: input.dtend,
    allDay: input.allDay,
    rrule: input.rrule,
    status: input.status,
    updatedAt: now,
  };

  if (!input.id) {
    const id = `evt_${nanoid(12)}`;
    db.insert(events)
      .values({
        id,
        // Stable for the life of the event — never regenerated on edit, so
        // subscribers update an existing entry instead of duplicating it.
        uid: `${id}@${opts.host}`,
        exdates: null,
        sequence: 0,
        createdAt: now,
        ...shared,
      })
      .run();

    return { ok: true, id, created: true, clearedOverrides: false };
  }

  const [existing] = db.select().from(events).where(eq(events.id, input.id)).limit(1).all();
  if (!existing) return { ok: false, reason: "not_found" };

  // Overrides and EXDATEs are keyed to the occurrence slots the old rule
  // produced. Move the series start or change the rule and those keys point at
  // instants that no longer exist, so they are dropped rather than left to
  // silently do nothing.
  const clearedOverrides =
    existing.dtstart !== input.dtstart || existing.rrule !== input.rrule;

  db.update(events)
    .set({
      ...shared,
      // RFC 5545: a subscriber ignores an update whose SEQUENCE has not moved.
      sequence: existing.sequence + 1,
      ...(clearedOverrides ? { exdates: null } : {}),
    })
    .where(eq(events.id, input.id))
    .run();

  if (clearedOverrides) {
    db.delete(eventOverrides).where(eq(eventOverrides.eventId, input.id)).run();
  }

  return { ok: true, id: input.id, created: false, clearedOverrides };
}

/** Appends an occurrence to the series' EXDATE list. */
export function skipOccurrenceRecord(
  db: Db,
  eventId: string,
  recurrenceId: number,
  now = Date.now(),
): boolean {
  const [event] = db.select().from(events).where(eq(events.id, eventId)).limit(1).all();
  if (!event) return false;

  const exdates = new Set(event.exdates ?? []);
  exdates.add(recurrenceId);

  db.update(events)
    .set({
      exdates: [...exdates].sort((a, b) => a - b),
      sequence: event.sequence + 1,
      updatedAt: now,
    })
    .where(eq(events.id, eventId))
    .run();

  // A skipped occurrence and an override for the same slot would contradict.
  db.delete(eventOverrides)
    .where(and(eq(eventOverrides.eventId, eventId), eq(eventOverrides.recurrenceId, recurrenceId)))
    .run();

  return true;
}

/** Removes an occurrence from the EXDATE list. */
export function restoreOccurrenceRecord(
  db: Db,
  eventId: string,
  recurrenceId: number,
  now = Date.now(),
): boolean {
  const [event] = db.select().from(events).where(eq(events.id, eventId)).limit(1).all();
  if (!event) return false;

  const remaining = (event.exdates ?? []).filter((d) => d !== recurrenceId);

  db.update(events)
    .set({
      exdates: remaining.length > 0 ? remaining : null,
      sequence: event.sequence + 1,
      updatedAt: now,
    })
    .where(eq(events.id, eventId))
    .run();

  return true;
}

export type SaveCalendarInput = {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  accent: number;
  isPublic: boolean;
  /** Non-null turns the calendar into a read-only mirror of a remote .ics. */
  sourceUrl?: string | null;
};

export type SaveCalendarResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "slug_taken" };

export function saveCalendarRecord(
  db: Db,
  input: SaveCalendarInput,
  now = Date.now(),
): SaveCalendarResult {
  if (!isSlugAvailable(db, input.slug, { calendarId: input.id })) {
    return { ok: false, reason: "slug_taken" };
  }

  const shared = {
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    accent: input.accent,
    isPublic: input.isPublic,
    sourceUrl: input.sourceUrl || null,
    updatedAt: now,
  };

  if (input.id) {
    const [existing] = db
      .select()
      .from(calendars)
      .where(eq(calendars.id, input.id))
      .limit(1)
      .all();

    // Changing or clearing the source invalidates everything cached about the
    // old one. Leaving a stale ETag behind would make the first sync against a
    // new URL answer 304 and mirror nothing at all.
    const sourceChanged = existing !== undefined && existing.sourceUrl !== shared.sourceUrl;

    db.update(calendars)
      .set(
        sourceChanged
          ? {
              ...shared,
              sourceEtag: null,
              sourceLastModified: null,
              lastSyncedAt: null,
              lastSyncStatus: null,
              lastSyncError: null,
              lastSyncCount: null,
              lastSyncSkipped: null,
            }
          : shared,
      )
      .where(eq(calendars.id, input.id))
      .run();

    return { ok: true, id: input.id, created: false };
  }

  const id = `cal_${nanoid(12)}`;
  const count = db.select({ id: calendars.id }).from(calendars).all().length;

  db.insert(calendars)
    .values({ id, sortOrder: count, createdAt: now, ...shared })
    .run();

  return { ok: true, id, created: true };
}

/* -------------------------------------------------------------------------- */
/* Published feeds                                                            */
/* -------------------------------------------------------------------------- */

/** Reserved for the combined feed of every public calendar. */
export const RESERVED_SLUGS = new Set(["all"]);

/**
 * Calendars, feeds and the reserved word `all` all resolve through
 * /calendars/<slug>.ics, so they share one namespace and a clash would silently
 * reroute a URL somebody has already subscribed to. A unique index per table
 * cannot see across that, which is why this is checked in code.
 */
export function isSlugAvailable(
  db: Db,
  slug: string,
  exclude: { calendarId?: string; feedId?: string } = {},
): boolean {
  if (RESERVED_SLUGS.has(slug)) return false;

  const calendarClash = db
    .select({ id: calendars.id })
    .from(calendars)
    .where(eq(calendars.slug, slug))
    .limit(1)
    .all();
  if (calendarClash.length > 0 && calendarClash[0].id !== exclude.calendarId) return false;

  const feedClash = db
    .select({ id: publishedFeeds.id })
    .from(publishedFeeds)
    .where(eq(publishedFeeds.slug, slug))
    .limit(1)
    .all();
  if (feedClash.length > 0 && feedClash[0].id !== exclude.feedId) return false;

  return true;
}

export type SaveFeedInput = {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  isPublic: boolean;
  calendarIds: string[];
};

export type SaveFeedResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "slug_taken" | "no_calendars" };

export function saveFeedRecord(
  db: Db,
  input: SaveFeedInput,
  now = Date.now(),
): SaveFeedResult {
  if (!isSlugAvailable(db, input.slug, { feedId: input.id })) {
    return { ok: false, reason: "slug_taken" };
  }

  // An empty feed is a valid .ics but a useless URL, and almost always means
  // the checkboxes were missed rather than that an empty feed was wanted.
  const calendarIds = [...new Set(input.calendarIds)].filter(Boolean);
  if (calendarIds.length === 0) return { ok: false, reason: "no_calendars" };

  const shared = {
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    isPublic: input.isPublic,
    updatedAt: now,
  };

  const id = input.id ?? `feed_${nanoid(12)}`;
  const created = !input.id;

  db.transaction((tx) => {
    if (created) {
      const count = tx.select({ id: publishedFeeds.id }).from(publishedFeeds).all().length;
      tx.insert(publishedFeeds)
        .values({ id, sortOrder: count, createdAt: now, ...shared })
        .run();
    } else {
      tx.update(publishedFeeds).set(shared).where(eq(publishedFeeds.id, id)).run();
    }

    // Membership is small and fully specified by the form, so replacing it
    // wholesale is simpler than diffing and cannot leave a stale row behind.
    tx.delete(publishedFeedCalendars).where(eq(publishedFeedCalendars.feedId, id)).run();
    for (const calendarId of calendarIds) {
      tx.insert(publishedFeedCalendars).values({ feedId: id, calendarId }).run();
    }
  });

  return { ok: true, id, created };
}

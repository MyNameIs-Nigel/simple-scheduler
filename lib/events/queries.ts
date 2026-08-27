import "server-only";

import { and, asc, eq, inArray, isNotNull, lt, or, gt } from "drizzle-orm";

import { db } from "@/db";
import {
  calendars,
  eventOverrides,
  events,
  publishedFeedCalendars,
  publishedFeeds,
  type Calendar,
  type EventRow,
  type PublishedFeed,
} from "@/db/schema";

/**
 * Read helpers shared by the public UI and the .ics writer.
 *
 * Recurring events are always fetched in full: a row with an RRULE can produce
 * an occurrence inside any window regardless of its own dtstart, so it cannot
 * be filtered by date in SQL. Non-recurring rows are range-filtered in SQL,
 * which is what keeps the common case cheap.
 */

export async function listCalendars(opts: { publicOnly?: boolean } = {}): Promise<Calendar[]> {
  const rows = await db
    .select()
    .from(calendars)
    .orderBy(asc(calendars.sortOrder), asc(calendars.name));

  return opts.publicOnly ? rows.filter((c) => c.isPublic) : rows;
}

export async function getCalendarBySlug(slug: string): Promise<Calendar | undefined> {
  const [row] = await db.select().from(calendars).where(eq(calendars.slug, slug)).limit(1);
  return row;
}

export async function getCalendarById(id: string): Promise<Calendar | undefined> {
  const [row] = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1);
  return row;
}

/** Every event on the given calendars that could touch [rangeStart, rangeEnd). */
export async function listEventsInRange(params: {
  calendarIds: string[];
  rangeStart: number;
  rangeEnd: number;
}): Promise<EventRow[]> {
  const { calendarIds, rangeStart, rangeEnd } = params;
  if (calendarIds.length === 0) return [];

  return db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.calendarId, calendarIds),
        or(
          isNotNull(events.rrule),
          and(gt(events.dtend, rangeStart), lt(events.dtstart, rangeEnd)),
        ),
      ),
    )
    .orderBy(asc(events.dtstart));
}

/** Every event on the given calendars, unfiltered — used by the .ics writer. */
export async function listAllEvents(calendarIds: string[]): Promise<EventRow[]> {
  if (calendarIds.length === 0) return [];
  return db
    .select()
    .from(events)
    .where(inArray(events.calendarId, calendarIds))
    .orderBy(asc(events.dtstart));
}

export async function listOverridesFor(eventIds: string[]) {
  if (eventIds.length === 0) return [];
  return db.select().from(eventOverrides).where(inArray(eventOverrides.eventId, eventIds));
}

export async function getEventById(id: string): Promise<EventRow | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row;
}

export async function listEventsForCalendar(calendarId: string): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(eq(events.calendarId, calendarId))
    .orderBy(asc(events.dtstart));
}

export async function listRecentEvents(limit = 100): Promise<EventRow[]> {
  return db.select().from(events).orderBy(asc(events.dtstart)).limit(limit);
}

export async function countEvents(): Promise<number> {
  const rows = await db.select({ id: events.id }).from(events);
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Published feeds                                                            */
/* -------------------------------------------------------------------------- */

export async function listFeeds(opts: { publicOnly?: boolean } = {}): Promise<PublishedFeed[]> {
  const rows = await db
    .select()
    .from(publishedFeeds)
    .orderBy(asc(publishedFeeds.sortOrder), asc(publishedFeeds.name));

  return opts.publicOnly ? rows.filter((f) => f.isPublic) : rows;
}

export async function getFeedBySlug(slug: string): Promise<PublishedFeed | undefined> {
  const [row] = await db
    .select()
    .from(publishedFeeds)
    .where(eq(publishedFeeds.slug, slug))
    .limit(1);
  return row;
}

export async function getFeedById(id: string): Promise<PublishedFeed | undefined> {
  const [row] = await db.select().from(publishedFeeds).where(eq(publishedFeeds.id, id)).limit(1);
  return row;
}

/**
 * The calendars a feed publishes.
 *
 * Deliberately does not filter on calendars.isPublic: membership is explicit,
 * which is what lets a hidden subscription mirror be published as part of a
 * combined feed. The feed's own isPublic is the visibility switch.
 */
export async function listFeedCalendars(feedId: string): Promise<Calendar[]> {
  return db
    .select({ calendar: calendars })
    .from(publishedFeedCalendars)
    .innerJoin(calendars, eq(publishedFeedCalendars.calendarId, calendars.id))
    .where(eq(publishedFeedCalendars.feedId, feedId))
    .orderBy(asc(calendars.sortOrder), asc(calendars.name))
    .then((rows) => rows.map((r) => r.calendar));
}

/** Feed id -> member calendar ids, for the admin list and the edit form. */
export async function listFeedMemberships(): Promise<Map<string, string[]>> {
  const rows = await db.select().from(publishedFeedCalendars);
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const list = out.get(row.feedId);
    if (list) list.push(row.calendarId);
    else out.set(row.feedId, [row.calendarId]);
  }
  return out;
}

/** Subscribed calendars only — used by the admin status list. */
export async function listSubscribedCalendars(): Promise<Calendar[]> {
  const rows = await listCalendars();
  return rows.filter((c) => c.sourceUrl);
}

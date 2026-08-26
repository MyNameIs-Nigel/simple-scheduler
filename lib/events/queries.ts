import "server-only";

import { and, asc, eq, inArray, isNotNull, lt, or, gt } from "drizzle-orm";

import { db } from "@/db";
import { calendars, eventOverrides, events, type Calendar, type EventRow } from "@/db/schema";

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

import "server-only";

import { DateTime } from "luxon";

import {
  expandOccurrences,
  indexCalendars,
  type CalendarLookup,
  type Occurrence,
} from "@/lib/events/expand";
import { listCalendars, listEventsInRange, listOverridesFor } from "@/lib/events/queries";
import { formatDateLong, formatTime } from "@/lib/time";

/**
 * The single-day view behind `/day`, its `<title>`/`<meta>` tags and its
 * generated Open Graph image.
 *
 * One module serves all three so the page, the metadata and the image can
 * never disagree about what "that day" contains. `?date=` is the only input:
 * everything here resolves it to a YYYY-MM-DD in SCHEDULER_TIMEZONE first.
 */

/** Longest the condensed event list may run before it is cut with an ellipsis. */
export const DAY_DESCRIPTION_MAX_LENGTH = 200;

export type DaySummary = {
  /** YYYY-MM-DD in `zone` — the canonical form of whatever `?date=` held. */
  dateIso: string;
  /** Midnight starting the day, in epoch ms. */
  start: number;
  /** "Saturday 12 September 2026" — human label for the title and the image. */
  title: string;
  count: number;
  occurrences: Occurrence[];
  calendars: CalendarLookup;
  /** Condensed list ("14:00 Standup, 16:30 Gym"), truncated with … when long. */
  description: string;
};

/**
 * Validates `?date=`. Anything absent or unparseable falls back to today, the
 * same rule the month/week/agenda views apply to their anchor.
 */
export function parseDayParam(
  value: string | string[] | undefined | null,
  zone: string,
): string {
  const first = Array.isArray(value) ? value[0] : value;
  if (first) {
    const parsed = DateTime.fromISO(first, { zone });
    if (parsed.isValid) return parsed.toFormat("yyyy-MM-dd");
  }
  return DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
}

/** Half-open [start, end) covering exactly one day in `zone`. */
export function dayRange(dateIso: string, zone: string): { start: number; end: number } {
  const start = DateTime.fromISO(dateIso, { zone }).startOf("day");
  return { start: start.toMillis(), end: start.plus({ days: 1 }).toMillis() };
}

export function hrefForDay(dateIso: string): string {
  return `/day?date=${dateIso}`;
}

export function stepDay(dateIso: string, zone: string, direction: 1 | -1): string {
  return DateTime.fromISO(dateIso, { zone })
    .plus({ days: direction })
    .toFormat("yyyy-MM-dd");
}

/**
 * Condensed schema for metadata and OG text: event name plus time of day —
 * never the full date-time. All-day events carry "(all day)" instead of a time.
 */
export function describeOccurrences(
  occurrences: Occurrence[],
  zone: string,
  maxLength = DAY_DESCRIPTION_MAX_LENGTH,
): string {
  if (occurrences.length === 0) return "No events scheduled.";

  const items = occurrences.map((occ) =>
    occ.allDay ? `${occ.summary} (all day)` : `${formatTime(occ.start, zone)} ${occ.summary}`,
  );
  const joined = items.join(", ");
  if (joined.length <= maxLength) return joined;

  // Cut at the last whole event that fits; hard-slice only as a fallback when
  // even the first event overflows.
  const cutoff = joined.lastIndexOf(", ", maxLength);
  return `${cutoff === -1 ? joined.slice(0, maxLength) : joined.slice(0, cutoff)}…`;
}

export async function getDaySummary(dateIso: string, zone: string): Promise<DaySummary> {
  const { start, end } = dayRange(dateIso, zone);

  const calendars = await listCalendars({ publicOnly: true });
  const events = await listEventsInRange({
    calendarIds: calendars.map((c) => c.id),
    rangeStart: start,
    rangeEnd: end,
  });
  const overrides = await listOverridesFor(events.map((e) => e.id));
  const occurrences = expandOccurrences({
    events,
    overrides,
    rangeStart: start,
    rangeEnd: end,
    zone,
  });

  return {
    dateIso,
    start,
    title: formatDateLong(start, zone),
    count: occurrences.length,
    occurrences,
    calendars: indexCalendars(calendars),
    description: describeOccurrences(occurrences, zone),
  };
}

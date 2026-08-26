import { RRule } from "rrule";

import { fromFloating, toFloating } from "@/lib/time";
import type { Calendar, EventOverride, EventRow } from "@/db/schema";

/**
 * Expands stored events (single and recurring) into concrete occurrences
 * inside a window. This is the single source of truth for "what is on the
 * calendar between X and Y" — the month grid, the week grid, the agenda and
 * the .ics writer's sanity checks all go through it.
 */

/** Guards against a pathological rule (FREQ=SECONDLY;COUNT=1e9) wedging a request. */
const MAX_OCCURRENCES_PER_SERIES = 750;

export type Occurrence = {
  /** Parent event id — not unique across occurrences of a series. */
  eventId: string;
  /** Stable per-occurrence key, safe as a React key and a URL fragment. */
  key: string;
  calendarId: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  start: number;
  end: number;
  allDay: boolean;
  status: EventRow["status"];
  /** True when this instant came from an RRULE rather than a one-off event. */
  recurring: boolean;
  /** RECURRENCE-ID: the unmodified start this occurrence was generated at. */
  recurrenceId: number | null;
  /** True when an event_overrides row altered this occurrence. */
  overridden: boolean;
};

export type ExpandInput = {
  events: EventRow[];
  overrides: EventOverride[];
  rangeStart: number;
  rangeEnd: number;
  zone: string;
  /** Cancelled occurrences are dropped from the UI but kept for the .ics feed. */
  includeCancelled?: boolean;
};

function overrideKey(eventId: string, recurrenceId: number): string {
  return `${eventId}:${recurrenceId}`;
}

/**
 * Parses a stored RRULE against a floating dtstart.
 * Returns null for an unparseable rule so one bad row cannot blank the calendar.
 *
 * UNTIL needs care. RFC 5545 requires UNTIL to be a UTC instant whenever
 * DTSTART carries a TZID, and that is how we store and emit it. But expansion
 * happens in floating space, so a UTC UNTIL must be converted to the same
 * floating basis before rrule compares the two — otherwise the cutoff lands
 * hours off, in the wrong direction depending on the zone's offset.
 */
function buildRule(event: EventRow, zone: string): RRule | null {
  if (!event.rrule) return null;
  try {
    const options = RRule.parseString(event.rrule);
    options.dtstart = toFloating(event.dtstart, zone);
    if (options.until) {
      options.until = toFloating(options.until.getTime(), zone);
    }
    return new RRule(options);
  } catch (error) {
    console.error(`[expand] unparseable RRULE on event ${event.id}: ${event.rrule}`, error);
    return null;
  }
}

export function expandOccurrences(input: ExpandInput): Occurrence[] {
  const { events, overrides, rangeStart, rangeEnd, zone, includeCancelled = false } = input;

  const overrideMap = new Map<string, EventOverride>();
  for (const o of overrides) {
    overrideMap.set(overrideKey(o.eventId, o.recurrenceId), o);
  }

  const out: Occurrence[] = [];

  for (const event of events) {
    if (!includeCancelled && event.status === "CANCELLED") continue;

    const duration = Math.max(0, event.dtend - event.dtstart);

    if (!event.rrule) {
      // Overlap, not containment: a multi-day event straddling the window edge
      // must still appear.
      if (event.dtend > rangeStart && event.dtstart < rangeEnd) {
        out.push(materialise(event, event.dtstart, event.dtstart + duration, null, false));
      }
      continue;
    }

    const rule = buildRule(event, zone);
    if (!rule) continue;

    const exdates = new Set(event.exdates ?? []);

    // Widen the query by the event's duration so a series instance that started
    // before the window but is still running gets picked up.
    const floatingFrom = toFloating(rangeStart - duration, zone);
    const floatingTo = toFloating(rangeEnd, zone);

    let instances: Date[];
    try {
      instances = rule.between(floatingFrom, floatingTo, true);
    } catch (error) {
      console.error(`[expand] failed to expand event ${event.id}`, error);
      continue;
    }

    if (instances.length > MAX_OCCURRENCES_PER_SERIES) {
      console.warn(
        `[expand] event ${event.id} produced ${instances.length} occurrences; truncating to ${MAX_OCCURRENCES_PER_SERIES}`,
      );
      instances = instances.slice(0, MAX_OCCURRENCES_PER_SERIES);
    }

    for (const instance of instances) {
      const recurrenceId = fromFloating(instance, zone);
      if (exdates.has(recurrenceId)) continue;

      const override = overrideMap.get(overrideKey(event.id, recurrenceId));

      if (override?.cancelled) {
        if (!includeCancelled) continue;
        out.push(
          materialise(
            event,
            override.dtstart ?? recurrenceId,
            override.dtend ?? recurrenceId + duration,
            recurrenceId,
            true,
            override,
            "CANCELLED",
          ),
        );
        continue;
      }

      const start = override?.dtstart ?? recurrenceId;
      const end = override?.dtend ?? start + duration;

      // An override can move an occurrence out of the window entirely.
      if (end <= rangeStart || start >= rangeEnd) continue;

      out.push(materialise(event, start, end, recurrenceId, Boolean(override), override));
    }
  }

  out.sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary));
  return out;
}

function materialise(
  event: EventRow,
  start: number,
  end: number,
  recurrenceId: number | null,
  overridden: boolean,
  override?: EventOverride,
  statusOverride?: EventRow["status"],
): Occurrence {
  return {
    eventId: event.id,
    key: recurrenceId === null ? event.id : `${event.id}:${recurrenceId}`,
    calendarId: event.calendarId,
    summary: override?.summary ?? event.summary,
    description: override?.description ?? event.description,
    location: override?.location ?? event.location,
    url: event.url,
    start,
    end,
    allDay: event.allDay,
    status: statusOverride ?? event.status,
    recurring: recurrenceId !== null,
    recurrenceId,
    overridden,
  };
}

/** Groups occurrences by YYYY-MM-DD for the month grid and agenda. */
export function groupByDay(
  occurrences: Occurrence[],
  zone: string,
  keyFor: (epochMs: number, zone: string) => string,
): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();

  for (const occ of occurrences) {
    // A multi-day event is listed under every day it touches.
    let cursor = keyFor(occ.start, zone);
    const last = keyFor(occ.allDay ? occ.end - 1 : occ.end, zone);

    for (let guard = 0; guard < 400; guard += 1) {
      const bucket = map.get(cursor);
      if (bucket) bucket.push(occ);
      else map.set(cursor, [occ]);

      if (cursor >= last) break;
      const next = new Date(`${cursor}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
  }

  return map;
}

export type CalendarLookup = Map<string, Calendar>;

export function indexCalendars(calendars: Calendar[]): CalendarLookup {
  return new Map(calendars.map((c) => [c.id, c]));
}

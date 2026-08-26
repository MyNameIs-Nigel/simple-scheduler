import { DateTime } from "luxon";
import icalParser, { type VEvent } from "node-ical";

/**
 * Parses an uploaded .ics into rows ready for insertion.
 *
 * Pure and dependency-light on purpose: the admin page previews the result
 * before anything is written, so parsing must never touch the database.
 */

export type ParsedEvent = {
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  dtstart: number;
  dtend: number;
  allDay: boolean;
  rrule: string | null;
  exdates: number[] | null;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Occurrence overrides are skipped on import; counted so we can say so. */
  isOverride: boolean;
};

export type ParseResult = {
  events: ParsedEvent[];
  /** Modified occurrences found and skipped. */
  skippedOverrides: number;
  /** Entries we could not make sense of, with a reason. */
  problems: string[];
  rangeStart: number | null;
  rangeEnd: number | null;
  recurringCount: number;
};

export function parseIcs(source: string, zone: string): ParseResult {
  const problems: string[] = [];
  const events: ParsedEvent[] = [];
  let skippedOverrides = 0;

  let parsed: Record<string, unknown>;
  try {
    parsed = icalParser.parseICS(source);
  } catch (error) {
    return {
      events: [],
      skippedOverrides: 0,
      problems: [`Could not parse the file: ${(error as Error).message}`],
      rangeStart: null,
      rangeEnd: null,
      recurringCount: 0,
    };
  }

  for (const entry of Object.values(parsed)) {
    const vevent = entry as VEvent;
    if (!vevent || vevent.type !== "VEVENT") continue;

    // A VEVENT carrying RECURRENCE-ID modifies one occurrence of a series.
    // Importing it as a standalone event would duplicate that occurrence, so
    // it is counted and dropped rather than guessed at.
    if ("recurrenceid" in vevent && vevent.recurrenceid) {
      skippedOverrides += 1;
      continue;
    }

    // node-ical does not surface same-UID overrides as top-level entries — it
    // nests them under the parent's `recurrences`, indexed under BOTH a
    // date-only key and a full ISO key. Counting the keys would double every
    // override, so they are deduplicated by their actual RECURRENCE-ID.
    skippedOverrides += countRecurrences(vevent);

    const summary = typeof vevent.summary === "string" ? vevent.summary.trim() : "";
    if (!summary) {
      problems.push("Skipped an event with no title.");
      continue;
    }

    const start = toMillis(vevent.start);
    if (start === null) {
      problems.push(`Skipped "${summary}": unreadable start date.`);
      continue;
    }

    const allDay = isDateOnly(vevent.start);

    // All-day values need re-anchoring; see toAllDayMillis.
    const dtstart = allDay ? toAllDayMillis(vevent.start, zone) ?? start : start;

    let end = allDay ? toAllDayMillis(vevent.end, zone) : toMillis(vevent.end);

    if (end === null || end <= dtstart) {
      // RFC 5545 allows a missing DTEND: all-day means one day, timed means
      // a zero-length instant, which we widen to 30 minutes to stay visible.
      end = allDay ? dtstart + 24 * 60 * 60 * 1000 : dtstart + 30 * 60 * 1000;
    }

    events.push({
      uid: typeof vevent.uid === "string" && vevent.uid.trim() ? vevent.uid.trim() : null,
      summary,
      description: cleanString(vevent.description),
      location: cleanString(vevent.location),
      url: cleanString((vevent as { url?: unknown }).url),
      dtstart,
      dtend: end,
      allDay,
      rrule: extractRRule(vevent),
      exdates: extractExdates(vevent),
      status: normaliseStatus((vevent as { status?: unknown }).status),
      isOverride: false,
    });
  }

  const starts = events.map((e) => e.dtstart);
  const ends = events.map((e) => e.dtend);

  return {
    events,
    skippedOverrides,
    problems,
    rangeStart: starts.length > 0 ? Math.min(...starts) : null,
    rangeEnd: ends.length > 0 ? Math.max(...ends) : null,
    recurringCount: events.filter((e) => e.rrule).length,
  };
}

function countRecurrences(vevent: VEvent): number {
  const recurrences = (vevent as { recurrences?: Record<string, unknown> }).recurrences;
  if (!recurrences || typeof recurrences !== "object") return 0;

  const seen = new Set<number | string>();
  for (const [key, value] of Object.entries(recurrences)) {
    const id = (value as { recurrenceid?: unknown } | null)?.recurrenceid;
    const ms = toMillis(id);
    seen.add(ms ?? key);
  }
  return seen.size;
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Re-anchors an all-day date to midnight in the scheduler's zone.
 *
 * node-ical parses `DTSTART;VALUE=DATE:20260401` as midnight in the *process*
 * timezone, so the instant it returns depends on the container's TZ — the same
 * file imported on two hosts would land on different days. A VALUE=DATE has no
 * timezone at all; it names a calendar day.
 *
 * Reading the local Y/M/D components recovers that calendar day whatever the
 * process TZ, and it is then rebuilt as midnight in `zone`, which is the
 * convention the rest of the app stores all-day events in.
 */
function toAllDayMillis(value: unknown, zone: string): number | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;

  const dt = DateTime.fromObject(
    { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() },
    { zone },
  ).startOf("day");

  return dt.isValid ? dt.toMillis() : null;
}

/** node-ical tags all-day values with dateOnly. */
function isDateOnly(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "dateOnly" in value && (value as { dateOnly?: boolean }).dateOnly);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseStatus(value: unknown): ParsedEvent["status"] {
  const s = typeof value === "string" ? value.toUpperCase() : "";
  return s === "CANCELLED" || s === "TENTATIVE" ? s : "CONFIRMED";
}

/** Returns the RRULE without its prefix, matching how we store it. */
function extractRRule(vevent: VEvent): string | null {
  const rule = (vevent as { rrule?: { toString(): string } }).rrule;
  if (!rule) return null;
  try {
    const text = rule.toString();
    const line = text
      .split(/\r?\n/)
      .find((l) => l.toUpperCase().startsWith("RRULE:"));
    return line ? line.replace(/^RRULE:/i, "").trim() : null;
  } catch {
    return null;
  }
}

function extractExdates(vevent: VEvent): number[] | null {
  const raw = (vevent as { exdate?: Record<string, unknown> }).exdate;
  if (!raw || typeof raw !== "object") return null;

  const out: number[] = [];
  for (const value of Object.values(raw)) {
    const ms = toMillis(value);
    if (ms !== null) out.push(ms);
  }

  // Keep them ordered so the stored JSON is stable across re-imports.
  return out.length > 0 ? out.sort((a, b) => a - b) : null;
}

/** Human summary for the preview panel. */
export function describeRange(
  start: number | null,
  end: number | null,
  zone: string,
): string {
  if (start === null || end === null) return "—";
  const from = DateTime.fromMillis(start, { zone });
  const to = DateTime.fromMillis(end, { zone });
  return `${from.toFormat("d LLL yyyy")} – ${to.toFormat("d LLL yyyy")}`;
}

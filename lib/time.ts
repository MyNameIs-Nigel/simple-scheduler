import { DateTime } from "luxon";

/**
 * Storage is always a true UTC instant (epoch ms). Display and recurrence work
 * in SCHEDULER_TIMEZONE. These helpers are the only place the two meet.
 *
 * The awkward part is the `rrule` library: it expands rules in naive UTC with
 * no zone awareness. Feeding it a real instant makes a weekly 14:00 meeting
 * drift by an hour across a DST boundary. The fix is the standard "floating
 * UTC" dance — hand rrule a Date whose *UTC* fields hold the local wall-clock
 * components, expand, then reattach the zone on the way out. A 14:00 event
 * then stays at 14:00 local, which is what RFC 5545 means by a zoned DTSTART.
 */

/** Real instant -> Date whose UTC fields are the local wall-clock components. */
export function toFloating(epochMs: number, zone: string): Date {
  const local = DateTime.fromMillis(epochMs, { zone });
  return new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.millisecond,
    ),
  );
}

/** Floating Date -> the real instant those wall-clock components denote in `zone`. */
export function fromFloating(floating: Date, zone: string): number {
  const dt = DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
      millisecond: floating.getUTCMilliseconds(),
    },
    { zone },
  );
  // A wall time inside a DST spring-forward gap is invalid; Luxon resolves it
  // forward, which matches what calendar clients do.
  return dt.isValid ? dt.toMillis() : DateTime.fromJSDate(floating, { zone }).toMillis();
}

export function zoned(epochMs: number, zone: string): DateTime {
  return DateTime.fromMillis(epochMs, { zone });
}

/** Midnight starting the day that contains `epochMs`, in `zone`. */
export function startOfDay(epochMs: number, zone: string): number {
  return zoned(epochMs, zone).startOf("day").toMillis();
}

export function startOfMonth(epochMs: number, zone: string): number {
  return zoned(epochMs, zone).startOf("month").toMillis();
}

export function endOfMonth(epochMs: number, zone: string): number {
  return zoned(epochMs, zone).endOf("month").toMillis();
}

/** Monday-first, matching the month grid. */
export function startOfWeek(epochMs: number, zone: string): number {
  return zoned(epochMs, zone).startOf("week").toMillis();
}

export function endOfWeek(epochMs: number, zone: string): number {
  return zoned(epochMs, zone).endOf("week").toMillis();
}

/** Stable YYYY-MM-DD key in `zone`, used to bucket occurrences per day. */
export function dayKey(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("yyyy-MM-dd");
}

export function isSameDay(a: number, b: number, zone: string): boolean {
  return dayKey(a, zone) === dayKey(b, zone);
}

/** "14:00" — 24h, since the whole UI is mono/tabular. */
export function formatTime(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("HH:mm");
}

export function formatDate(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("ccc d LLL");
}

export function formatDateLong(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("cccc d LLLL yyyy");
}

export function formatMonth(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("LLLL yyyy");
}

/** `datetime-local` input value ("2026-08-26T14:00") for the admin form. */
export function toLocalInput(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** Parses a `datetime-local` value as wall time in `zone`. */
export function fromLocalInput(value: string, zone: string): number | null {
  const dt = DateTime.fromISO(value, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

/** `<input type="date">` value. */
export function toDateInput(epochMs: number, zone: string): string {
  return zoned(epochMs, zone).toFormat("yyyy-MM-dd");
}

export function fromDateInput(value: string, zone: string): number | null {
  const dt = DateTime.fromISO(value, { zone }).startOf("day");
  return dt.isValid ? dt.toMillis() : null;
}

/**
 * "4 min ago" / "just now", for sync status lines.
 *
 * `now` is passed in rather than read here: a Date.now() in a render body is a
 * React purity violation, which is what lib/now.ts exists to route around.
 */
export function formatRelative(epochMs: number, now: number): string {
  const seconds = Math.round((now - epochMs) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

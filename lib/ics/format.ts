import { DateTime } from "luxon";

/**
 * RFC 5545 requires DTSTAMP, CREATED and LAST-MODIFIED to be UTC, but
 * ical-generator formats every date with the calendar's timezone once one is
 * set, emitting a floating local value with no Z and no TZID. That is not
 * configurable — the DTSTAMP line is built unconditionally from
 * `calendar.timezone()`.
 *
 * So the stamps are converted back here. They are metadata only (clients pair
 * them with SEQUENCE for conflict resolution), but a floating DTSTAMP is the
 * kind of near-miss that some parsers reject outright.
 */
export function normaliseUtcStamps(body: string, zone: string): string {
  return body.replace(
    /^(DTSTAMP|CREATED|LAST-MODIFIED):(\d{8}T\d{6})(?!Z)$/gm,
    (match, prop: string, stamp: string) => {
      const local = DateTime.fromFormat(stamp, "yyyyLLdd'T'HHmmss", { zone });
      if (!local.isValid) return match;
      return `${prop}:${local.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}`;
    },
  );
}


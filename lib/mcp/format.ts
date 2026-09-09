import { DateTime } from "luxon";
import { parseRRule, WEEKDAY_LABELS } from "@/lib/events/rrule";

/**
 * Converts an RFC 5545 RRULE string into natural plain-language description.
 * "Every Tuesday until December 15" or "Daily" or "Every 2 weeks on Mon, Wed".
 */
export function rruleToNaturalLanguage(rrule: string | null, zone: string): string | null {
  if (!rrule) return null;

  try {
    const form = parseRRule(rrule, zone);
    if (form.freq === "none") return null;

    let desc = "";
    if (form.freq === "daily") {
      desc = form.interval === 1 ? "Daily" : `Every ${form.interval} days`;
    } else if (form.freq === "weekly") {
      if (form.interval === 1) {
        desc = "Weekly";
      } else {
        desc = `Every ${form.interval} weeks`;
      }
      if (form.byWeekday.length > 0) {
        const days = form.byWeekday.map((d) => WEEKDAY_LABELS[d]).join(", ");
        desc += ` on ${days}`;
      }
    } else if (form.freq === "monthly") {
      desc = form.interval === 1 ? "Monthly" : `Every ${form.interval} months`;
    } else if (form.freq === "yearly") {
      desc = form.interval === 1 ? "Yearly" : `Every ${form.interval} years`;
    }

    if (form.endMode === "until" && form.until) {
      const dt = DateTime.fromISO(form.until, { zone });
      if (dt.isValid) {
        desc += ` until ${dt.toFormat("LLLL d, yyyy")}`;
      }
    } else if (form.endMode === "count" && form.count) {
      desc += `, ${form.count} times`;
    }

    return desc;
  } catch {
    return null;
  }
}

/**
 * Short stable ID generator for occurrences.
 * Encodes event ID and recurrence ID if present:
 * e.g. "evt_abc123" or "evt_abc123:1757433600000"
 */
export function encodeOccurrenceId(eventId: string, recurrenceId: number | null): string {
  if (!recurrenceId) return eventId;
  return `${eventId}_r${recurrenceId}`;
}

export function decodeOccurrenceId(id: string): { eventId: string; recurrenceId: number | null } {
  if (id.includes("_r")) {
    const [eventId, recStr] = id.split("_r");
    const recId = Number(recStr);
    return {
      eventId,
      recurrenceId: Number.isFinite(recId) ? recId : null,
    };
  }
  return { eventId: id, recurrenceId: null };
}

/**
 * Resolves natural range expressions or explicit ISO dates to UTC epoch milliseconds:
 * 'today', 'tomorrow', 'this week', 'next week', 'this month', 'next month'
 * or ISO date strings ('2026-09-09', '2026-09-09T00:00:00Z')
 */
export function resolveDateRange(
  rangeInput: {
    from?: string;
    to?: string;
    window?: string;
    days?: number;
  },
  zone: string,
  nowEpochMs: number,
  defaultDays: number,
): { rangeStart: number; rangeEnd: number; label: string } {
  const now = DateTime.fromMillis(nowEpochMs, { zone });

  if (rangeInput.window) {
    const w = rangeInput.window.toLowerCase().trim();
    if (w === "today") {
      const start = now.startOf("day");
      const end = now.endOf("day");
      return {
        rangeStart: start.toMillis(),
        rangeEnd: end.toMillis() + 1,
        label: `Today (${start.toFormat("yyyy-MM-dd")})`,
      };
    }
    if (w === "tomorrow") {
      const start = now.plus({ days: 1 }).startOf("day");
      const end = now.plus({ days: 1 }).endOf("day");
      return {
        rangeStart: start.toMillis(),
        rangeEnd: end.toMillis() + 1,
        label: `Tomorrow (${start.toFormat("yyyy-MM-dd")})`,
      };
    }
    if (w === "this week") {
      // Monday to Sunday
      const start = now.startOf("week");
      const end = now.endOf("week");
      return {
        rangeStart: start.toMillis(),
        rangeEnd: end.toMillis() + 1,
        label: `This week (${start.toFormat("yyyy-MM-dd")} to ${end.toFormat("yyyy-MM-dd")})`,
      };
    }
    if (w === "next week") {
      const start = now.plus({ weeks: 1 }).startOf("week");
      const end = now.plus({ weeks: 1 }).endOf("week");
      return {
        rangeStart: start.toMillis(),
        rangeEnd: end.toMillis() + 1,
        label: `Next week (${start.toFormat("yyyy-MM-dd")} to ${end.toFormat("yyyy-MM-dd")})`,
      };
    }
    if (w === "this month") {
      const start = now.startOf("month");
      const end = now.endOf("month");
      return {
        rangeStart: start.toMillis(),
        rangeEnd: end.toMillis() + 1,
        label: `This month (${start.toFormat("yyyy-MM")})`,
      };
    }
    if (w === "next month") {
      const start = now.plus({ months: 1 }).startOf("month");
      const end = now.plus({ months: 1 }).endOf("month");
      return {
        rangeStart: start.toMillis(),
        rangeEnd: end.toMillis() + 1,
        label: `Next month (${start.toFormat("yyyy-MM")})`,
      };
    }
  }

  let startDt = now.startOf("day");
  if (rangeInput.from) {
    const parsed = DateTime.fromISO(rangeInput.from, { zone });
    if (parsed.isValid) {
      startDt = parsed;
    }
  }

  let endDt = startDt.plus({ days: rangeInput.days ?? defaultDays });
  if (rangeInput.to) {
    const parsed = DateTime.fromISO(rangeInput.to, { zone });
    if (parsed.isValid) {
      // If parsed has no hour/minute/second, treat as end of day
      if (rangeInput.to.length <= 10) {
        endDt = parsed.endOf("day").plus({ milliseconds: 1 });
      } else {
        endDt = parsed;
      }
    }
  }

  return {
    rangeStart: startDt.toMillis(),
    rangeEnd: endDt.toMillis(),
    label: `${startDt.toFormat("yyyy-MM-dd")} to ${endDt.toFormat("yyyy-MM-dd")}`,
  };
}

/**
 * Formats a single occurrence into a compact tabular line per Output Contract:
 * Tue 09  14:00–15:00  Team standup            [work] (#evt_abc123)
 */
export function formatOccurrenceLine(
  occ: {
    id: string;
    summary: string;
    start: number;
    end: number;
    allDay: boolean;
    calendarName: string;
    location?: string | null;
  },
  zone: string,
): string {
  const startDt = DateTime.fromMillis(occ.start, { zone });
  const dayStr = startDt.toFormat("ccc dd"); // e.g. "Tue 09"

  let timeStr = "";
  if (occ.allDay) {
    const endDt = DateTime.fromMillis(occ.end, { zone });
    // Check if multi-day
    const diffDays = Math.round(endDt.diff(startDt, "days").days);
    if (diffDays > 1) {
      const inclusiveEnd = endDt.minus({ days: 1 });
      timeStr = `all day (${startDt.toFormat("LLL d")}–${inclusiveEnd.toFormat("LLL d")})`;
    } else {
      timeStr = "all day";
    }
  } else {
    const endDt = DateTime.fromMillis(occ.end, { zone });
    timeStr = `${startDt.toFormat("HH:mm")}–${endDt.toFormat("HH:mm")}`;
  }

  // Pad timeStr to 13 chars
  const paddedTime = timeStr.padEnd(13, " ");
  let line = `${dayStr}  ${paddedTime}  ${occ.summary}  [${occ.calendarName}]  (#${occ.id})`;

  if (occ.location) {
    line += ` @ ${occ.location}`;
  }

  return line;
}

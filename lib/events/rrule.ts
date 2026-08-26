import { Frequency, RRule, Weekday } from "rrule";
import { DateTime } from "luxon";

/**
 * Serialises the admin form's recurrence fields into an RFC 5545 RRULE, and
 * parses one back for editing.
 *
 * Everything goes through the rrule library rather than string concatenation so
 * the output is spec-correct — subscribed clients are unforgiving about this,
 * and a malformed rule is invisible until someone's calendar shows the wrong
 * days.
 */

export type RecurrenceFreq = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type EndMode = "never" | "count" | "until";

export type RecurrenceForm = {
  freq: RecurrenceFreq;
  interval: number;
  /** 0 = Monday … 6 = Sunday, matching rrule's Weekday indices. */
  byWeekday: number[];
  endMode: EndMode;
  count?: number;
  /** YYYY-MM-DD in the scheduler's zone. */
  until?: string;
};

export const EMPTY_RECURRENCE: RecurrenceForm = {
  freq: "none",
  interval: 1,
  byWeekday: [],
  endMode: "never",
};

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const FREQ_MAP: Record<Exclude<RecurrenceFreq, "none">, Frequency> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

/**
 * Builds the RRULE string (without the "RRULE:" prefix).
 *
 * UNTIL is emitted as a UTC instant, which RFC 5545 requires whenever DTSTART
 * carries a TZID. The form supplies a local date, so it is interpreted as the
 * end of that day in `zone` before conversion — "until the 5th" should include
 * the 5th.
 */
export function buildRRule(form: RecurrenceForm, zone: string): string | null {
  if (form.freq === "none") return null;

  const options: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: FREQ_MAP[form.freq],
    interval: Math.max(1, Math.floor(form.interval) || 1),
  };

  if (form.freq === "weekly" && form.byWeekday.length > 0) {
    options.byweekday = form.byWeekday.map((d) => new Weekday(d));
  }

  if (form.endMode === "count" && form.count && form.count > 0) {
    options.count = Math.floor(form.count);
  } else if (form.endMode === "until" && form.until) {
    const end = DateTime.fromISO(form.until, { zone }).endOf("day");
    if (end.isValid) options.until = end.toUTC().toJSDate();
  }

  // rrule prefixes the string with "RRULE:"; we store it without.
  return new RRule(options).toString().replace(/^RRULE:/, "");
}

/** Parses a stored RRULE back into form state for editing. */
export function parseRRule(rrule: string | null, zone: string): RecurrenceForm {
  if (!rrule) return { ...EMPTY_RECURRENCE };

  try {
    const options = RRule.parseString(rrule);

    const freq: RecurrenceFreq =
      options.freq === RRule.DAILY
        ? "daily"
        : options.freq === RRule.WEEKLY
          ? "weekly"
          : options.freq === RRule.MONTHLY
            ? "monthly"
            : options.freq === RRule.YEARLY
              ? "yearly"
              : "none";

    if (freq === "none") return { ...EMPTY_RECURRENCE };

    const byWeekday = normaliseWeekdays(options.byweekday);

    return {
      freq,
      interval: options.interval ?? 1,
      byWeekday,
      endMode: options.count ? "count" : options.until ? "until" : "never",
      count: options.count ?? undefined,
      until: options.until
        ? DateTime.fromJSDate(options.until, { zone }).toFormat("yyyy-MM-dd")
        : undefined,
    };
  } catch {
    return { ...EMPTY_RECURRENCE };
  }
}

function normaliseWeekdays(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (entry instanceof Weekday) return entry.weekday;
      if (entry && typeof entry === "object" && "weekday" in entry) {
        return Number((entry as { weekday: number }).weekday);
      }
      return null;
    })
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** One-line human summary, shown in the admin event list. */
export function describeRRule(rrule: string | null): string {
  if (!rrule) return "Once";
  try {
    const text = RRule.fromString(`RRULE:${rrule}`).toText();
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return "Repeats";
  }
}

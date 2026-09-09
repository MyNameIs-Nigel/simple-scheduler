import { EMPTY_RECURRENCE, type EndMode, type RecurrenceFreq } from "./rrule";
import type { RecurrenceForm } from "./rrule";

/**
 * The shape of each admin form, and how to read one back out of a `FormData`.
 *
 * This exists because of one React behaviour: a `<form action={…}>` is reset
 * as soon as its action settles. The reset is queued before the action even
 * runs (`requestFormReset` in react-dom) and is applied after the resulting
 * render commits, so every field snaps back to whatever `defaultValue` is
 * committed at that moment. A rejected save therefore threw away everything
 * that had been typed and restored the values the page was first rendered
 * with — a mistyped URL cost you the whole event.
 *
 * The fix is for an action to echo its input back in `ActionState.values` and
 * for the form to render *that* as its defaults, so React's reset lands on the
 * user's own submission. Nothing is lost, and it works without JavaScript too.
 *
 * Two consequences worth knowing before editing the forms:
 *
 *   - Fields must stay **uncontrolled**. A `value`/`checked` prop is clobbered
 *     by the reset with no re-render to put it back.
 *   - `<select>` must be **remounted** (a `key` tied to the echoed value) when
 *     that value changes. React only re-applies a select's `defaultValue` when
 *     `multiple` changes, so an updated default is otherwise ignored and the
 *     reset restores the mount-time option.
 */

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export type EventFormValues = {
  /** Absent for a create. */
  id?: string;
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  allDay: boolean;
  /** `datetime-local` value, or a `date` value when allDay. */
  start: string;
  /** Inclusive last day when allDay; DTEND is made exclusive on the way in. */
  end: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  recurrence: RecurrenceForm;
};

export function readEventForm(formData: FormData): EventFormValues {
  return {
    id: text(formData, "id") || undefined,
    calendarId: text(formData, "calendarId"),
    summary: text(formData, "summary"),
    description: text(formData, "description"),
    location: text(formData, "location"),
    url: text(formData, "url"),
    allDay: checked(formData, "allDay"),
    start: text(formData, "start"),
    end: text(formData, "end"),
    status: oneOf(text(formData, "status"), ["CONFIRMED", "TENTATIVE", "CANCELLED"], "CONFIRMED"),
    recurrence: {
      freq: oneOf<RecurrenceFreq>(
        text(formData, "freq"),
        ["none", "daily", "weekly", "monthly", "yearly"],
        "none",
      ),
      // Anything unreadable falls back to the empty recurrence's value rather
      // than to NaN, so the echoed form still renders a usable number.
      interval: int(text(formData, "interval")) ?? EMPTY_RECURRENCE.interval,
      byWeekday: formData
        .getAll("byWeekday")
        .map((entry) => int(String(entry)))
        .filter((day): day is number => day !== undefined),
      endMode: oneOf<EndMode>(text(formData, "endMode"), ["never", "count", "until"], "never"),
      count: int(text(formData, "count")),
      until: text(formData, "until") || undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Calendars                                                                  */
/* -------------------------------------------------------------------------- */

export type CalendarFormValues = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  accent: number;
  isPublic: boolean;
  sourceUrl: string;
};

export function readCalendarForm(formData: FormData): CalendarFormValues {
  return {
    id: text(formData, "id") || undefined,
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    description: text(formData, "description"),
    accent: int(text(formData, "accent")) ?? 1,
    isPublic: checked(formData, "isPublic"),
    sourceUrl: text(formData, "sourceUrl"),
  };
}

/* -------------------------------------------------------------------------- */
/* Published feeds                                                            */
/* -------------------------------------------------------------------------- */

export type FeedFormValues = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  isPublic: boolean;
  calendarIds: string[];
};

export function readFeedForm(formData: FormData): FeedFormValues {
  return {
    id: text(formData, "id") || undefined,
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    description: text(formData, "description"),
    isPublic: checked(formData, "isPublic"),
    calendarIds: formData.getAll("calendarIds").map(String),
  };
}

/* -------------------------------------------------------------------------- */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  // A File would only appear if a field were renamed onto a file input.
  return typeof value === "string" ? value.trim() : "";
}

/** An unchecked box posts nothing at all; "true" covers a scripted submit. */
function checked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true";
}

function int(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

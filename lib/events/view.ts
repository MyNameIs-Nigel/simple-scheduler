import { DateTime } from "luxon";

/**
 * URL <-> date-window mapping for the public calendar.
 *
 * The URL is the only state: `?view=month&date=2026-08-26`. That keeps the page
 * a server component, makes every view shareable, and means the back button
 * behaves. Nothing here touches the database.
 */

export type CalendarView = "month" | "week" | "agenda";

export function parseView(value: string | undefined): CalendarView {
  return value === "week" || value === "agenda" ? value : "month";
}

/** Falls back to today when the date is absent or unparseable. */
export function parseAnchor(value: string | undefined, zone: string): number {
  if (value) {
    const parsed = DateTime.fromISO(value, { zone });
    if (parsed.isValid) return parsed.startOf("day").toMillis();
  }
  return DateTime.now().setZone(zone).startOf("day").toMillis();
}

export type Window = { start: number; end: number; title: string };

export function windowFor(view: CalendarView, anchor: number, zone: string): Window {
  const at = DateTime.fromMillis(anchor, { zone });

  if (view === "week") {
    const start = at.startOf("week");
    const end = start.plus({ weeks: 1 });
    const sameMonth = start.month === end.minus({ days: 1 }).month;
    return {
      start: start.toMillis(),
      end: end.toMillis(),
      title: sameMonth
        ? `${start.toFormat("d")}–${end.minus({ days: 1 }).toFormat("d LLLL yyyy")}`
        : `${start.toFormat("d LLL")} – ${end.minus({ days: 1 }).toFormat("d LLL yyyy")}`,
    };
  }

  if (view === "agenda") {
    // Rolling window from the anchor rather than a calendar period — an agenda
    // answers "what's coming up", not "what happened this month".
    const start = at.startOf("day");
    const end = start.plus({ days: 60 });
    return {
      start: start.toMillis(),
      end: end.toMillis(),
      title: `Next 60 days`,
    };
  }

  const start = at.startOf("month");
  const end = start.plus({ months: 1 });
  return {
    start: start.toMillis(),
    end: end.toMillis(),
    title: start.toFormat("LLLL yyyy"),
  };
}

/**
 * The month view renders leading/trailing days from adjacent months, so the
 * query window must cover the whole 6-week grid, not just the month.
 */
export function queryWindowFor(view: CalendarView, anchor: number, zone: string): Window {
  const base = windowFor(view, anchor, zone);
  if (view !== "month") return base;

  const gridStart = DateTime.fromMillis(base.start, { zone }).startOf("week");
  return { ...base, start: gridStart.toMillis(), end: gridStart.plus({ days: 42 }).toMillis() };
}

export function step(view: CalendarView, anchor: number, zone: string, direction: 1 | -1): string {
  const at = DateTime.fromMillis(anchor, { zone });
  const moved =
    view === "week"
      ? at.plus({ weeks: direction })
      : view === "agenda"
        ? at.plus({ days: 60 * direction })
        : at.plus({ months: direction });
  return moved.toFormat("yyyy-MM-dd");
}

export function hrefFor(view: CalendarView, date: string): string {
  return `/?view=${view}&date=${date}`;
}

export function todayIso(zone: string): string {
  return DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
}

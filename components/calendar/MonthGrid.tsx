import { DateTime } from "luxon";

import { accentDot } from "@/lib/accents";
import { dayKey } from "@/lib/time";
import type { Accent } from "@/types";
import type { Calendar } from "@/db/schema";
import type { Occurrence } from "@/lib/events/expand";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month grid. Each day cell shows an accent dot per calendar that has an event
 * that day, then as many event titles as fit. Purely presentational — the range
 * and the expansion are decided by the page.
 */
export function MonthGrid({
  monthAnchor,
  byDay,
  calendars,
  zone,
  todayKey,
}: {
  monthAnchor: number;
  byDay: Map<string, Occurrence[]>;
  calendars: Map<string, Calendar>;
  zone: string;
  todayKey: string;
}) {
  const first = DateTime.fromMillis(monthAnchor, { zone }).startOf("month");
  const gridStart = first.startOf("week");
  // 6 rows always, so the grid does not change height month to month.
  const cells = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-bg/40">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-xs uppercase tracking-wider text-muted"
          >
            <span className="hidden sm:inline">{day}</span>
            <span className="sm:hidden">{day[0]}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const key = cell.toFormat("yyyy-MM-dd");
          const events = byDay.get(key) ?? [];
          const outside = cell.month !== first.month;
          const isToday = key === todayKey;

          // One dot per distinct calendar represented that day.
          const accents = [
            ...new Set(
              events
                .map((e) => calendars.get(e.calendarId)?.accent)
                .filter((a): a is Accent => a === 1 || a === 2 || a === 3 || a === 4),
            ),
          ];

          return (
            <div
              key={key}
              className={`min-h-[5.5rem] border-b border-r border-border p-1.5 last:border-r-0 sm:min-h-[7rem] ${
                outside ? "bg-bg/40" : ""
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span
                  className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-mono text-xs tabular-nums ${
                    isToday
                      ? "bg-accent-1/15 font-bold text-accent-1"
                      : outside
                        ? "text-muted/50"
                        : "text-muted"
                  }`}
                >
                  {cell.day}
                </span>
                <span className="flex gap-0.5">
                  {accents.map((accent) => (
                    <span
                      key={accent}
                      className={`h-1.5 w-1.5 rounded-full ${accentDot[accent]}`}
                      aria-hidden
                    />
                  ))}
                </span>
              </div>

              <ul className="space-y-0.5">
                {events.slice(0, 3).map((event) => {
                  const calendar = calendars.get(event.calendarId);
                  const accent = (calendar?.accent ?? 1) as Accent;
                  return (
                    <li
                      key={event.key}
                      className="truncate font-mono text-[10px] leading-tight text-fg sm:text-xs"
                      title={event.summary}
                    >
                      <span
                        className={`mr-1 inline-block h-1 w-1 shrink-0 rounded-full align-middle ${accentDot[accent]}`}
                        aria-hidden
                      />
                      {!event.allDay && (
                        <span className="text-muted">
                          {DateTime.fromMillis(event.start, { zone }).toFormat("HH:mm")}{" "}
                        </span>
                      )}
                      {event.summary}
                    </li>
                  );
                })}
                {events.length > 3 && (
                  <li className="font-mono text-[10px] text-muted">+{events.length - 3} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { dayKey };

import { DateTime } from "luxon";

import { accentBlock } from "@/lib/accents";
import type { Accent } from "@/types";
import type { Calendar } from "@/db/schema";
import type { Occurrence } from "@/lib/events/expand";

const HOUR_HEIGHT = 44;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;

/**
 * Time-gridded week. Timed events are absolutely positioned against an hour
 * ruler; all-day events sit in a strip above it.
 *
 * The grid is clipped to 06:00-23:00 for density — an event outside that range
 * is clamped into view rather than dropped, so nothing silently disappears.
 */
export function WeekGrid({
  weekStart,
  occurrences,
  calendars,
  zone,
  todayKey,
}: {
  weekStart: number;
  occurrences: Occurrence[];
  calendars: Map<string, Calendar>;
  zone: string;
  todayKey: string;
}) {
  const start = DateTime.fromMillis(weekStart, { zone }).startOf("week");
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const hours = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
    (_, i) => DAY_START_HOUR + i,
  );

  const allDay = occurrences.filter((o) => o.allDay);
  const timed = occurrences.filter((o) => !o.allDay);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* Day headers */}
      <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border bg-bg/40">
        <div />
        {days.map((day) => {
          const key = day.toFormat("yyyy-MM-dd");
          const isToday = key === todayKey;
          return (
            <div key={key} className="px-1 py-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted">
                {day.toFormat("ccc")}
              </div>
              <div
                className={`font-mono text-sm tabular-nums ${
                  isToday ? "font-bold text-accent-1" : "text-fg"
                }`}
              >
                {day.day}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      {allDay.length > 0 && (
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border">
          <div className="px-1 py-1 text-right font-mono text-[10px] text-muted">all</div>
          {days.map((day) => {
            const key = day.toFormat("yyyy-MM-dd");
            const dayEvents = allDay.filter((o) => {
              const s = DateTime.fromMillis(o.start, { zone }).startOf("day");
              const e = DateTime.fromMillis(o.end - 1, { zone }).startOf("day");
              return day >= s && day <= e;
            });
            return (
              <div key={key} className="min-h-[1.75rem] border-l border-border p-0.5">
                {dayEvents.map((event) => {
                  const accent = (calendars.get(event.calendarId)?.accent ?? 1) as Accent;
                  return (
                    <div
                      key={event.key}
                      className={`truncate rounded border px-1 py-0.5 font-mono text-[10px] ${accentBlock[accent]}`}
                      title={event.summary}
                    >
                      {event.summary}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Hour grid */}
      <div className="relative grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] overflow-x-auto">
        <div>
          {hours.map((hour) => (
            <div
              key={hour}
              className="relative border-b border-border/50 pr-1 text-right"
              style={{ height: HOUR_HEIGHT }}
            >
              <span className="font-mono text-[10px] tabular-nums text-muted">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>

        {days.map((day) => {
          const key = day.toFormat("yyyy-MM-dd");
          const dayEvents = timed.filter(
            (o) => DateTime.fromMillis(o.start, { zone }).toFormat("yyyy-MM-dd") === key,
          );

          return (
            <div key={key} className="relative border-l border-border">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="border-b border-border/50"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}

              {dayEvents.map((event) => {
                const accent = (calendars.get(event.calendarId)?.accent ?? 1) as Accent;
                const s = DateTime.fromMillis(event.start, { zone });
                const e = DateTime.fromMillis(event.end, { zone });

                const startHours = Math.max(s.hour + s.minute / 60, DAY_START_HOUR);
                const endHours = Math.min(e.hour + e.minute / 60, DAY_END_HOUR + 1);
                const top = (startHours - DAY_START_HOUR) * HOUR_HEIGHT;
                const height = Math.max(16, (endHours - startHours) * HOUR_HEIGHT);

                return (
                  <div
                    key={event.key}
                    className={`absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 ${accentBlock[accent]}`}
                    style={{ top, height }}
                    title={`${s.toFormat("HH:mm")}–${e.toFormat("HH:mm")} ${event.summary}`}
                  >
                    <div className="truncate font-mono text-[10px] tabular-nums opacity-80">
                      {s.toFormat("HH:mm")}
                    </div>
                    <div className="truncate text-[10px] font-medium leading-tight">
                      {event.summary}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

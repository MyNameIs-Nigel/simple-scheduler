import { DateTime } from "luxon";

import { accentChip, accentDot } from "@/lib/accents";
import { formatDateLong, formatTime } from "@/lib/time";
import type { Accent } from "@/types";
import type { Calendar } from "@/db/schema";
import type { Occurrence } from "@/lib/events/expand";

/**
 * Chronological list, grouped by day. Times are mono + tabular-nums so the
 * column stays aligned, matching how the portfolio renders any data column.
 */
export function AgendaList({
  occurrences,
  calendars,
  zone,
  todayKey,
  emptyMessage = "Nothing scheduled.",
}: {
  occurrences: Occurrence[];
  calendars: Map<string, Calendar>;
  zone: string;
  todayKey: string;
  emptyMessage?: string;
}) {
  if (occurrences.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="font-mono text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const groups = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const key = DateTime.fromMillis(occ.start, { zone }).toFormat("yyyy-MM-dd");
    const bucket = groups.get(key);
    if (bucket) bucket.push(occ);
    else groups.set(key, [occ]);
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([key, dayEvents]) => (
        <section key={key}>
          <h3
            className={`mb-2 font-mono text-xs uppercase tracking-widest ${
              key === todayKey ? "text-accent-1" : "text-muted"
            }`}
          >
            {key === todayKey ? "Today · " : ""}
            {formatDateLong(dayEvents[0].start, zone)}
          </h3>

          <ul className="space-y-2">
            {dayEvents.map((event) => {
              const calendar = calendars.get(event.calendarId);
              const accent = (calendar?.accent ?? 1) as Accent;

              return (
                <li
                  key={event.key}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:border-accent-1/50"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${accentDot[accent]}`}
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-sm tabular-nums text-fg">
                        {event.allDay
                          ? "All day"
                          : `${formatTime(event.start, zone)}–${formatTime(event.end, zone)}`}
                      </span>
                      <span className="text-sm font-medium text-fg">{event.summary}</span>
                    </div>

                    {event.location && (
                      <p className="mt-1 truncate text-xs text-muted">{event.location}</p>
                    )}
                    {event.description && (
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted">
                        {event.description}
                      </p>
                    )}
                  </div>

                  {calendar && (
                    <span
                      className={`hidden shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] sm:inline ${accentChip[accent]}`}
                    >
                      {calendar.name}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

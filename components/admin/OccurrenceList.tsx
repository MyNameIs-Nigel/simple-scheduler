import { DateTime } from "luxon";

import { restoreOccurrence, skipOccurrence } from "@/app/admin/actions";
import { expandOccurrences } from "@/lib/events/expand";
import type { EventOverride, EventRow } from "@/db/schema";

/**
 * Per-occurrence controls for a recurring series: skip a single instance
 * (an EXDATE) or restore one that was skipped.
 *
 * Shows a bounded look-ahead rather than the whole series — an unbounded rule
 * has no end, and a year is as far as anyone edits in practice.
 */
export function OccurrenceList({
  event,
  overrides,
  zone,
  now,
}: {
  event: EventRow;
  overrides: EventOverride[];
  zone: string;
  /** Request-time clock, passed in so this stays a pure render. */
  now: number;
}) {
  const from = now;
  const to = DateTime.fromMillis(now, { zone }).plus({ years: 1 }).toMillis();

  const upcoming = expandOccurrences({
    events: [event],
    overrides,
    rangeStart: from,
    rangeEnd: to,
    zone,
    includeCancelled: true,
  }).slice(0, 20);

  const skipped = (event.exdates ?? []).filter((d) => d >= from).sort((a, b) => a - b);

  return (
    <section>
      <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">
        Occurrences
      </h3>

      {upcoming.length === 0 ? (
        <p className="font-mono text-xs text-muted">No upcoming occurrences.</p>
      ) : (
        <ul className="space-y-1">
          {upcoming.map((occ) => (
            <li
              key={occ.key}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="flex-1 font-mono text-xs tabular-nums text-fg">
                {DateTime.fromMillis(occ.start, { zone }).toFormat("ccc d LLL yyyy · HH:mm")}
              </span>

              {occ.overridden && (
                <span className="rounded-full border border-accent-3/25 bg-accent-3/10 px-2 py-0.5 font-mono text-[10px] text-accent-3">
                  edited
                </span>
              )}

              <form action={skipOccurrence}>
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="recurrenceId" value={occ.recurrenceId ?? occ.start} />
                <button
                  type="submit"
                  className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors duration-200 hover:border-red-500/50 hover:text-red-400"
                >
                  skip
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
            Skipped
          </h4>
          <ul className="space-y-1">
            {skipped.map((ms) => (
              <li
                key={ms}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-bg px-3 py-2"
              >
                <span className="flex-1 font-mono text-xs tabular-nums text-muted line-through">
                  {DateTime.fromMillis(ms, { zone }).toFormat("ccc d LLL yyyy · HH:mm")}
                </span>
                <form action={restoreOccurrence}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="recurrenceId" value={ms} />
                  <button
                    type="submit"
                    className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
                  >
                    restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

import Link from "next/link";
import { DateTime } from "luxon";

import { deleteEvent } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { timezone } from "@/lib/env";
import { describeRRule } from "@/lib/events/rrule";
import { listCalendars, listRecentEvents } from "@/lib/events/queries";
import { btnPrimary } from "@/lib/ui";
import type { Accent } from "@/types";

export const metadata = { title: "Events" };

export default async function EventsPage(props: PageProps<"/admin/events">) {
  const params = await props.searchParams;
  const filter = Array.isArray(params.calendar) ? params.calendar[0] : params.calendar;

  const zone = timezone();
  const calendars = await listCalendars();
  const lookup = new Map(calendars.map((c) => [c.id, c]));

  const all = await listRecentEvents(500);
  const events = filter ? all.filter((e) => e.calendarId === filter) : all;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
          Events{filter ? ` · ${lookup.get(filter)?.name ?? "?"}` : ""}
        </h2>
        <Link href="/admin/events/new" className={btnPrimary}>
          New event
        </Link>
      </div>

      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter by calendar">
        <FilterLink href="/admin/events" active={!filter} label="All" />
        {calendars.map((calendar) => (
          <FilterLink
            key={calendar.id}
            href={`/admin/events?calendar=${calendar.id}`}
            active={filter === calendar.id}
            label={calendar.name}
            accent={calendar.accent as Accent}
          />
        ))}
      </nav>

      {events.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="font-mono text-sm text-muted">No events yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => {
            const calendar = lookup.get(event.calendarId);
            const start = DateTime.fromMillis(event.dtstart, { zone });
            const skipped = (event.exdates ?? []).length;

            return (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:border-accent-1/50"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${accentDot[(calendar?.accent ?? 1) as Accent]}`}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-fg">{event.summary}</span>
                    {event.status !== "CONFIRMED" && (
                      <span className="rounded-full border border-accent-2/25 bg-accent-2/10 px-2 py-0.5 font-mono text-[10px] text-accent-2">
                        {event.status.toLowerCase()}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted">
                    {event.allDay
                      ? start.toFormat("ccc d LLL yyyy")
                      : start.toFormat("ccc d LLL yyyy · HH:mm")}
                    {" · "}
                    {describeRRule(event.rrule)}
                    {skipped > 0 && ` · ${skipped} skipped`}
                  </p>
                </div>

                {/* A mirrored calendar's events belong to its source, so there
                    is nothing to offer here but the reason why. */}
                {calendar?.sourceUrl ? (
                  <span
                    className="shrink-0 rounded-lg border border-border px-3 py-1 font-mono text-[10px] text-muted"
                    title={`Synced from ${calendar.sourceUrl}`}
                  >
                    🔒 synced
                  </span>
                ) : (
                  <div className="flex shrink-0 gap-2">
                    <Link
                      href={`/admin/events/${event.id}`}
                      className="rounded-lg border border-border px-3 py-1 text-xs text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
                    >
                      Edit
                    </Link>
                    <form action={deleteEvent}>
                      <input type="hidden" name="id" value={event.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition-colors duration-200 hover:border-red-500/50 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterLink({
  href,
  active,
  label,
  accent,
}: {
  href: string;
  active: boolean;
  label: string;
  accent?: Accent;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-200 ${
        active
          ? "border-accent-1/60 bg-accent-1/10 text-accent-1"
          : "border-border text-muted hover:border-accent-1/50 hover:text-fg"
      }`}
    >
      {accent && <span className={`h-1.5 w-1.5 rounded-full ${accentDot[accent]}`} aria-hidden />}
      {label}
    </Link>
  );
}

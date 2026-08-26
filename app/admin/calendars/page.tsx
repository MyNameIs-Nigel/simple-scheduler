import Link from "next/link";

import { deleteCalendar } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { siteUrl } from "@/lib/env";
import { listCalendars, listEventsForCalendar } from "@/lib/events/queries";
import { btnPrimary } from "@/lib/ui";
import type { Accent } from "@/types";

export const metadata = { title: "Calendars" };

export default async function CalendarsPage() {
  const calendars = await listCalendars();
  const counts = await Promise.all(
    calendars.map(async (c) => (await listEventsForCalendar(c.id)).length),
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Calendars</h2>
        <Link href="/admin/calendars/new" className={btnPrimary}>
          New calendar
        </Link>
      </div>

      {calendars.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="font-mono text-sm text-muted">No calendars yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {calendars.map((calendar, i) => (
            <li
              key={calendar.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:border-accent-1/50"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${accentDot[calendar.accent as Accent]}`}
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-fg">{calendar.name}</span>
                  {!calendar.isPublic && (
                    <span className="rounded-full border border-accent-2/25 bg-accent-2/10 px-2 py-0.5 font-mono text-[10px] text-accent-2">
                      private
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-muted">
                    {counts[i]} event{counts[i] === 1 ? "" : "s"}
                  </span>
                </div>
                <a
                  href={`${siteUrl()}/calendars/${calendar.slug}.ics`}
                  className="mt-0.5 block truncate font-mono text-[10px] text-muted transition-colors duration-200 hover:text-accent-1"
                >
                  /calendars/{calendar.slug}.ics
                </a>
              </div>

              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/admin/calendars/${calendar.id}`}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
                >
                  Edit
                </Link>
                <form action={deleteCalendar}>
                  <input type="hidden" name="id" value={calendar.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition-colors duration-200 hover:border-red-500/50 hover:text-red-400"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Deleting a calendar deletes its events too. Subscribers to that feed will
        get a 404 rather than an empty calendar.
      </p>
    </div>
  );
}

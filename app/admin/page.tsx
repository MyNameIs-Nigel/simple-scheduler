import Link from "next/link";

import { siteUrl, timezone } from "@/lib/env";
import { expandOccurrences, indexCalendars } from "@/lib/events/expand";
import { listCalendars, listEventsInRange, listOverridesFor } from "@/lib/events/queries";
import { AgendaList } from "@/components/calendar/AgendaList";
import { btnPrimary } from "@/lib/ui";
import { todayIso } from "@/lib/events/view";
import { requestNow } from "@/lib/now";
import { DateTime } from "luxon";

export const metadata = { title: "Admin" };

export default async function AdminOverview() {
  const zone = timezone();
  const now = await requestNow();
  const horizon = DateTime.now().setZone(zone).plus({ days: 30 }).toMillis();

  const calendars = await listCalendars();
  const events = await listEventsInRange({
    calendarIds: calendars.map((c) => c.id),
    rangeStart: now,
    rangeEnd: horizon,
  });
  const overrides = await listOverridesFor(events.map((e) => e.id));

  const upcoming = expandOccurrences({
    events,
    overrides,
    rangeStart: now,
    rangeEnd: horizon,
    zone,
  }).slice(0, 10);

  const stats = [
    { label: "Calendars", value: calendars.length, accent: "text-accent-1" },
    { label: "Public", value: calendars.filter((c) => c.isPublic).length, accent: "text-accent-4" },
    { label: "Events", value: events.length, accent: "text-accent-3" },
    { label: "Next 30 days", value: upcoming.length, accent: "text-accent-2" },
  ];

  return (
    <div>
      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:border-accent-1/50"
          >
            <dd className={`font-mono text-2xl font-bold tabular-nums ${stat.accent}`}>
              {stat.value}
            </dd>
            <dt className="mt-1 text-xs leading-snug text-muted">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <div className="mb-8 flex flex-wrap gap-2">
        <Link href="/admin/events/new" className={btnPrimary}>
          New event
          <span className="ml-1 inline-block transition-transform duration-200 group-hover:translate-x-0.5">
            →
          </span>
        </Link>
        <a
          href={`${siteUrl()}/calendars/all.ics`}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
        >
          Download all.ics
        </a>
      </div>

      <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">
        Next 30 days
      </h2>
      <AgendaList
        occurrences={upcoming}
        calendars={indexCalendars(calendars)}
        zone={zone}
        todayKey={todayIso(zone)}
        emptyMessage="Nothing scheduled in the next 30 days."
      />
    </div>
  );
}

import { DateTime } from "luxon";

import { Container } from "@/components/Container";
import { AgendaList } from "@/components/calendar/AgendaList";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { SubscribePanel } from "@/components/calendar/SubscribePanel";
import { ViewNav } from "@/components/calendar/ViewNav";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { siteUrl, timezone } from "@/lib/env";
import { expandOccurrences, groupByDay, indexCalendars } from "@/lib/events/expand";
import { listCalendars, listEventsInRange, listOverridesFor } from "@/lib/events/queries";
import {
  hrefFor,
  parseAnchor,
  parseView,
  queryWindowFor,
  step,
  todayIso,
  windowFor,
  type CalendarView,
} from "@/lib/events/view";
import { dayKey } from "@/lib/time";
import { requestNow } from "@/lib/now";
import type { Accent } from "@/types";

/**
 * The public schedule. A server component that reads SQLite directly — there is
 * no API layer between the two, because there is no second consumer.
 *
 * Dynamic by default (Next 16 route handlers and pages reading request data are
 * not cached), which is correct here: an admin edit must be visible on reload.
 */
export default async function SchedulePage(props: PageProps<"/">) {
  const params = await props.searchParams;

  const zone = timezone();
  const now = await requestNow();
  const view: CalendarView = parseView(first(params.view));
  const anchorIso = first(params.date);
  const anchor = parseAnchor(anchorIso, zone);

  const display = windowFor(view, anchor, zone);
  const query = queryWindowFor(view, anchor, zone);

  const calendars = await listCalendars({ publicOnly: true });
  const calendarIds = calendars.map((c) => c.id);

  const events = await listEventsInRange({
    calendarIds,
    rangeStart: query.start,
    rangeEnd: query.end,
  });
  const overrides = await listOverridesFor(events.map((e) => e.id));

  const occurrences = expandOccurrences({
    events,
    overrides,
    rangeStart: query.start,
    rangeEnd: query.end,
    zone,
  });

  const lookup = indexCalendars(calendars);
  const byDay = groupByDay(occurrences, zone, dayKey);
  const today = todayIso(zone);
  const currentIso = DateTime.fromMillis(anchor, { zone }).toFormat("yyyy-MM-dd");

  const feeds = [
    {
      slug: "all",
      name: "All",
      accent: 1 as Accent,
      url: `${siteUrl()}/calendars/all.ics`,
    },
    ...calendars.map((c) => ({
      slug: c.slug,
      name: c.name,
      accent: c.accent as Accent,
      url: `${siteUrl()}/calendars/${c.slug}.ics`,
    })),
  ];

  return (
    <Container className="py-10">
      <header className="mb-8">
        <div className="mb-3 select-none font-mono">
          <span className="text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="text-accent-1">{">"}</span>
            <span className="ml-2 text-fg">schedule</span>
            <span
              className="terminal-cursor ml-1 inline-block h-[0.85em] w-[3px] translate-y-[0.08em] bg-accent-1"
              aria-hidden
            />
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          What I&apos;m up to, kept in sync with the iCalendar feeds below.
        </p>
      </header>

      <ViewNav
        view={view}
        title={display.title}
        prevHref={hrefFor(view, step(view, anchor, zone, -1))}
        nextHref={hrefFor(view, step(view, anchor, zone, 1))}
        todayHref={hrefFor(view, today)}
        hrefForView={(next) => hrefFor(next, currentIso)}
      />

      {calendars.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="font-mono text-sm text-muted">No public calendars yet.</p>
        </div>
      ) : view === "month" ? (
        <MonthGrid
          monthAnchor={anchor}
          byDay={byDay}
          calendars={lookup}
          zone={zone}
          todayKey={today}
        />
      ) : view === "week" ? (
        <WeekGrid
          weekStart={display.start}
          occurrences={occurrences}
          calendars={lookup}
          zone={zone}
          todayKey={today}
        />
      ) : (
        <AgendaList
          occurrences={occurrences}
          calendars={lookup}
          zone={zone}
          todayKey={today}
          emptyMessage="Nothing scheduled in the next 60 days."
        />
      )}

      {view === "month" && (
        <section className="mt-10">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">
            Upcoming
          </h2>
          <AgendaList
            occurrences={occurrences.filter((o) => o.end >= now).slice(0, 12)}
            calendars={lookup}
            zone={zone}
            todayKey={today}
            emptyMessage="Nothing left this month."
          />
        </section>
      )}

      <div className="my-12 h-px bg-border" role="separator" />

      <SubscribePanel feeds={feeds} />
    </Container>
  );
}

/** searchParams values may arrive as string[] when a key repeats. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

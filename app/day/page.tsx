import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/Container";
import { AgendaList } from "@/components/calendar/AgendaList";
import { siteUrl, timezone } from "@/lib/env";
import {
  getDaySummary,
  hrefForDay,
  parseDayParam,
  stepDay,
} from "@/lib/events/day";
import { todayIso } from "@/lib/events/view";

/**
 * The day at a glance: every event on one date, nothing else.
 *
 * The URL is the only state (`/day?date=2026-09-12`), so any day is shareable
 * and the back button behaves. A plain GET form drives the date picker, which
 * keeps this a server component with no client JavaScript.
 *
 * Dynamic by default (the page reads searchParams), which is correct here: an
 * admin edit must be visible on reload.
 */
export async function generateMetadata(props: PageProps<"/day">): Promise<Metadata> {
  const params = await props.searchParams;
  const zone = timezone();
  const dateIso = parseDayParam(first(params.date), zone);
  const summary = await getDaySummary(dateIso, zone);

  // The title carries both the date and the event count; the description is
  // the condensed "time + name" list, truncated with … when it runs long.
  const countLabel = summary.count === 1 ? "1 event" : `${summary.count} events`;
  const title = `${summary.title} — ${countLabel}`;
  const imageUrl = `/day/og?date=${dateIso}`;
  const imageAlt = `${summary.title}: ${countLabel}. ${summary.description}`;

  return {
    title,
    description: summary.description,
    alternates: { canonical: `/day?date=${dateIso}` },
    openGraph: {
      title,
      description: summary.description,
      siteName: "Nigel Smith's Schedule",
      locale: "en_US",
      type: "website",
      url: `${siteUrl()}/day?date=${dateIso}`,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: summary.description,
      images: [imageUrl],
    },
  };
}

export default async function DayPage(props: PageProps<"/day">) {
  const params = await props.searchParams;

  const zone = timezone();
  const dateIso = parseDayParam(first(params.date), zone);
  const summary = await getDaySummary(dateIso, zone);

  const today = todayIso(zone);
  const isToday = dateIso === today;
  const countLabel =
    summary.count === 0
      ? "Nothing scheduled"
      : summary.count === 1
        ? "1 event"
        : `${summary.count} events`;

  return (
    <Container className="py-10">
      <header className="mb-8">
        <div className="mb-3 select-none font-mono">
          <span className="text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="text-accent-1">{">"}</span>
            <span className="ml-2 text-fg">day</span>
            <span
              className="terminal-cursor ml-1 inline-block h-[0.85em] w-[3px] translate-y-[0.08em] bg-accent-1"
              aria-hidden
            />
          </span>
        </div>
        <p className="font-mono text-sm tracking-tight text-fg sm:text-base">
          {summary.title}
          {isToday && <span className="ml-2 text-accent-1">· Today</span>}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{countLabel}.</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={hrefForDay(stepDay(dateIso, zone, -1))}
            aria-label="Previous day"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
          >
            ‹
          </Link>
          <Link
            href={hrefForDay(stepDay(dateIso, zone, 1))}
            aria-label="Next day"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
          >
            ›
          </Link>
          <Link
            href="/day"
            className="ml-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
          >
            Today
          </Link>
        </div>

        <form method="get" action="/day" className="flex items-center gap-2">
          <label htmlFor="day-picker" className="sr-only">
            Choose a day
          </label>
          <input
            id="day-picker"
            type="date"
            name="date"
            defaultValue={dateIso}
            className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg transition-colors duration-200 focus:border-accent-1/50 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
          >
            Go
          </button>
        </form>
      </div>

      <AgendaList
        occurrences={summary.occurrences}
        calendars={summary.calendars}
        zone={zone}
        todayKey={today}
        emptyMessage="Nothing scheduled this day."
      />
    </Container>
  );
}

/** searchParams values may arrive as string[] when a key repeats. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

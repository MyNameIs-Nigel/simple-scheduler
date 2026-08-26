import Link from "next/link";

import type { CalendarView } from "@/lib/events/view";

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];

/**
 * Period stepper + view switcher. Plain links, not client state — the page is a
 * server component and the URL is the source of truth, so navigation is
 * shareable and works without JavaScript.
 */
export function ViewNav({
  view,
  title,
  prevHref,
  nextHref,
  todayHref,
  hrefForView,
}: {
  view: CalendarView;
  title: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  hrefForView: (view: CalendarView) => string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link
          href={prevHref}
          aria-label="Previous period"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
        >
          ‹
        </Link>
        <Link
          href={nextHref}
          aria-label="Next period"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
        >
          ›
        </Link>
        <h2 className="ml-1 font-mono text-sm font-semibold tracking-tight text-fg sm:text-base">
          {title}
        </h2>
        <Link
          href={todayHref}
          className="ml-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
        >
          Today
        </Link>
      </div>

      <nav className="flex rounded-lg border border-border p-0.5" aria-label="Calendar view">
        {VIEWS.map((entry) => (
          <Link
            key={entry.id}
            href={hrefForView(entry.id)}
            aria-current={entry.id === view ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors duration-200 ${
              entry.id === view
                ? "bg-accent-1/10 text-accent-1"
                : "text-muted hover:text-fg"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

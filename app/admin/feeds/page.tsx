import Link from "next/link";

import { accentDot } from "@/lib/accents";
import { siteUrl } from "@/lib/env";
import { listCalendars, listFeedMemberships, listFeeds } from "@/lib/events/queries";
import { btnPrimary } from "@/lib/ui";
import type { Accent } from "@/types";

export const metadata = { title: "Feeds" };

/**
 * Published feeds: one URL serving several calendars as a single subscribable
 * calendar. This is how an auto-synced work schedule and hand-entered meetings
 * end up in one .ics.
 */
export default async function FeedsPage() {
  const [feeds, calendars, memberships] = await Promise.all([
    listFeeds(),
    listCalendars(),
    listFeedMemberships(),
  ]);

  const byId = new Map(calendars.map((c) => [c.id, c]));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Feeds</h2>
        <Link href="/admin/feeds/new" className={btnPrimary}>
          New feed
        </Link>
      </div>

      {feeds.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="font-mono text-sm text-muted">No feeds yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
            A feed merges several calendars into one subscribable URL — put a subscribed work
            calendar and your own meetings in one, and hand out that single link.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {feeds.map((feed) => {
            const members = (memberships.get(feed.id) ?? [])
              .map((id) => byId.get(id))
              .filter((c) => c !== undefined);

            return (
              <li
                key={feed.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:border-accent-1/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-fg">{feed.name}</span>
                    {!feed.isPublic && (
                      <span className="rounded-full border border-accent-2/25 bg-accent-2/10 px-2 py-0.5 font-mono text-[10px] text-accent-2">
                        private
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-muted">
                      {members.length} calendar{members.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <a
                    href={`${siteUrl()}/calendars/${feed.slug}.ics`}
                    className="mt-0.5 block truncate font-mono text-[10px] text-muted transition-colors duration-200 hover:text-accent-1"
                  >
                    /calendars/{feed.slug}.ics
                  </a>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {members.map((calendar) => (
                      <span
                        key={calendar.id}
                        className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${accentDot[calendar.accent as Accent]}`}
                          aria-hidden
                        />
                        {calendar.name}
                      </span>
                    ))}
                  </div>
                </div>

                <Link
                  href={`/admin/feeds/${feed.id}`}
                  className="shrink-0 rounded-lg border border-border px-3 py-1 text-xs text-fg transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
                >
                  Edit
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        A calendar in a feed is published there even when it is marked private, so a subscription
        mirror can stay off the public site while its events still reach the feed.{" "}
        <span className="font-mono text-muted">/calendars/all.ics</span> is separate — it is every
        public calendar, and is not configurable here.
      </p>
    </div>
  );
}

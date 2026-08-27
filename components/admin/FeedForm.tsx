"use client";

import { useActionState } from "react";
import Link from "next/link";

import { saveFeed } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { btnGhost, btnPrimary, input, label } from "@/lib/ui";
import type { ActionState } from "@/lib/events/validation";
import type { Calendar, PublishedFeed } from "@/db/schema";
import type { Accent } from "@/types";

const initial: ActionState = { ok: true };

/**
 * A published feed: one URL that serves several calendars as a single
 * subscribable calendar.
 *
 * The membership checkboxes are the whole point of the screen — they are what
 * put an auto-synced work schedule and hand-entered meetings in one .ics.
 */
export function FeedForm({
  feed,
  calendars,
  memberIds = [],
}: {
  feed?: PublishedFeed;
  calendars: Calendar[];
  memberIds?: string[];
}) {
  const [state, action, pending] = useActionState(saveFeed, initial);
  const members = new Set(memberIds);

  return (
    <form action={action} className="space-y-5">
      {feed && <input type="hidden" name="id" value={feed.id} />}

      {state.message && !state.ok && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
        >
          {state.message}
        </p>
      )}

      <div>
        <label className={label} htmlFor="name">
          Name
        </label>
        <input
          id="name"
          name="name"
          defaultValue={feed?.name}
          required
          className={input}
          placeholder="Work Schedule"
        />
        <p className="mt-1 text-[10px] text-muted">
          What subscribers see as the calendar name.
        </p>
        <FieldError message={state.errors?.name} />
      </div>

      <div>
        <label className={label} htmlFor="slug">
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          defaultValue={feed?.slug}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className={`${input} font-mono`}
          placeholder="work-combined"
        />
        <p className="mt-1 font-mono text-[10px] text-muted">
          Feed URL: /calendars/<span className="text-accent-1">{"<slug>"}</span>.ics — must not
          clash with a calendar slug, and changing it breaks existing subscriptions.
        </p>
        <FieldError message={state.errors?.slug} />
      </div>

      <div>
        <label className={label} htmlFor="description">
          Description
        </label>
        <input
          id="description"
          name="description"
          defaultValue={feed?.description ?? ""}
          className={input}
        />
      </div>

      <fieldset>
        <legend className={label}>Calendars in this feed</legend>

        {calendars.length === 0 ? (
          <p className="text-xs text-muted">
            No calendars yet —{" "}
            <Link href="/admin/calendars/new" className="text-accent-1">
              create one
            </Link>{" "}
            first.
          </p>
        ) : (
          <div className="space-y-2">
            {calendars.map((calendar) => (
              <label
                key={calendar.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2 transition-colors duration-200 hover:border-accent-1/50 has-[:checked]:border-accent-1/60 has-[:checked]:bg-accent-1/5"
              >
                <input
                  type="checkbox"
                  name="calendarIds"
                  value={calendar.id}
                  defaultChecked={members.has(calendar.id)}
                  className="h-4 w-4 accent-[#22c55e]"
                />
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${accentDot[calendar.accent as Accent]}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{calendar.name}</span>
                {calendar.sourceUrl && (
                  <span className="shrink-0 rounded-full border border-accent-4/25 bg-accent-4/10 px-2 py-0.5 font-mono text-[10px] text-accent-4">
                    subscribed
                  </span>
                )}
                {!calendar.isPublic && (
                  <span className="shrink-0 rounded-full border border-accent-2/25 bg-accent-2/10 px-2 py-0.5 font-mono text-[10px] text-accent-2">
                    private
                  </span>
                )}
              </label>
            ))}
          </div>
        )}

        <p className="mt-2 text-xs leading-relaxed text-muted">
          A calendar listed here is published in this feed{" "}
          <span className="text-fg">even if it is marked private</span>. That is deliberate: it
          lets a raw subscription mirror stay off the public site while its events still reach
          this feed. Only the toggle below hides the feed itself.
        </p>
        <FieldError message={state.errors?.calendarIds} />
      </fieldset>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          name="isPublic"
          defaultChecked={feed?.isPublic ?? true}
          className="h-4 w-4 accent-[#22c55e]"
        />
        <span className="text-sm text-fg">
          Public
          <span className="ml-2 text-xs text-muted">
            serve this feed URL; unchecked returns 404
          </span>
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : feed ? "Save changes" : "Create feed"}
        </button>
        <Link href="/admin/feeds" className={btnGhost}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

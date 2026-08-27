"use client";

import { useActionState } from "react";
import Link from "next/link";

import { saveCalendar } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { btnGhost, btnPrimary, input, label } from "@/lib/ui";
import type { ActionState } from "@/lib/events/validation";
import type { Calendar } from "@/db/schema";
import { ACCENTS } from "@/types";

const initial: ActionState = { ok: true };

export function CalendarForm({ calendar }: { calendar?: Calendar }) {
  const [state, action, pending] = useActionState(saveCalendar, initial);

  return (
    <form action={action} className="space-y-5">
      {calendar && <input type="hidden" name="id" value={calendar.id} />}

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
          defaultValue={calendar?.name}
          required
          className={input}
          placeholder="Work"
        />
        <FieldError message={state.errors?.name} />
      </div>

      <div>
        <label className={label} htmlFor="slug">
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          defaultValue={calendar?.slug}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className={`${input} font-mono`}
          placeholder="work"
        />
        <p className="mt-1 font-mono text-[10px] text-muted">
          Feed URL: /calendars/<span className="text-accent-1">{"<slug>"}</span>.ics — changing
          this breaks existing subscriptions.
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
          defaultValue={calendar?.description ?? ""}
          className={input}
        />
      </div>

      <fieldset>
        <legend className={label}>Accent</legend>
        <div className="flex gap-2">
          {ACCENTS.map((accent) => (
            <label
              key={accent}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors duration-200 hover:border-accent-1/50 has-[:checked]:border-accent-1/60 has-[:checked]:bg-accent-1/5"
            >
              <input
                type="radio"
                name="accent"
                value={accent}
                defaultChecked={(calendar?.accent ?? 1) === accent}
                className="sr-only"
              />
              <span className={`h-3 w-3 rounded-full ${accentDot[accent]}`} aria-hidden />
              <span className="font-mono text-xs text-muted">{accent}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          name="isPublic"
          defaultChecked={calendar?.isPublic ?? true}
          className="h-4 w-4 accent-[#22c55e]"
        />
        <span className="text-sm text-fg">
          Public
          <span className="ml-2 text-xs text-muted">
            visible on the site and included in all.ics
          </span>
        </span>
      </label>

      <div className="border-t border-border pt-5">
        <label className={label} htmlFor="sourceUrl">
          Subscription URL
          <span className="ml-2 font-normal normal-case tracking-normal text-muted">optional</span>
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          defaultValue={calendar?.sourceUrl ?? ""}
          className={`${input} font-mono`}
          placeholder="https://example.com/schedule.ics"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Point this at a published .ics and the calendar becomes a{" "}
          <span className="text-fg">read-only mirror</span> of it, refreshed automatically.
          Its events can no longer be edited here — anything already on it is removed by the
          first sync, and anything the source drops is removed on the next one.
          <span className="mt-1 block">
            To publish these events alongside your own, put both calendars in a{" "}
            <span className="text-accent-1">feed</span>.
          </span>
        </p>
        <FieldError message={state.errors?.sourceUrl} />
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : calendar ? "Save changes" : "Create calendar"}
        </button>
        <Link href="/admin/calendars" className={btnGhost}>
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

"use client";

import { useActionState } from "react";

import { importIcs } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { btnPrimary, input, label } from "@/lib/ui";
import type { ActionState } from "@/lib/events/validation";
import type { Calendar } from "@/db/schema";
import type { Accent } from "@/types";

const initial: ActionState = { ok: true };

export function ImportForm({ calendars }: { calendars: Calendar[] }) {
  const [state, action, pending] = useActionState(importIcs, initial);

  return (
    <form action={action} className="space-y-5">
      {state.message && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            state.ok
              ? "border-accent-1/30 bg-accent-1/10 text-accent-1"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {state.message}
        </p>
      )}

      <div>
        <span className={label}>Import into</span>
        <div className="flex flex-wrap gap-2">
          {calendars.map((calendar, i) => (
            <label
              key={calendar.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors duration-200 hover:border-accent-1/50 has-[:checked]:border-accent-1/60 has-[:checked]:bg-accent-1/5"
            >
              <input
                type="radio"
                name="calendarId"
                value={calendar.id}
                defaultChecked={i === 0}
                required
                className="sr-only"
              />
              <span
                className={`h-2.5 w-2.5 rounded-full ${accentDot[calendar.accent as Accent]}`}
                aria-hidden
              />
              <span className="text-xs text-fg">{calendar.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="file">
          iCalendar file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".ics,text/calendar"
          required
          className={`${input} file:mr-3 file:rounded file:border-0 file:bg-accent-1/10 file:px-3 file:py-1 file:font-mono file:text-xs file:text-accent-1`}
        />
        <p className="mt-1 text-[10px] text-muted">Up to 5 MB.</p>
      </div>

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Importing…" : "Import"}
      </button>
    </form>
  );
}

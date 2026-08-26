"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { saveEvent } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { btnGhost, btnPrimary, input, label } from "@/lib/ui";
import { WEEKDAY_LABELS, type RecurrenceForm } from "@/lib/events/rrule";
import type { ActionState } from "@/lib/events/validation";
import type { Calendar } from "@/db/schema";
import type { Accent } from "@/types";

const initial: ActionState = { ok: true };

export type EventFormValues = {
  id?: string;
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  allDay: boolean;
  /** datetime-local, or date when allDay. */
  start: string;
  end: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  recurrence: RecurrenceForm;
};

export function EventForm({
  calendars,
  values,
}: {
  calendars: Calendar[];
  values: EventFormValues;
}) {
  const [state, action, pending] = useActionState(saveEvent, initial);

  // Local state only where the form's *shape* depends on it: all-day swaps the
  // input type, and the repeat controls appear only once a frequency is chosen.
  const [allDay, setAllDay] = useState(values.allDay);
  const [freq, setFreq] = useState(values.recurrence.freq);
  const [endMode, setEndMode] = useState(values.recurrence.endMode);

  return (
    <form action={action} className="space-y-5">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      {state.message && !state.ok && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
        >
          {state.message}
        </p>
      )}

      <div>
        <label className={label} htmlFor="summary">
          Title
        </label>
        <input
          id="summary"
          name="summary"
          defaultValue={values.summary}
          required
          className={input}
          placeholder="Standup"
        />
        <FieldError message={state.errors?.summary} />
      </div>

      <div>
        <label className={label} htmlFor="calendarId">
          Calendar
        </label>
        <div className="flex flex-wrap gap-2">
          {calendars.map((calendar) => (
            <label
              key={calendar.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors duration-200 hover:border-accent-1/50 has-[:checked]:border-accent-1/60 has-[:checked]:bg-accent-1/5"
            >
              <input
                type="radio"
                name="calendarId"
                value={calendar.id}
                defaultChecked={values.calendarId === calendar.id}
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
        <FieldError message={state.errors?.calendarId} />
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 accent-[#22c55e]"
        />
        <span className="text-sm text-fg">All day</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="start">
            {allDay ? "First day" : "Starts"}
          </label>
          <input
            id="start"
            name="start"
            type={allDay ? "date" : "datetime-local"}
            defaultValue={allDay ? values.start.slice(0, 10) : values.start}
            required
            className={`${input} font-mono`}
          />
          <FieldError message={state.errors?.start} />
        </div>
        <div>
          <label className={label} htmlFor="end">
            {allDay ? "Last day" : "Ends"}
          </label>
          <input
            id="end"
            name="end"
            type={allDay ? "date" : "datetime-local"}
            defaultValue={allDay ? values.end.slice(0, 10) : values.end}
            required
            className={`${input} font-mono`}
          />
          <FieldError message={state.errors?.end} />
        </div>
      </div>

      {/* Recurrence ------------------------------------------------------- */}
      <fieldset className="rounded-xl border border-border bg-bg/40 p-4">
        <legend className={`${label} px-1`}>Repeat</legend>

        <select
          name="freq"
          value={freq}
          onChange={(e) => setFreq(e.target.value as RecurrenceForm["freq"])}
          className={input}
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>

        {freq !== "none" && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Every</span>
              <input
                name="interval"
                type="number"
                min={1}
                max={365}
                defaultValue={values.recurrence.interval}
                className={`${input} w-20 font-mono`}
              />
              <span className="text-xs text-muted">
                {freq === "daily"
                  ? "day(s)"
                  : freq === "weekly"
                    ? "week(s)"
                    : freq === "monthly"
                      ? "month(s)"
                      : "year(s)"}
              </span>
            </div>

            {freq === "weekly" && (
              <div>
                <span className={label}>On</span>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_LABELS.map((day, index) => (
                    <label
                      key={day}
                      className="cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors duration-200 hover:border-accent-1/50 has-[:checked]:border-accent-1/60 has-[:checked]:bg-accent-1/10 has-[:checked]:text-accent-1"
                    >
                      <input
                        type="checkbox"
                        name="byWeekday"
                        value={index}
                        defaultChecked={values.recurrence.byWeekday.includes(index)}
                        className="sr-only"
                      />
                      {day}
                    </label>
                  ))}
                </div>
                <FieldError message={state.errors?.["recurrence.byWeekday"]} />
              </div>
            )}

            <div>
              <span className={label}>Ends</span>
              <select
                name="endMode"
                value={endMode}
                onChange={(e) => setEndMode(e.target.value as RecurrenceForm["endMode"])}
                className={input}
              >
                <option value="never">Never</option>
                <option value="count">After a number of occurrences</option>
                <option value="until">On a date</option>
              </select>

              {endMode === "count" && (
                <input
                  name="count"
                  type="number"
                  min={1}
                  max={1000}
                  defaultValue={values.recurrence.count ?? 10}
                  className={`${input} mt-2 w-28 font-mono`}
                />
              )}
              {endMode === "until" && (
                <input
                  name="until"
                  type="date"
                  defaultValue={values.recurrence.until ?? ""}
                  className={`${input} mt-2 font-mono`}
                />
              )}
            </div>
          </div>
        )}
      </fieldset>

      <div>
        <label className={label} htmlFor="location">
          Location
        </label>
        <input
          id="location"
          name="location"
          defaultValue={values.location}
          className={input}
          placeholder="Google Meet"
        />
      </div>

      <div>
        <label className={label} htmlFor="url">
          URL
        </label>
        <input id="url" name="url" type="url" defaultValue={values.url} className={input} />
        <FieldError message={state.errors?.url} />
      </div>

      <div>
        <label className={label} htmlFor="description">
          Notes
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={values.description}
          rows={3}
          className={`${input} resize-y`}
        />
      </div>

      <div>
        <label className={label} htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={values.status} className={input}>
          <option value="CONFIRMED">Confirmed</option>
          <option value="TENTATIVE">Tentative</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : values.id ? "Save changes" : "Create event"}
        </button>
        <Link href="/admin/events" className={btnGhost}>
          Cancel
        </Link>
      </div>

      {values.id && (
        <p className="text-xs leading-relaxed text-muted">
          Changing the start time or the repeat rule clears any per-occurrence
          edits, since they are keyed to the original slots.
        </p>
      )}
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

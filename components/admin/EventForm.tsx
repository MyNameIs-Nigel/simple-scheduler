"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { saveEvent } from "@/app/admin/actions";
import { accentDot } from "@/lib/accents";
import { btnGhost, btnPrimary, input, label } from "@/lib/ui";
import { WEEKDAY_LABELS, type RecurrenceForm } from "@/lib/events/rrule";
import type { EventFormValues } from "@/lib/events/form";
import type { ActionState } from "@/lib/events/validation";
import type { Calendar } from "@/db/schema";
import type { Accent } from "@/types";

const initial: ActionState<EventFormValues> = { ok: true };

export type { EventFormValues };

export function EventForm({
  calendars,
  values,
}: {
  calendars: Calendar[];
  values: EventFormValues;
}) {
  const [state, action, pending] = useActionState(saveEvent, initial);

  /**
   * What every field renders as its default: the rejected submission if there
   * is one, otherwise the event as stored.
   *
   * React resets the form as soon as the action settles, restoring whatever
   * defaults are committed at that moment — so rendering the submission back
   * is what stops a rejected save from wiping the whole form. The corollary is
   * that nothing below may be a *controlled* input: the reset would clobber it
   * with no re-render to put it back. See lib/events/form.ts.
   */
  const shown = state.values ?? values;

  // Local state only where the form's *shape* depends on it: all-day swaps the
  // input type, and the repeat controls appear only once a frequency is chosen.
  // These mirror the uncontrolled fields rather than controlling them.
  const [allDay, setAllDay] = useState(shown.allDay);
  const [freq, setFreq] = useState(shown.recurrence.freq);
  const [endMode, setEndMode] = useState(shown.recurrence.endMode);
  const [dates, setDates] = useState({ start: shown.start, end: shown.end });

  // Re-sync that mirror when a submission comes back rejected, during render
  // rather than in an effect so the new defaults are committed before React
  // applies its reset.
  const [rendered, setRendered] = useState(state);
  if (rendered !== state) {
    setRendered(state);
    if (state.values) {
      setAllDay(state.values.allDay);
      setFreq(state.values.recurrence.freq);
      setEndMode(state.values.recurrence.endMode);
      setDates({ start: state.values.start, end: state.values.end });
    }
  }

  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  // The button is at the bottom of a long form and the message is at the top,
  // so without this a rejected save looks like nothing happened at all.
  useEffect(() => {
    if (!state.ok) alertRef.current?.focus();
  }, [state]);

  function toggleAllDay(next: boolean) {
    // Carry the dates across the change of input type. The browser blanks a
    // `datetime-local` value the instant the field becomes a `date` — and the
    // other way round — so without this every toggle emptied both fields.
    const start = fieldValue(formRef.current, "start") || dates.start;
    const end = fieldValue(formRef.current, "end") || dates.end;
    setDates(
      next
        ? { start: asDate(start), end: asDate(end) }
        : { start: asDateTime(start, "09:00"), end: asDateTime(end, "10:00") },
    );
    setAllDay(next);
  }

  return (
    <form ref={formRef} action={action} className="space-y-5">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      {state.message && !state.ok && (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 focus:outline-none"
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
          defaultValue={shown.summary}
          required
          aria-invalid={Boolean(state.errors?.summary)}
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
                defaultChecked={shown.calendarId === calendar.id}
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
          defaultChecked={allDay}
          onChange={(e) => toggleAllDay(e.target.checked)}
          className="h-4 w-4 accent-[#22c55e]"
        />
        <span className="text-sm text-fg">All day</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="start">
            {allDay ? "First day" : "Starts"}
          </label>
          {/* Keyed on the mode: swapping `type` on the live node is what makes
              the browser discard the value, so mount a fresh one instead. */}
          <input
            key={allDay ? "start-day" : "start-time"}
            id="start"
            name="start"
            type={allDay ? "date" : "datetime-local"}
            defaultValue={allDay ? asDate(dates.start) : asDateTime(dates.start, "09:00")}
            required
            aria-invalid={Boolean(state.errors?.start)}
            className={`${input} font-mono`}
          />
          <FieldError message={state.errors?.start} />
        </div>
        <div>
          <label className={label} htmlFor="end">
            {allDay ? "Last day" : "Ends"}
          </label>
          <input
            key={allDay ? "end-day" : "end-time"}
            id="end"
            name="end"
            type={allDay ? "date" : "datetime-local"}
            defaultValue={allDay ? asDate(dates.end) : asDateTime(dates.end, "10:00")}
            required
            aria-invalid={Boolean(state.errors?.end)}
            className={`${input} font-mono`}
          />
          <FieldError message={state.errors?.end} />
        </div>
      </div>

      {/* Recurrence ------------------------------------------------------- */}
      <fieldset className="rounded-xl border border-border bg-bg/40 p-4">
        <legend className={`${label} px-1`}>Repeat</legend>

        {/* Every <select> here is keyed on its echoed default. React only
            re-applies a select's `defaultValue` when `multiple` changes, so a
            rejected save has to remount it or the reset restores the option
            the page was first rendered with. */}
        <select
          key={`freq-${shown.recurrence.freq}`}
          name="freq"
          defaultValue={shown.recurrence.freq}
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
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Every</span>
                <input
                  name="interval"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={shown.recurrence.interval}
                  aria-invalid={Boolean(state.errors?.["recurrence.interval"])}
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
              <FieldError message={state.errors?.["recurrence.interval"]} />
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
                        defaultChecked={shown.recurrence.byWeekday.includes(index)}
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
                key={`endMode-${shown.recurrence.endMode}`}
                name="endMode"
                defaultValue={shown.recurrence.endMode}
                onChange={(e) => setEndMode(e.target.value as RecurrenceForm["endMode"])}
                className={input}
              >
                <option value="never">Never</option>
                <option value="count">After a number of occurrences</option>
                <option value="until">On a date</option>
              </select>

              {endMode === "count" && (
                <>
                  <input
                    name="count"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={shown.recurrence.count ?? 10}
                    aria-invalid={Boolean(state.errors?.["recurrence.count"])}
                    className={`${input} mt-2 w-28 font-mono`}
                  />
                  <FieldError message={state.errors?.["recurrence.count"]} />
                </>
              )}
              {endMode === "until" && (
                <>
                  <input
                    name="until"
                    type="date"
                    defaultValue={shown.recurrence.until ?? ""}
                    aria-invalid={Boolean(state.errors?.["recurrence.until"])}
                    className={`${input} mt-2 font-mono`}
                  />
                  <FieldError message={state.errors?.["recurrence.until"]} />
                </>
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
          defaultValue={shown.location}
          aria-invalid={Boolean(state.errors?.location)}
          className={input}
          placeholder="Google Meet"
        />
        <FieldError message={state.errors?.location} />
      </div>

      <div>
        <label className={label} htmlFor="url">
          URL
        </label>
        <input
          id="url"
          name="url"
          type="url"
          defaultValue={shown.url}
          aria-invalid={Boolean(state.errors?.url)}
          className={input}
        />
        <FieldError message={state.errors?.url} />
      </div>

      <div>
        <label className={label} htmlFor="description">
          Notes
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={shown.description}
          rows={3}
          aria-invalid={Boolean(state.errors?.description)}
          className={`${input} resize-y`}
        />
        <FieldError message={state.errors?.description} />
      </div>

      <div>
        <label className={label} htmlFor="status">
          Status
        </label>
        <select
          key={`status-${shown.status}`}
          id="status"
          name="status"
          defaultValue={shown.status}
          className={input}
        >
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

/** The live value of a named field, for reading what has been typed so far. */
function fieldValue(form: HTMLFormElement | null, name: string): string {
  const field = form?.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.value : "";
}

/** "2026-08-26T14:00" -> "2026-08-26". Already-plain dates pass through. */
function asDate(value: string): string {
  return value.slice(0, 10);
}

/** "2026-08-26" -> "2026-08-26T09:00". Values that carry a time pass through. */
function asDateTime(value: string, time: string): string {
  if (value === "") return "";
  return value.includes("T") ? value : `${value}T${time}`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

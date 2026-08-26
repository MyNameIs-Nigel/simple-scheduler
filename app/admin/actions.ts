"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  restoreOccurrenceRecord,
  saveCalendarRecord,
  saveEventRecord,
  skipOccurrenceRecord,
} from "@/db/mutations";
import { calendars, events } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/dal";
import { siteUrl, timezone } from "@/lib/env";
import { buildRRule } from "@/lib/events/rrule";
import {
  calendarSchema,
  eventSchema,
  zodErrors,
  type ActionState,
} from "@/lib/events/validation";
import { fromDateInput, fromLocalInput } from "@/lib/time";
import { parseIcs } from "@/lib/ics/import";

/**
 * Every action begins with `await requireAdmin()`.
 *
 * This is not redundant with proxy.ts. Server Actions are reachable by a direct
 * POST regardless of what the UI renders, so the check has to live here — the
 * proxy redirect only affects people navigating with a browser.
 */

function refresh() {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/events");
  revalidatePath("/admin/calendars");
}

function fail(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

/* -------------------------------------------------------------------------- */
/* Calendars                                                                  */
/* -------------------------------------------------------------------------- */

export async function saveCalendar(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const parsed = calendarSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") ?? "",
    accent: formData.get("accent") ?? 1,
    isPublic: formData.get("isPublic") === "on" || formData.get("isPublic") === "true",
  });

  if (!parsed.success) return fail("Please fix the highlighted fields.", zodErrors(parsed.error));

  const result = saveCalendarRecord(db, { id: id || undefined, ...parsed.data });
  if (!result.ok) return fail("That slug is already in use.", { slug: "Already in use" });

  refresh();
  redirect("/admin/calendars");
}

export async function deleteCalendar(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Events cascade via the foreign key.
  await db.delete(calendars).where(eq(calendars.id, id));
  refresh();
  redirect("/admin/calendars");
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export async function saveEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const zone = timezone();
  const id = String(formData.get("id") ?? "").trim();
  const allDay = formData.get("allDay") === "on" || formData.get("allDay") === "true";

  const parsed = eventSchema.safeParse({
    calendarId: formData.get("calendarId"),
    summary: formData.get("summary"),
    description: formData.get("description") ?? "",
    location: formData.get("location") ?? "",
    url: formData.get("url") ?? "",
    allDay,
    start: formData.get("start"),
    end: formData.get("end"),
    status: formData.get("status") ?? "CONFIRMED",
    recurrence: {
      freq: formData.get("freq") ?? "none",
      interval: formData.get("interval") ?? 1,
      byWeekday: formData.getAll("byWeekday").map(String),
      endMode: formData.get("endMode") ?? "never",
      count: formData.get("count") || undefined,
      until: formData.get("until") || undefined,
    },
  });

  if (!parsed.success) return fail("Please fix the highlighted fields.", zodErrors(parsed.error));
  const input = parsed.data;

  const dtstart = allDay
    ? fromDateInput(input.start, zone)
    : fromLocalInput(input.start, zone);
  let dtend = allDay ? fromDateInput(input.end, zone) : fromLocalInput(input.end, zone);

  if (dtstart === null || dtend === null) {
    return fail("Could not read those dates.", { start: "Invalid date" });
  }

  // DTEND is exclusive in RFC 5545, so a one-day all-day event ends the next
  // day. The form asks for the last day inclusive, which is what a person means.
  if (allDay) dtend += 24 * 60 * 60 * 1000;

  if (dtend <= dtstart) {
    return fail("The end must come after the start.", { end: "Must be after the start" });
  }

  const rrule = buildRRule(
    {
      freq: input.recurrence.freq,
      interval: input.recurrence.interval,
      byWeekday: input.recurrence.byWeekday,
      endMode: input.recurrence.endMode,
      count: input.recurrence.count,
      until: input.recurrence.until,
    },
    zone,
  );

  const result = saveEventRecord(
    db,
    {
      id: id || undefined,
      calendarId: input.calendarId,
      summary: input.summary,
      description: input.description,
      location: input.location,
      url: input.url,
      allDay,
      dtstart,
      dtend,
      rrule,
      status: input.status,
    },
    { host: new URL(siteUrl()).host },
  );

  if (!result.ok) return fail("That event no longer exists.");

  refresh();
  redirect("/admin/events");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await db.delete(events).where(eq(events.id, id));
  refresh();
  redirect("/admin/events");
}

/* -------------------------------------------------------------------------- */
/* Single occurrences of a series                                             */
/* -------------------------------------------------------------------------- */

/** Removes one occurrence by appending to the series' EXDATE list. */
export async function skipOccurrence(formData: FormData): Promise<void> {
  await requireAdmin();

  const eventId = String(formData.get("eventId") ?? "");
  const recurrenceId = Number(formData.get("recurrenceId"));
  if (!eventId || !Number.isFinite(recurrenceId)) return;

  skipOccurrenceRecord(db, eventId, recurrenceId);

  refresh();
}

/** Restores a skipped occurrence. */
export async function restoreOccurrence(formData: FormData): Promise<void> {
  await requireAdmin();

  const eventId = String(formData.get("eventId") ?? "");
  const recurrenceId = Number(formData.get("recurrenceId"));
  if (!eventId || !Number.isFinite(recurrenceId)) return;

  restoreOccurrenceRecord(db, eventId, recurrenceId);

  refresh();
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Imports an uploaded .ics into one calendar, in a single transaction.
 *
 * Incoming UIDs are preserved so a re-import updates the same events rather
 * than duplicating them — which is what makes this safe to run twice.
 */
export async function importIcs(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const calendarId = String(formData.get("calendarId") ?? "");
  if (!calendarId) return fail("Pick a calendar to import into.");

  const [calendar] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .limit(1);
  if (!calendar) return fail("That calendar no longer exists.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a .ics file to import.");
  if (file.size > 5 * 1024 * 1024) return fail("That file is larger than 5 MB.");

  const zone = timezone();
  const parsed = parseIcs(await file.text(), zone);

  if (parsed.events.length === 0) {
    return fail(
      parsed.problems[0] ?? "No importable events were found in that file.",
    );
  }

  const host = new URL(siteUrl()).host;
  const now = Date.now();
  let created = 0;
  let updated = 0;

  // better-sqlite3 is synchronous, so this transaction is genuinely atomic:
  // a failure part-way leaves nothing behind.
  db.transaction((tx) => {
    for (const entry of parsed.events) {
      const uid = entry.uid ?? `imp_${nanoid(12)}@${host}`;

      const existing = tx
        .select()
        .from(events)
        .where(eq(events.uid, uid))
        .limit(1)
        .all();

      const values = {
        calendarId,
        summary: entry.summary,
        description: entry.description,
        location: entry.location,
        url: entry.url,
        dtstart: entry.dtstart,
        dtend: entry.dtend,
        allDay: entry.allDay,
        rrule: entry.rrule,
        exdates: entry.exdates,
        status: entry.status,
        updatedAt: now,
      };

      if (existing.length > 0) {
        tx.update(events)
          .set({ ...values, sequence: existing[0].sequence + 1 })
          .where(eq(events.id, existing[0].id))
          .run();
        updated += 1;
      } else {
        tx.insert(events)
          .values({
            id: `evt_${nanoid(12)}`,
            uid,
            sequence: 0,
            createdAt: now,
            ...values,
          })
          .run();
        created += 1;
      }
    }
  });

  refresh();

  const notes = [`${created} created`, `${updated} updated`];
  if (parsed.skippedOverrides > 0) {
    notes.push(`${parsed.skippedOverrides} modified occurrence(s) skipped`);
  }
  if (parsed.problems.length > 0) {
    notes.push(`${parsed.problems.length} skipped`);
  }

  return { ok: true, message: `Imported into ${calendar.name}: ${notes.join(", ")}.` };
}

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
  saveFeedRecord,
  skipOccurrenceRecord,
} from "@/db/mutations";
import { calendars, events, publishedFeeds } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/dal";
import { siteUrl, timezone } from "@/lib/env";
import { buildRRule } from "@/lib/events/rrule";
import {
  readCalendarForm,
  readEventForm,
  readFeedForm,
  type CalendarFormValues,
  type EventFormValues,
  type FeedFormValues,
} from "@/lib/events/form";
import {
  calendarSchema,
  eventSchema,
  feedSchema,
  zodErrors,
  type ActionState,
} from "@/lib/events/validation";
import { fromDateInput, fromLocalInput } from "@/lib/time";
import { parseIcs } from "@/lib/ics/import";
import { validateSourceUrl } from "@/lib/sync/fetch";
import { syncCalendarById } from "@/lib/sync/runner";

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
  revalidatePath("/admin/feeds");
}

/**
 * True when the calendar mirrors a remote .ics and therefore owns its events.
 *
 * Checked in every mutating action rather than only in the UI: a Server Action
 * is reachable by direct POST whatever the page rendered, and an edit that
 * slipped through would be silently reverted by the next sync anyway.
 */
async function isMirrored(calendarId: string): Promise<boolean> {
  const [calendar] = await db
    .select({ sourceUrl: calendars.sourceUrl })
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .limit(1);
  return Boolean(calendar?.sourceUrl);
}

/** The calendar an existing event belongs to, or null if the event is gone. */
async function calendarIdOfEvent(eventId: string): Promise<string | null> {
  const [event] = await db
    .select({ calendarId: events.calendarId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return event?.calendarId ?? null;
}

const MIRROR_REFUSAL =
  "That calendar mirrors a subscription URL, so its events are read-only. Change it at the source.";

function fail(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

/**
 * Builds the `fail` for one submission, with that submission attached.
 *
 * Every rejection from a form-backed action has to carry `values`: React resets
 * the form as soon as the action settles, so a bare error message would take
 * the user's work with it. Binding them once here is what stops a new failure
 * path from quietly forgetting to.
 */
function rejector<TValues>(values: TValues) {
  return (message: string, errors?: Record<string, string>): ActionState<TValues> => ({
    ok: false,
    message,
    errors,
    values,
  });
}

/** Shown when something below the form throws — a locked database, say. */
const UNEXPECTED =
  "Something went wrong saving that. Nothing was changed, and your entries are still here — try again.";

/* -------------------------------------------------------------------------- */
/* Calendars                                                                  */
/* -------------------------------------------------------------------------- */

export async function saveCalendar(
  _prev: ActionState<CalendarFormValues>,
  formData: FormData,
): Promise<ActionState<CalendarFormValues>> {
  await requireAdmin();

  const outcome = await writeCalendar(readCalendarForm(formData));
  if (!outcome.ok) return outcome;

  refresh();
  redirect("/admin/calendars");
}

/** As `writeEvent`: the redirect stays outside so this can be wrapped whole. */
async function writeCalendar(
  values: CalendarFormValues,
): Promise<ActionState<CalendarFormValues>> {
  const reject = rejector(values);

  try {
    const parsed = calendarSchema.safeParse(values);
    if (!parsed.success) {
      return reject("Please fix the highlighted fields.", zodErrors(parsed.error));
    }

    const sourceUrl = parsed.data.sourceUrl?.trim() || null;
    if (sourceUrl) {
      // Same check the fetcher applies, run here so a bad URL is rejected at the
      // form rather than surfacing 30 minutes later as a sync error.
      const validated = validateSourceUrl(sourceUrl);
      if (!validated.ok) return reject(validated.message, { sourceUrl: validated.message });
    }

    const result = saveCalendarRecord(db, { id: values.id, ...parsed.data, sourceUrl });
    if (!result.ok) return reject("That slug is already in use.", { slug: "Already in use" });

    return { ok: true };
  } catch (error) {
    console.error("[admin] saving a calendar failed:", error);
    return reject(UNEXPECTED);
  }
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

export async function saveEvent(
  _prev: ActionState<EventFormValues>,
  formData: FormData,
): Promise<ActionState<EventFormValues>> {
  await requireAdmin();

  const outcome = await writeEvent(readEventForm(formData));
  if (!outcome.ok) return outcome;

  refresh();
  redirect("/admin/events");
}

/**
 * Everything `saveEvent` does apart from the redirect.
 *
 * Split out so the whole body can sit inside one try/catch: `redirect()` works
 * by throwing, so a catch wrapped around it would swallow the navigation and
 * report a phantom failure.
 */
async function writeEvent(values: EventFormValues): Promise<ActionState<EventFormValues>> {
  const reject = rejector(values);

  try {
    // Both the target calendar and, on an edit, the one the event currently
    // sits on: neither may be a mirror, or the save would be moving an event
    // into or out of rows the sync owns.
    if (values.calendarId && (await isMirrored(values.calendarId))) return reject(MIRROR_REFUSAL);
    if (values.id) {
      const current = await calendarIdOfEvent(values.id);
      if (current && (await isMirrored(current))) return reject(MIRROR_REFUSAL);
    }

    const parsed = eventSchema.safeParse(values);
    if (!parsed.success) {
      return reject("Please fix the highlighted fields.", zodErrors(parsed.error));
    }
    const input = parsed.data;

    const zone = timezone();
    const dtstart = input.allDay
      ? fromDateInput(input.start, zone)
      : fromLocalInput(input.start, zone);
    let dtend = input.allDay ? fromDateInput(input.end, zone) : fromLocalInput(input.end, zone);

    if (dtstart === null || dtend === null) {
      return reject("Could not read those dates.", {
        ...(dtstart === null && { start: "Invalid date" }),
        ...(dtend === null && { end: "Invalid date" }),
      });
    }

    // DTEND is exclusive in RFC 5545, so a one-day all-day event ends the next
    // day. The form asks for the last day inclusive, which is what a person means.
    if (input.allDay) dtend += 24 * 60 * 60 * 1000;

    if (dtend <= dtstart) {
      return reject("The end must come after the start.", { end: "Must be after the start" });
    }

    const result = saveEventRecord(
      db,
      {
        id: values.id,
        calendarId: input.calendarId,
        summary: input.summary,
        description: input.description,
        location: input.location,
        url: input.url,
        allDay: input.allDay,
        dtstart,
        dtend,
        rrule: buildRRule(input.recurrence, zone),
        status: input.status,
      },
      { host: new URL(siteUrl()).host },
    );

    if (!result.ok) return reject("That event no longer exists.");

    return { ok: true };
  } catch (error) {
    console.error("[admin] saving an event failed:", error);
    return reject(UNEXPECTED);
  }
}

export async function deleteEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const calendarId = await calendarIdOfEvent(id);
  if (calendarId && (await isMirrored(calendarId))) return;

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

  const calendarId = await calendarIdOfEvent(eventId);
  if (calendarId && (await isMirrored(calendarId))) return;

  skipOccurrenceRecord(db, eventId, recurrenceId);

  refresh();
}

/** Restores a skipped occurrence. */
export async function restoreOccurrence(formData: FormData): Promise<void> {
  await requireAdmin();

  const eventId = String(formData.get("eventId") ?? "");
  const recurrenceId = Number(formData.get("recurrenceId"));
  if (!eventId || !Number.isFinite(recurrenceId)) return;

  const calendarId = await calendarIdOfEvent(eventId);
  if (calendarId && (await isMirrored(calendarId))) return;

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
  if (calendar.sourceUrl) {
    return fail(
      "That calendar mirrors a subscription URL. Its events come from the source, so an upload would be wiped by the next sync.",
    );
  }

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

/* -------------------------------------------------------------------------- */
/* Published feeds                                                            */
/* -------------------------------------------------------------------------- */

export async function saveFeed(
  _prev: ActionState<FeedFormValues>,
  formData: FormData,
): Promise<ActionState<FeedFormValues>> {
  await requireAdmin();

  const outcome = await writeFeed(readFeedForm(formData));
  if (!outcome.ok) return outcome;

  refresh();
  redirect("/admin/feeds");
}

/** As `writeEvent`: the redirect stays outside so this can be wrapped whole. */
async function writeFeed(values: FeedFormValues): Promise<ActionState<FeedFormValues>> {
  const reject = rejector(values);

  try {
    const parsed = feedSchema.safeParse(values);
    if (!parsed.success) {
      return reject("Please fix the highlighted fields.", zodErrors(parsed.error));
    }

    const result = saveFeedRecord(db, { id: values.id, ...parsed.data });
    if (!result.ok) {
      return result.reason === "slug_taken"
        ? reject("That slug is already in use by a calendar or another feed.", {
            slug: "Already in use",
          })
        : reject("Pick at least one calendar.", { calendarIds: "Pick at least one calendar" });
    }

    return { ok: true };
  } catch (error) {
    console.error("[admin] saving a feed failed:", error);
    return reject(UNEXPECTED);
  }
}

export async function deleteFeed(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Membership rows cascade; the member calendars and their events are untouched.
  await db.delete(publishedFeeds).where(eq(publishedFeeds.id, id));
  refresh();
  redirect("/admin/feeds");
}

/* -------------------------------------------------------------------------- */
/* Subscription sync                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Fetches one subscribed calendar immediately, ignoring its poll interval.
 *
 * Awaited rather than fired off in the background: the point of the button is
 * to see the result, and the outcome is rendered from the calendar's own
 * lastSync* columns once the page revalidates.
 */
export async function syncCalendarNow(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  try {
    await syncCalendarById(id);
  } catch (error) {
    // syncCalendarSource records its own failures; this only catches the
    // unexpected, and a thrown Server Action would render an error page over
    // what is a recoverable condition.
    console.error("[sync] manual sync failed:", error);
  }

  refresh();
}

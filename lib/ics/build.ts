import "server-only";

import { createHash } from "node:crypto";
import ical, { ICalEventStatus } from "ical-generator";
import { getVtimezoneComponent } from "@touch4it/ical-timezones";
import { DateTime } from "luxon";

import { siteUrl, timezone } from "@/lib/env";
import {
  getCalendarBySlug,
  listAllEvents,
  listCalendars,
  listOverridesFor,
} from "@/lib/events/queries";
import type { Calendar, EventOverride, EventRow } from "@/db/schema";

/**
 * Builds the public .ics feeds straight from the database.
 *
 * Nothing is written to disk. There is no generated file that can drift out of
 * sync with the data — an edit in the admin GUI is visible on the very next
 * fetch of the feed, by construction.
 *
 * Correctness notes, in rough order of how easy they are to get wrong:
 *  - Recurring events must carry TZID + a real VTIMEZONE. A UTC DTSTART makes
 *    a weekly meeting drift by an hour every time the zone changes offset.
 *  - SEQUENCE must increase on edit or subscribers ignore the update.
 *  - A modified occurrence is its own VEVENT sharing the series UID and
 *    carrying RECURRENCE-ID; it is not a separate event.
 *  - All-day events use VALUE=DATE with an exclusive DTEND.
 */

export const COMBINED_SLUG = "all";

/** iCalendar local date-time, e.g. 20260826T140000 (zone comes from TZID). */
const icsLocalFormat = "yyyyLLdd'T'HHmmss";

export type IcsResult = {
  body: string;
  etag: string;
  calendarName: string;
};

function stripIcsSuffix(slug: string): string {
  return slug.replace(/\.ics$/i, "");
}

/** Resolves a feed slug to the calendars it covers. `all` = every public one. */
async function resolveCalendars(rawSlug: string): Promise<{ name: string; calendars: Calendar[] } | null> {
  const slug = stripIcsSuffix(rawSlug);

  if (slug === COMBINED_SLUG) {
    const all = await listCalendars({ publicOnly: true });
    return { name: "Nigel Smith — Schedule", calendars: all };
  }

  const calendar = await getCalendarBySlug(slug);
  if (!calendar || !calendar.isPublic) return null;
  return { name: `Nigel Smith — ${calendar.name}`, calendars: [calendar] };
}

export async function buildFeed(rawSlug: string): Promise<IcsResult | null> {
  const resolved = await resolveCalendars(rawSlug);
  if (!resolved) return null;

  const zone = timezone();
  const calendarIds = resolved.calendars.map((c) => c.id);
  const rows = await listAllEvents(calendarIds);
  const overrides = await listOverridesFor(rows.map((r) => r.id));

  const overridesByEvent = new Map<string, EventOverride[]>();
  for (const o of overrides) {
    const list = overridesByEvent.get(o.eventId);
    if (list) list.push(o);
    else overridesByEvent.set(o.eventId, [o]);
  }

  const cal = ical({
    name: resolved.name,
    prodId: { company: "nigel-smith.dev", product: "simple-scheduler", language: "EN" },
    timezone: { name: zone, generator: getVtimezoneComponent },
    url: `${siteUrl()}/calendars/${stripIcsSuffix(rawSlug)}.ics`,
  });

  // Tells subscribing clients how often to poll. Purely advisory.
  cal.x("X-PUBLISHED-TTL", "PT15M");
  cal.x("X-WR-CALNAME", resolved.name);
  cal.x("X-WR-TIMEZONE", zone);

  for (const event of rows) {
    addSeries(cal, event, zone);
    for (const override of overridesByEvent.get(event.id) ?? []) {
      addOverride(cal, event, override, zone);
    }
  }

  const body = cal.toString();

  return {
    body,
    // Weak-ish but content-exact: any change to any field changes the tag.
    etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 32)}"`,
    calendarName: resolved.name,
  };
}

function icsStatus(status: EventRow["status"]): ICalEventStatus {
  if (status === "CANCELLED") return ICalEventStatus.CANCELLED;
  if (status === "TENTATIVE") return ICalEventStatus.TENTATIVE;
  return ICalEventStatus.CONFIRMED;
}

function addSeries(cal: ReturnType<typeof ical>, event: EventRow, zone: string) {
  const entry = cal.createEvent({
    id: event.uid,
    start: DateTime.fromMillis(event.dtstart, { zone }),
    end: DateTime.fromMillis(event.dtend, { zone }),
    summary: event.summary,
    allDay: event.allDay,
    timezone: event.allDay ? null : zone,
    stamp: DateTime.fromMillis(event.updatedAt, { zone: "utc" }),
    created: DateTime.fromMillis(event.createdAt, { zone: "utc" }),
    lastModified: DateTime.fromMillis(event.updatedAt, { zone: "utc" }),
    sequence: event.sequence,
    status: icsStatus(event.status),
  });

  if (event.description) entry.description(event.description);
  if (event.location) entry.location(event.location);
  if (event.url) entry.url(event.url);

  if (event.rrule) {
    // The string form of repeating() is passed through as raw ICS lines, which
    // lets us emit the stored rule untouched and hang a TZID-qualified EXDATE
    // off it. Both are already RFC 5545 text produced by the admin form.
    const lines = [`RRULE:${event.rrule}`];

    const exdates = event.exdates ?? [];
    if (exdates.length > 0) {
      const stamps = exdates
        .map((ms) => DateTime.fromMillis(ms, { zone }).toFormat(icsLocalFormat))
        .join(",");
      lines.push(
        event.allDay
          ? `EXDATE;VALUE=DATE:${exdates
              .map((ms) => DateTime.fromMillis(ms, { zone }).toFormat("yyyyLLdd"))
              .join(",")}`
          : `EXDATE;TZID=${zone}:${stamps}`,
      );
    }

    entry.repeating(lines.join("\n"));
  }
}

/**
 * A modified occurrence: same UID as the series, plus RECURRENCE-ID pointing at
 * the slot it replaces. Clients match the two up and render one event.
 */
function addOverride(
  cal: ReturnType<typeof ical>,
  parent: EventRow,
  override: EventOverride,
  zone: string,
) {
  const duration = Math.max(0, parent.dtend - parent.dtstart);
  const start = override.dtstart ?? override.recurrenceId;
  const end = override.dtend ?? start + duration;

  const entry = cal.createEvent({
    id: parent.uid,
    start: DateTime.fromMillis(start, { zone }),
    end: DateTime.fromMillis(end, { zone }),
    summary: override.summary ?? parent.summary,
    allDay: parent.allDay,
    timezone: parent.allDay ? null : zone,
    stamp: DateTime.fromMillis(override.updatedAt, { zone: "utc" }),
    sequence: parent.sequence,
    status: override.cancelled ? ICalEventStatus.CANCELLED : icsStatus(parent.status),
  });

  const description = override.description ?? parent.description;
  const location = override.location ?? parent.location;
  if (description) entry.description(description);
  if (location) entry.location(location);

  // Native setter — emits RECURRENCE-ID;TZID=<zone>:<local stamp>.
  entry.recurrenceId(DateTime.fromMillis(override.recurrenceId, { zone }));
}

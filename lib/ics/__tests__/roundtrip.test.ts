import { describe, expect, it } from "vitest";
import ical, { ICalEventStatus } from "ical-generator";
import { getVtimezoneComponent } from "@touch4it/ical-timezones";
import { DateTime } from "luxon";
import icalParser, { type VEvent } from "node-ical";

import { normaliseUtcStamps } from "../format";

const ZONE = "America/New_York";

/**
 * Round-trips generated ICS back through a parser. This is the cheap proxy for
 * "does a real calendar client understand this" — it catches the field-shape
 * mistakes (missing TZID, malformed EXDATE, unmatched RECURRENCE-ID) that
 * otherwise only show up after subscribing Google Calendar to the feed.
 *
 * Mirrors the property construction in lib/ics/build.ts. Kept parallel rather
 * than importing it because build.ts is `server-only` and hits the database.
 */
function buildSample() {
  const cal = ical({
    name: "Test",
    prodId: { company: "nigel-smith.dev", product: "simple-scheduler", language: "EN" },
    timezone: { name: ZONE, generator: getVtimezoneComponent },
  });

  const series = cal.createEvent({
    id: "series@test",
    start: DateTime.fromISO("2026-03-02T14:00", { zone: ZONE }),
    end: DateTime.fromISO("2026-03-02T14:30", { zone: ZONE }),
    summary: "Standup",
    timezone: ZONE,
    sequence: 3,
    status: ICalEventStatus.CONFIRMED,
  });
  series.repeating(
    ["RRULE:FREQ=WEEKLY;BYDAY=MO", `EXDATE;TZID=${ZONE}:20260309T140000`].join("\n"),
  );

  const moved = cal.createEvent({
    id: "series@test",
    start: DateTime.fromISO("2026-03-16T09:00", { zone: ZONE }),
    end: DateTime.fromISO("2026-03-16T09:30", { zone: ZONE }),
    summary: "Standup (moved)",
    timezone: ZONE,
    sequence: 3,
  });
  moved.recurrenceId(DateTime.fromISO("2026-03-16T14:00", { zone: ZONE }));

  const allDay = cal.createEvent({
    id: "allday@test",
    start: DateTime.fromISO("2026-04-01", { zone: ZONE }),
    end: DateTime.fromISO("2026-04-02", { zone: ZONE }),
    summary: "Conference",
    allDay: true,
  });
  allDay.timezone(null);

  return cal.toString();
}

describe("generated ICS", () => {
  const ics = buildSample();

  it("declares a VTIMEZONE with DST transition rules", () => {
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain(`TZID:${ZONE}`);
    expect(ics).toContain("BEGIN:DAYLIGHT");
    expect(ics).toContain("BEGIN:STANDARD");
  });

  it("anchors timed events to the zone rather than UTC", () => {
    // A bare UTC DTSTART here would make the weekly series drift across DST.
    expect(ics).toContain(`DTSTART;TZID=${ZONE}:20260302T140000`);
  });

  it("emits EXDATE with a TZID, not a bare or X- prefixed line", () => {
    expect(ics).toContain(`EXDATE;TZID=${ZONE}:20260309T140000`);
    expect(ics).not.toContain("X-EXDATE");
  });

  it("emits RECURRENCE-ID for the modified occurrence", () => {
    expect(ics).toContain(`RECURRENCE-ID;TZID=${ZONE}:20260316T140000`);
    expect(ics).not.toContain("X-RECURRENCE-ID");
  });

  it("gives the override the same UID as its series", () => {
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());
    expect(uids.filter((u) => u === "series@test")).toHaveLength(2);
  });

  it("carries SEQUENCE so subscribers accept updates", () => {
    expect(ics).toContain("SEQUENCE:3");
  });

  it("writes all-day events as VALUE=DATE with an exclusive end", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20260401");
    expect(ics).toContain("DTEND;VALUE=DATE:20260402");
  });
});

describe("parsed back by node-ical", () => {
  const parsed = icalParser.parseICS(buildSample());
  const entries = Object.values(parsed).filter(
    (e): e is VEvent => (e as VEvent).type === "VEVENT",
  );

  it("yields the expected events", () => {
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.map((e) => e.summary)).toContain("Standup");
    expect(entries.map((e) => e.summary)).toContain("Conference");
  });

  it("recovers the recurrence rule", () => {
    const series = entries.find((e) => e.summary === "Standup");
    expect(series?.rrule).toBeDefined();
    expect(series?.rrule?.toString()).toContain("FREQ=WEEKLY");
  });

  it("recovers the start instant at the correct wall-clock time", () => {
    const series = entries.find((e) => e.summary === "Standup");
    const start = DateTime.fromJSDate(series!.start as Date, { zone: ZONE });
    expect(start.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-03-02 14:00");
  });
});

describe("UTC stamp normalisation", () => {
  it("converts a floating DTSTAMP to UTC with a Z suffix", () => {
    // 2026-03-01 05:00 EST == 10:00 UTC
    const input = "BEGIN:VEVENT\r\nDTSTAMP:20260301T050000\r\nEND:VEVENT";
    expect(normaliseUtcStamps(input, ZONE)).toContain("DTSTAMP:20260301T100000Z");
  });

  it("also normalises CREATED and LAST-MODIFIED", () => {
    const input = "CREATED:20260301T050000\r\nLAST-MODIFIED:20260301T060000";
    const out = normaliseUtcStamps(input, ZONE);
    expect(out).toContain("CREATED:20260301T100000Z");
    expect(out).toContain("LAST-MODIFIED:20260301T110000Z");
  });

  it("leaves an already-UTC stamp alone", () => {
    const input = "DTSTAMP:20260301T100000Z";
    expect(normaliseUtcStamps(input, ZONE)).toBe(input);
  });

  it("does not touch DTSTART, which is legitimately zone-qualified", () => {
    const input = `DTSTART;TZID=${ZONE}:20260302T140000`;
    expect(normaliseUtcStamps(input, ZONE)).toBe(input);
  });
});

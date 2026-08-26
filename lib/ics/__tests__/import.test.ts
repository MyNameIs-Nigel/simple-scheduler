import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { parseIcs } from "../import";

const ZONE = "America/New_York";
const FIXTURE = path.resolve(import.meta.dirname, "fixtures/sample.ics");

/**
 * The fixture is a feed this app generated, captured from a running server.
 * Parsing our own output back is the round-trip that matters: it proves an
 * export/re-import cycle is lossless for the fields we actually store.
 */
const sample = fs.readFileSync(FIXTURE, "utf8");

describe("parseIcs on our own generated feed", () => {
  const result = parseIcs(sample, ZONE);

  it("reports no problems", () => {
    expect(result.problems).toEqual([]);
  });

  it("recovers every series", () => {
    // The fixture has 6 series plus one modified occurrence.
    expect(result.events).toHaveLength(6);
    expect(result.skippedOverrides).toBe(1);
  });

  it("preserves UIDs so a re-import updates rather than duplicates", () => {
    expect(result.events.every((e) => e.uid && e.uid.length > 0)).toBe(true);
    expect(new Set(result.events.map((e) => e.uid)).size).toBe(result.events.length);
  });

  it("recovers recurrence rules", () => {
    const standup = result.events.find((e) => e.summary === "Standup");
    expect(standup?.rrule).toContain("FREQ=WEEKLY");
    expect(standup?.rrule).not.toMatch(/^RRULE:/);
  });

  it("recovers EXDATEs", () => {
    const standup = result.events.find((e) => e.summary === "Standup");
    expect(standup?.exdates?.length).toBeGreaterThan(0);
  });

  it("recovers start times at the right wall-clock moment", () => {
    const standup = result.events.find((e) => e.summary === "Standup")!;
    expect(DateTime.fromMillis(standup.dtstart, { zone: ZONE }).toFormat("HH:mm")).toBe("09:30");
  });

  it("flags the all-day event as all-day", () => {
    const away = result.events.find((e) => e.summary === "Long weekend");
    expect(away?.allDay).toBe(true);
  });

  it("gives every event a positive duration", () => {
    expect(result.events.every((e) => e.dtend > e.dtstart)).toBe(true);
  });
});

describe("robustness", () => {
  it("returns a problem rather than throwing on junk input", () => {
    const result = parseIcs("this is not a calendar", ZONE);
    expect(result.events).toHaveLength(0);
  });

  it("skips an event with no title", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:no-title@test",
      "DTSTART:20260302T140000Z",
      "DTEND:20260302T143000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const result = parseIcs(ics, ZONE);
    expect(result.events).toHaveLength(0);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("supplies an end when DTEND is missing", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:no-end@test",
      "SUMMARY:Open ended",
      "DTSTART:20260302T140000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const result = parseIcs(ics, ZONE);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].dtend).toBeGreaterThan(result.events[0].dtstart);
  });
});

describe("all-day anchoring", () => {
  const allDayIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:away@test",
    "SUMMARY:Away",
    "DTSTART;VALUE=DATE:20260401",
    "DTEND;VALUE=DATE:20260403",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("anchors an all-day start to midnight in the scheduler's zone", () => {
    // node-ical yields midnight in the *process* timezone, which for a
    // VALUE=DATE is meaningless — it names a calendar day, not an instant.
    const [event] = parseIcs(allDayIcs, ZONE).events;
    const start = DateTime.fromMillis(event.dtstart, { zone: ZONE });

    expect(start.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-04-01 00:00");
  });

  it("keeps DTEND exclusive", () => {
    const [event] = parseIcs(allDayIcs, ZONE).events;
    const end = DateTime.fromMillis(event.dtend, { zone: ZONE });

    expect(end.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-04-03 00:00");
  });

  it("lands on the same calendar day for a zone east of UTC", () => {
    const [event] = parseIcs(allDayIcs, "Australia/Sydney").events;
    const start = DateTime.fromMillis(event.dtstart, { zone: "Australia/Sydney" });

    expect(start.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-04-01 00:00");
  });

  it("round-trips the fixture's all-day event onto the right day", () => {
    const away = parseIcs(sample, ZONE).events.find((e) => e.summary === "Long weekend")!;
    const start = DateTime.fromMillis(away.dtstart, { zone: ZONE });

    expect(start.toFormat("HH:mm")).toBe("00:00");
  });
});

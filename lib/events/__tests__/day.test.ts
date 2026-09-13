import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { calendars, events } from "@/db/schema";
import { db } from "@/db";
import type { Occurrence } from "@/lib/events/expand";
import {
  dayRange,
  describeOccurrences,
  getDaySummary,
  hrefForDay,
  parseDayParam,
  stepDay,
} from "@/lib/events/day";

const ZONE = "America/New_York";

const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();

function occurrence(over: Partial<Occurrence> = {}): Occurrence {
  return {
    eventId: "evt_1",
    key: "evt_1",
    calendarId: "cal_1",
    summary: "Standup",
    description: null,
    location: null,
    url: null,
    start: at("2026-09-12T14:00"),
    end: at("2026-09-12T14:30"),
    allDay: false,
    status: "CONFIRMED",
    recurring: false,
    recurrenceId: null,
    overridden: false,
    ...over,
  };
}

describe("parseDayParam", () => {
  it("passes a valid date through", () => {
    expect(parseDayParam("2026-09-12", ZONE)).toBe("2026-09-12");
  });

  it("reduces a datetime to its calendar date", () => {
    expect(parseDayParam("2026-09-12T15:30:00", ZONE)).toBe("2026-09-12");
  });

  it("takes the first value when the key repeats", () => {
    expect(parseDayParam(["2026-09-12", "2026-09-13"], ZONE)).toBe("2026-09-12");
  });

  it.each([undefined, null, "", "not-a-date", "2026-13-40"])(
    "falls back to today for %s",
    (value) => {
      const today = DateTime.now().setZone(ZONE).toFormat("yyyy-MM-dd");
      expect(parseDayParam(value as undefined, ZONE)).toBe(today);
    },
  );
});

describe("dayRange", () => {
  it("covers exactly one midnight-to-midnight day", () => {
    const { start, end } = dayRange("2026-09-12", ZONE);
    expect(end - start).toBe(24 * 60 * 60 * 1000);
    expect(DateTime.fromMillis(start, { zone: ZONE }).toFormat("HH:mm")).toBe("00:00");
    expect(at("2026-09-12T12:00")).toBeGreaterThanOrEqual(start);
    expect(at("2026-09-12T12:00")).toBeLessThan(end);
  });
});

describe("day navigation", () => {
  it("builds the ?date= URL", () => {
    expect(hrefForDay("2026-09-12")).toBe("/day?date=2026-09-12");
  });

  it("steps across a month boundary", () => {
    expect(stepDay("2026-09-01", ZONE, -1)).toBe("2026-08-31");
    expect(stepDay("2026-09-12", ZONE, 1)).toBe("2026-09-13");
  });
});

describe("describeOccurrences", () => {
  it("reports an empty day", () => {
    expect(describeOccurrences([], ZONE)).toBe("No events scheduled.");
  });

  it("lists names with time of day, not date-time", () => {
    const description = describeOccurrences(
      [
        occurrence({ summary: "Standup" }),
        occurrence({ summary: "Gym", start: at("2026-09-12T16:30"), end: at("2026-09-12T17:30") }),
      ],
      ZONE,
    );
    expect(description).toBe("14:00 Standup, 16:30 Gym");
    expect(description).not.toContain("2026");
  });

  it("marks all-day events instead of giving them a time", () => {
    const description = describeOccurrences(
      [occurrence({ summary: "Launch day", allDay: true })],
      ZONE,
    );
    expect(description).toBe("Launch day (all day)");
  });

  it("truncates a long list with an ellipsis", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      occurrence({
        key: `evt_${i}`,
        eventId: `evt_${i}`,
        summary: `Event number ${i} with a fairly long name`,
        start: at("2026-09-12T09:00") + i * 60_000,
        end: at("2026-09-12T09:30") + i * 60_000,
      }),
    );
    const description = describeOccurrences(many, ZONE, 200);
    expect(description.endsWith("…")).toBe(true);
    expect(description.length).toBeLessThanOrEqual(201);
    // Cut at a whole event, never mid-word.
    expect(description.slice(0, -1)).not.toMatch(/,\s*$/);
  });

  it("leaves a list that fits alone", () => {
    const description = describeOccurrences([occurrence()], ZONE, 200);
    expect(description).toBe("14:00 Standup");
  });
});

describe("getDaySummary", () => {
  it("returns one day's public events with a condensed description", async () => {
    db.insert(calendars)
      .values([
        { id: "cal_day", slug: "day", name: "Day", accent: 1, isPublic: true, sortOrder: 0 },
        { id: "cal_priv", slug: "priv", name: "Private", accent: 2, isPublic: false, sortOrder: 1 },
      ])
      .run();
    db.insert(events)
      .values([
        {
          id: "evt_morning",
          calendarId: "cal_day",
          uid: "uid-morning",
          summary: "Morning standup",
          dtstart: at("2026-09-12T09:00"),
          dtend: at("2026-09-12T09:30"),
          allDay: false,
          status: "CONFIRMED",
        },
        {
          id: "evt_launch",
          calendarId: "cal_day",
          uid: "uid-launch",
          summary: "Launch day",
          dtstart: at("2026-09-12T00:00"),
          dtend: at("2026-09-13T00:00"),
          allDay: true,
          status: "CONFIRMED",
        },
        {
          id: "evt_tomorrow",
          calendarId: "cal_day",
          uid: "uid-tomorrow",
          summary: "Tomorrow thing",
          dtstart: at("2026-09-13T09:00"),
          dtend: at("2026-09-13T10:00"),
          allDay: false,
          status: "CONFIRMED",
        },
        {
          id: "evt_hidden",
          calendarId: "cal_priv",
          uid: "uid-hidden",
          summary: "Secret meeting",
          dtstart: at("2026-09-12T12:00"),
          dtend: at("2026-09-12T13:00"),
          allDay: false,
          status: "CONFIRMED",
        },
      ])
      .run();

    const summary = await getDaySummary("2026-09-12", ZONE);

    expect(summary.dateIso).toBe("2026-09-12");
    expect(summary.count).toBe(2);
    expect(summary.occurrences.map((o) => o.summary).sort()).toEqual([
      "Launch day",
      "Morning standup",
    ]);
    expect(summary.description).toContain("09:00 Morning standup");
    expect(summary.description).toContain("Launch day (all day)");
    expect(summary.description).not.toContain("Tomorrow thing");
    expect(summary.description).not.toContain("Secret meeting");
  });
});

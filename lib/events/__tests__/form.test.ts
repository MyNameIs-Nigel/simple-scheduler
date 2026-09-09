import { describe, expect, it } from "vitest";

import { readCalendarForm, readEventForm, readFeedForm } from "../form";
import { eventSchema } from "../validation";

/**
 * These readers are what let a rejected save keep the user's work: whatever
 * they return is echoed back into `ActionState.values` and re-rendered as the
 * form's defaults. So the property that matters is that a submission survives
 * the round trip *even when it is invalid* — the invalid case is the only one
 * that ever gets echoed.
 */

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

const FILLED: Array<[string, string]> = [
  ["id", "evt_abc"],
  ["calendarId", "cal_1"],
  ["summary", "Standup"],
  ["description", "Daily sync"],
  ["location", "Meet"],
  ["url", "https://example.com/"],
  ["allDay", "on"],
  ["start", "2026-03-02"],
  ["end", "2026-03-06"],
  ["status", "TENTATIVE"],
  ["freq", "weekly"],
  ["interval", "2"],
  ["byWeekday", "0"],
  ["byWeekday", "3"],
  ["endMode", "count"],
  ["count", "12"],
];

describe("readEventForm", () => {
  it("reads a fully populated submission", () => {
    expect(readEventForm(form(FILLED))).toEqual({
      id: "evt_abc",
      calendarId: "cal_1",
      summary: "Standup",
      description: "Daily sync",
      location: "Meet",
      url: "https://example.com/",
      allDay: true,
      start: "2026-03-02",
      end: "2026-03-06",
      status: "TENTATIVE",
      recurrence: {
        freq: "weekly",
        interval: 2,
        byWeekday: [0, 3],
        endMode: "count",
        count: 12,
        until: undefined,
      },
    });
  });

  it("keeps what was typed even when the submission is rejected", () => {
    // A title that is only whitespace and a malformed URL: two ways to fail
    // validation while still having plenty of work worth not losing.
    const data = form([
      ["calendarId", "cal_1"],
      ["summary", "   "],
      ["description", "Notes worth keeping"],
      ["url", "not a url"],
      ["start", "2026-03-02T09:00"],
      ["end", "2026-03-02T10:00"],
      ["freq", "monthly"],
      ["interval", "3"],
      ["endMode", "until"],
      ["until", "2026-12-31"],
    ]);

    const values = readEventForm(data);
    expect(eventSchema.safeParse(values).success).toBe(false);

    expect(values.description).toBe("Notes worth keeping");
    expect(values.url).toBe("not a url");
    expect(values.start).toBe("2026-03-02T09:00");
    expect(values.recurrence).toMatchObject({
      freq: "monthly",
      interval: 3,
      endMode: "until",
      until: "2026-12-31",
    });
  });

  it("fills in the absent, and never yields NaN for a blank number", () => {
    const values = readEventForm(form([["summary", "Bare"]]));

    expect(values.id).toBeUndefined();
    expect(values.allDay).toBe(false);
    expect(values.status).toBe("CONFIRMED");
    expect(values.recurrence.freq).toBe("none");
    expect(values.recurrence.interval).toBe(1);
    expect(values.recurrence.byWeekday).toEqual([]);
    expect(values.recurrence.count).toBeUndefined();
  });

  it("falls back rather than trusting a hand-rolled POST", () => {
    const values = readEventForm(
      form([
        ["status", "DELETED"],
        ["freq", "hourly"],
        ["endMode", "forever"],
        ["interval", "not-a-number"],
        ["byWeekday", "2"],
        ["byWeekday", "nonsense"],
      ]),
    );

    expect(values.status).toBe("CONFIRMED");
    expect(values.recurrence.freq).toBe("none");
    expect(values.recurrence.endMode).toBe("never");
    expect(values.recurrence.interval).toBe(1);
    expect(values.recurrence.byWeekday).toEqual([2]);
  });
});

describe("readCalendarForm", () => {
  it("round-trips a submission, unchecked boxes included", () => {
    expect(
      readCalendarForm(
        form([
          ["name", "Work"],
          ["slug", "work"],
          ["description", "  trimmed  "],
          ["accent", "3"],
          ["sourceUrl", "webcal://example.com/x.ics"],
        ]),
      ),
    ).toEqual({
      id: undefined,
      name: "Work",
      slug: "work",
      description: "trimmed",
      accent: 3,
      isPublic: false,
      sourceUrl: "webcal://example.com/x.ics",
    });
  });
});

describe("readFeedForm", () => {
  it("keeps every checked calendar", () => {
    expect(
      readFeedForm(
        form([
          ["id", "fee_1"],
          ["name", "Combined"],
          ["slug", "combined"],
          ["isPublic", "on"],
          ["calendarIds", "cal_1"],
          ["calendarIds", "cal_2"],
        ]),
      ),
    ).toEqual({
      id: "fee_1",
      name: "Combined",
      slug: "combined",
      description: "",
      isPublic: true,
      calendarIds: ["cal_1", "cal_2"],
    });
  });
});

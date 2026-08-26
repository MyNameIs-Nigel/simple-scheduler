import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { expandOccurrences } from "../expand";
import type { EventOverride, EventRow } from "@/db/schema";

const ZONE = "America/New_York";

/** Wall-clock time in ZONE -> stored UTC instant. */
function at(iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: ZONE });
  if (!dt.isValid) throw new Error(`bad test date: ${iso} (${dt.invalidReason})`);
  return dt.toMillis();
}

function hhmm(epochMs: number): string {
  return DateTime.fromMillis(epochMs, { zone: ZONE }).toFormat("yyyy-MM-dd HH:mm");
}

function makeEvent(over: Partial<EventRow> = {}): EventRow {
  return {
    id: "evt_1",
    calendarId: "cal_1",
    uid: "evt_1@test",
    summary: "Standup",
    description: null,
    location: null,
    url: null,
    dtstart: at("2026-03-02T14:00"),
    dtend: at("2026-03-02T14:30"),
    allDay: false,
    rrule: null,
    exdates: null,
    status: "CONFIRMED",
    sequence: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as EventRow;
}

function makeOverride(over: Partial<EventOverride> = {}): EventOverride {
  return {
    id: "ovr_1",
    eventId: "evt_1",
    recurrenceId: 0,
    summary: null,
    description: null,
    location: null,
    dtstart: null,
    dtend: null,
    cancelled: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as EventOverride;
}

function expand(events: EventRow[], overrides: EventOverride[], from: string, to: string) {
  return expandOccurrences({
    events,
    overrides,
    rangeStart: at(from),
    rangeEnd: at(to),
    zone: ZONE,
  });
}

describe("single events", () => {
  it("includes an event inside the window", () => {
    const out = expand([makeEvent()], [], "2026-03-01T00:00", "2026-03-31T00:00");
    expect(out).toHaveLength(1);
    expect(out[0].recurring).toBe(false);
    expect(out[0].recurrenceId).toBeNull();
  });

  it("excludes an event outside the window", () => {
    const out = expand([makeEvent()], [], "2026-04-01T00:00", "2026-04-30T00:00");
    expect(out).toHaveLength(0);
  });

  it("includes a multi-day event that straddles the window start", () => {
    const event = makeEvent({
      dtstart: at("2026-02-26T09:00"),
      dtend: at("2026-03-04T17:00"),
    });
    const out = expand([event], [], "2026-03-01T00:00", "2026-03-31T00:00");
    expect(out).toHaveLength(1);
  });
});

describe("recurrence across a DST boundary", () => {
  // US DST begins 2026-03-08. A 14:00 local meeting must stay at 14:00 local,
  // which means its UTC offset shifts by an hour. This is the bug the floating
  // -UTC conversion in lib/time.ts exists to prevent.
  it("keeps weekly occurrences at the same wall-clock time", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4" });
    const out = expand([event], [], "2026-03-01T00:00", "2026-04-01T00:00");

    expect(out.map((o) => hhmm(o.start))).toEqual([
      "2026-03-02 14:00",
      "2026-03-09 14:00",
      "2026-03-16 14:00",
      "2026-03-23 14:00",
    ]);
  });

  it("preserves duration across the boundary", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=3" });
    const out = expand([event], [], "2026-03-01T00:00", "2026-04-01T00:00");
    for (const occ of out) {
      expect(occ.end - occ.start).toBe(30 * 60 * 1000);
    }
  });
});

describe("UNTIL and COUNT", () => {
  it("honours COUNT", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;COUNT=3" });
    const out = expand([event], [], "2026-03-01T00:00", "2026-04-01T00:00");
    expect(out).toHaveLength(3);
  });

  it("honours UNTIL", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;UNTIL=20260305T140000Z" });
    const out = expand([event], [], "2026-03-01T00:00", "2026-04-01T00:00");
    expect(out.map((o) => hhmm(o.start))).toEqual([
      "2026-03-02 14:00",
      "2026-03-03 14:00",
      "2026-03-04 14:00",
    ]);
  });
});

describe("EXDATE", () => {
  it("skips an excluded occurrence", () => {
    const event = makeEvent({
      rrule: "FREQ=DAILY;COUNT=4",
      exdates: [at("2026-03-03T14:00")],
    });
    const out = expand([event], [], "2026-03-01T00:00", "2026-04-01T00:00");
    expect(out).toHaveLength(3);
    expect(out.map((o) => hhmm(o.start))).not.toContain("2026-03-03 14:00");
  });
});

describe("per-occurrence overrides", () => {
  it("moves a single occurrence to another day", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;COUNT=3" });
    const override = makeOverride({
      recurrenceId: at("2026-03-03T14:00"),
      dtstart: at("2026-03-05T09:00"),
      dtend: at("2026-03-05T09:30"),
      summary: "Standup (moved)",
    });

    const out = expand([event], [override], "2026-03-01T00:00", "2026-04-01T00:00");
    const moved = out.find((o) => o.overridden);

    expect(moved).toBeDefined();
    expect(hhmm(moved!.start)).toBe("2026-03-05 09:00");
    expect(moved!.summary).toBe("Standup (moved)");
    // RECURRENCE-ID must remain the *original* slot, or the .ics will not
    // match the override to the series it belongs to.
    expect(hhmm(moved!.recurrenceId!)).toBe("2026-03-03 14:00");
  });

  it("drops a cancelled occurrence from the UI", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;COUNT=3" });
    const override = makeOverride({
      recurrenceId: at("2026-03-02T14:00"),
      cancelled: true,
    });

    const out = expand([event], [override], "2026-03-01T00:00", "2026-04-01T00:00");
    expect(out).toHaveLength(2);
  });

  it("keeps a cancelled occurrence when includeCancelled is set", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;COUNT=3" });
    const override = makeOverride({
      recurrenceId: at("2026-03-02T14:00"),
      cancelled: true,
    });

    const out = expandOccurrences({
      events: [event],
      overrides: [override],
      rangeStart: at("2026-03-01T00:00"),
      rangeEnd: at("2026-04-01T00:00"),
      zone: ZONE,
      includeCancelled: true,
    });

    expect(out).toHaveLength(3);
    expect(out.filter((o) => o.status === "CANCELLED")).toHaveLength(1);
  });

  it("inherits unset fields from the parent series", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;COUNT=2", location: "Room A" });
    const override = makeOverride({
      recurrenceId: at("2026-03-03T14:00"),
      summary: "Renamed",
    });

    const out = expand([event], [override], "2026-03-01T00:00", "2026-04-01T00:00");
    const changed = out.find((o) => o.overridden)!;

    expect(changed.summary).toBe("Renamed");
    expect(changed.location).toBe("Room A");
  });
});

describe("robustness", () => {
  it("ignores an unparseable RRULE rather than blanking the calendar", () => {
    const bad = makeEvent({ id: "evt_bad", uid: "bad@test", rrule: "totally not a rule" });
    const good = makeEvent({ id: "evt_good", uid: "good@test" });

    const out = expand([bad, good], [], "2026-03-01T00:00", "2026-04-01T00:00");
    expect(out.map((o) => o.eventId)).toEqual(["evt_good"]);
  });

  it("returns occurrences sorted by start", () => {
    const a = makeEvent({ id: "a", uid: "a@t", dtstart: at("2026-03-10T09:00"), dtend: at("2026-03-10T10:00") });
    const b = makeEvent({ id: "b", uid: "b@t", dtstart: at("2026-03-05T09:00"), dtend: at("2026-03-05T10:00") });

    const out = expand([a, b], [], "2026-03-01T00:00", "2026-04-01T00:00");
    expect(out.map((o) => o.eventId)).toEqual(["b", "a"]);
  });
});

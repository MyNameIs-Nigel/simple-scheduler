import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";

import * as schema from "../schema";
import { calendars, eventOverrides, events } from "../schema";
import {
  restoreOccurrenceRecord,
  saveCalendarRecord,
  saveEventRecord,
  skipOccurrenceRecord,
  type Db,
} from "../mutations";

/**
 * Integration tests against a real SQLite file, migrated by the same script the
 * container entrypoint runs. That makes them a check on the migrations too:
 * if a generated migration stops matching the schema, these fail.
 */

const ZONE = "America/New_York";
const HOST = "schedule.nigel-smith.dev";

let dir: string;
let sqlite: Database.Database;
let db: Db;

const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
  const file = path.join(dir, "test.db");

  execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: file },
    stdio: "pipe",
  });

  sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });

  db.insert(calendars)
    .values({ id: "cal_1", slug: "work", name: "Work", accent: 1, isPublic: true, sortOrder: 0 })
    .run();
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseEvent(over: Partial<Parameters<typeof saveEventRecord>[1]> = {}) {
  return {
    calendarId: "cal_1",
    summary: "Standup",
    allDay: false,
    dtstart: at("2026-09-07T14:00"),
    dtend: at("2026-09-07T14:30"),
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    status: "CONFIRMED" as const,
    ...over,
  };
}

describe("migrations", () => {
  it("produce a schema the mutation layer can write to", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("calendars");
    expect(tables).toContain("events");
    expect(tables).toContain("event_overrides");
  });
});

describe("saveEventRecord — create", () => {
  it("inserts with sequence 0 and a UID on the configured host", () => {
    const result = saveEventRecord(db, baseEvent(), { host: HOST });
    expect(result.ok && result.created).toBe(true);

    const [row] = db.select().from(events).all();
    expect(row.sequence).toBe(0);
    expect(row.uid.endsWith(`@${HOST}`)).toBe(true);
  });
});

describe("saveEventRecord — update", () => {
  it("increments SEQUENCE so subscribers accept the change", () => {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";

    saveEventRecord(db, baseEvent({ id, summary: "Renamed" }), { host: HOST });

    const [row] = db.select().from(events).where(eq(events.id, id)).all();
    expect(row.summary).toBe("Renamed");
    expect(row.sequence).toBe(1);
  });

  it("never regenerates the UID", () => {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";
    const before = db.select().from(events).where(eq(events.id, id)).all()[0].uid;

    saveEventRecord(db, baseEvent({ id, summary: "Renamed" }), { host: HOST });

    const after = db.select().from(events).where(eq(events.id, id)).all()[0].uid;
    expect(after).toBe(before);
  });

  it("reports not_found for an id that no longer exists", () => {
    const result = saveEventRecord(db, baseEvent({ id: "evt_gone" }), { host: HOST });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("override invalidation", () => {
  function seedWithOverride() {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";

    db.insert(eventOverrides)
      .values({
        id: "ovr_1",
        eventId: id,
        recurrenceId: at("2026-09-14T14:00"),
        summary: "Moved",
        cancelled: false,
      })
      .run();

    skipOccurrenceRecord(db, id, at("2026-09-21T14:00"));
    return id;
  }

  it("keeps overrides when only cosmetic fields change", () => {
    const id = seedWithOverride();

    const result = saveEventRecord(db, baseEvent({ id, summary: "Renamed" }), { host: HOST });

    expect(result.ok && result.clearedOverrides).toBe(false);
    expect(db.select().from(eventOverrides).all()).toHaveLength(1);
    expect(db.select().from(events).all()[0].exdates).toHaveLength(1);
  });

  it("clears overrides when the series start moves", () => {
    const id = seedWithOverride();

    const result = saveEventRecord(
      db,
      baseEvent({ id, dtstart: at("2026-09-07T16:00"), dtend: at("2026-09-07T16:30") }),
      { host: HOST },
    );

    // The old overrides pointed at 14:00 slots that no longer exist.
    expect(result.ok && result.clearedOverrides).toBe(true);
    expect(db.select().from(eventOverrides).all()).toHaveLength(0);
    expect(db.select().from(events).all()[0].exdates).toBeNull();
  });

  it("clears overrides when the recurrence rule changes", () => {
    const id = seedWithOverride();

    const result = saveEventRecord(db, baseEvent({ id, rrule: "FREQ=DAILY" }), { host: HOST });

    expect(result.ok && result.clearedOverrides).toBe(true);
    expect(db.select().from(eventOverrides).all()).toHaveLength(0);
  });
});

describe("skip and restore", () => {
  it("adds and removes an EXDATE, bumping SEQUENCE each time", () => {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";
    const slot = at("2026-09-14T14:00");

    skipOccurrenceRecord(db, id, slot);
    let row = db.select().from(events).where(eq(events.id, id)).all()[0];
    expect(row.exdates).toEqual([slot]);
    expect(row.sequence).toBe(1);

    restoreOccurrenceRecord(db, id, slot);
    row = db.select().from(events).where(eq(events.id, id)).all()[0];
    expect(row.exdates).toBeNull();
    expect(row.sequence).toBe(2);
  });

  it("does not duplicate an already-skipped occurrence", () => {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";
    const slot = at("2026-09-14T14:00");

    skipOccurrenceRecord(db, id, slot);
    skipOccurrenceRecord(db, id, slot);

    expect(db.select().from(events).where(eq(events.id, id)).all()[0].exdates).toEqual([slot]);
  });

  it("drops a contradicting override when the same slot is skipped", () => {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";
    const slot = at("2026-09-14T14:00");

    db.insert(eventOverrides)
      .values({ id: "ovr_1", eventId: id, recurrenceId: slot, summary: "Moved", cancelled: false })
      .run();

    skipOccurrenceRecord(db, id, slot);

    expect(db.select().from(eventOverrides).all()).toHaveLength(0);
  });
});

describe("cascade", () => {
  it("deletes an event's overrides with the event", () => {
    const created = saveEventRecord(db, baseEvent(), { host: HOST });
    const id = created.ok ? created.id : "";

    db.insert(eventOverrides)
      .values({
        id: "ovr_1",
        eventId: id,
        recurrenceId: at("2026-09-14T14:00"),
        cancelled: false,
      })
      .run();

    db.delete(events).where(eq(events.id, id)).run();
    expect(db.select().from(eventOverrides).all()).toHaveLength(0);
  });

  it("deletes a calendar's events with the calendar", () => {
    saveEventRecord(db, baseEvent(), { host: HOST });
    db.delete(calendars).where(eq(calendars.id, "cal_1")).run();
    expect(db.select().from(events).all()).toHaveLength(0);
  });
});

describe("saveCalendarRecord", () => {
  it("refuses a slug already used by another calendar", () => {
    const result = saveCalendarRecord(db, {
      name: "Other",
      slug: "work",
      accent: 2,
      isPublic: true,
    });
    expect(result).toEqual({ ok: false, reason: "slug_taken" });
  });

  it("allows a calendar to keep its own slug on edit", () => {
    const result = saveCalendarRecord(db, {
      id: "cal_1",
      name: "Work renamed",
      slug: "work",
      accent: 2,
      isPublic: false,
    });

    expect(result.ok).toBe(true);
    const [row] = db.select().from(calendars).all();
    expect(row.name).toBe("Work renamed");
    expect(row.isPublic).toBe(false);
  });

  it("creates with an incrementing sort order", () => {
    saveCalendarRecord(db, { name: "Personal", slug: "personal", accent: 3, isPublic: true });
    const rows = db.select().from(calendars).all();
    expect(rows.map((r) => r.sortOrder).sort()).toEqual([0, 1]);
  });
});

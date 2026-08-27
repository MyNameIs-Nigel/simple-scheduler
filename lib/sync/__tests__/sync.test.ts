import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { calendars, events, type Calendar } from "@/db/schema";
import type { Db } from "@/db/mutations";
import { syncCalendarSource } from "../sync";

/**
 * Mirroring, against a real SQLite file migrated by the same script the
 * container entrypoint runs.
 *
 * The rules under test are the ones whose failure is invisible until a
 * subscriber complains: SEQUENCE churn, UID churn, and a broken source quietly
 * emptying a calendar.
 */

const ZONE = "America/New_York";
const HOST = "schedule.nigel-smith.dev";
const SOURCE = "https://example.com/shifts.ics";

let dir: string;
let sqlite: Database.Database;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-sync-"));
  const file = path.join(dir, "test.db");

  execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../../scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: file },
    stdio: "pipe",
  });

  sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });

  db.insert(calendars)
    .values({
      id: "cal_work",
      slug: "work",
      name: "Work shifts",
      accent: 1,
      isPublic: true,
      sortOrder: 0,
      sourceUrl: SOURCE,
    })
    .run();
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function calendar(): Calendar {
  const [row] = db.select().from(calendars).where(eq(calendars.id, "cal_work")).limit(1).all();
  return row;
}

function rows() {
  return db.select().from(events).where(eq(events.calendarId, "cal_work")).all();
}

type Shift = { uid?: string; summary: string; start: string; end: string };

function ics(shifts: Shift[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN"];
  for (const s of shifts) {
    lines.push("BEGIN:VEVENT");
    if (s.uid) lines.push(`UID:${s.uid}`);
    lines.push(`DTSTAMP:20260101T000000Z`);
    lines.push(`DTSTART:${s.start}`);
    lines.push(`DTEND:${s.end}`);
    lines.push(`SUMMARY:${s.summary}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** A stub fetch that answers with the given body, or 304 when told to. */
function stubFetch(body: string | null, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    body === null
      ? new Response(null, { status: 304 })
      : new Response(body, {
          status: 200,
          headers: { "content-type": "text/calendar", ...(init.headers ?? {}) },
        })) as unknown as typeof fetch;
}

const SHIFT_A: Shift = {
  uid: "shift-a@work",
  summary: "Shift — Warehouse",
  start: "20260302T140000Z",
  end: "20260302T220000Z",
};
const SHIFT_B: Shift = {
  uid: "shift-b@work",
  summary: "Shift — Front desk",
  start: "20260304T090000Z",
  end: "20260304T170000Z",
};

function sync(body: string | null, headers: Record<string, string> = {}) {
  return syncCalendarSource(db, calendar(), {
    zone: ZONE,
    host: HOST,
    fetchImpl: stubFetch(body, { headers }),
  });
}

describe("syncCalendarSource", () => {
  it("inserts every event on the first sync", async () => {
    const outcome = await sync(ics([SHIFT_A, SHIFT_B]));

    expect(outcome.ok).toBe(true);
    expect(outcome.created).toBe(2);
    expect(rows()).toHaveLength(2);
    expect(calendar().lastSyncStatus).toBe("ok");
    expect(calendar().lastSyncCount).toBe(2);
  });

  it("generates our own UID rather than echoing the source's", async () => {
    await sync(ics([SHIFT_A]));

    const [row] = rows();
    expect(row.sourceUid).toBe("shift-a@work");
    expect(row.uid).toMatch(/^evt_[\w-]+@schedule\.nigel-smith\.dev$/);
  });

  it("keeps the published UID byte-identical across repeated syncs", async () => {
    // The regression that matters: a churning UID reads to every subscriber as
    // the whole calendar being deleted and recreated on each poll.
    await sync(ics([SHIFT_A, SHIFT_B]));
    const first = rows().map((r) => r.uid).sort();

    await sync(ics([SHIFT_A, SHIFT_B]));
    await sync(ics([{ ...SHIFT_A, summary: "Shift — Warehouse (late)" }, SHIFT_B]));

    expect(rows().map((r) => r.uid).sort()).toEqual(first);
  });

  it("does not move SEQUENCE when nothing changed", async () => {
    await sync(ics([SHIFT_A]));
    const before = rows()[0];

    await sync(ics([SHIFT_A]));
    const after = rows()[0];

    expect(after.sequence).toBe(before.sequence);
    // updatedAt feeds DTSTAMP/LAST-MODIFIED, so holding it steady is what makes
    // the generated feed byte-identical and lets the ETag return a 304.
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("moves SEQUENCE exactly once for an event that changed upstream", async () => {
    await sync(ics([SHIFT_A, SHIFT_B]));
    const before = rows();

    const outcome = await sync(ics([{ ...SHIFT_A, start: "20260302T160000Z" }, SHIFT_B]));

    expect(outcome.resequenced).toBe(1);

    const after = rows();
    const changed = after.find((r) => r.sourceUid === "shift-a@work")!;
    const untouched = after.find((r) => r.sourceUid === "shift-b@work")!;

    expect(changed.sequence).toBe(before.find((r) => r.sourceUid === "shift-a@work")!.sequence + 1);
    expect(untouched.sequence).toBe(before.find((r) => r.sourceUid === "shift-b@work")!.sequence);
  });

  it("deletes an event that disappeared upstream", async () => {
    await sync(ics([SHIFT_A, SHIFT_B]));

    const outcome = await sync(ics([SHIFT_A]));

    expect(outcome.deleted).toBe(1);
    expect(rows().map((r) => r.sourceUid)).toEqual(["shift-a@work"]);
  });

  it("refuses to empty a populated calendar when the source parses to nothing", async () => {
    await sync(ics([SHIFT_A, SHIFT_B]));

    const outcome = await sync(ics([]));

    expect(outcome.ok).toBe(false);
    expect(rows()).toHaveLength(2);
    expect(calendar().lastSyncStatus).toBe("error");
  });

  it("removes hand-entered events left on a calendar that became a mirror", async () => {
    db.insert(events)
      .values({
        id: "evt_manual",
        calendarId: "cal_work",
        uid: `evt_manual@${HOST}`,
        summary: "Left over",
        dtstart: Date.UTC(2026, 2, 2, 19),
        dtend: Date.UTC(2026, 2, 2, 20),
        allDay: false,
        sequence: 0,
      })
      .run();

    const outcome = await sync(ics([SHIFT_A]));

    expect(outcome.deleted).toBe(1);
    expect(rows().map((r) => r.sourceUid)).toEqual(["shift-a@work"]);
  });

  it("matches UID-less events on their content so a re-sync is not a churn", async () => {
    const noUid = [
      { summary: SHIFT_A.summary, start: SHIFT_A.start, end: SHIFT_A.end },
      { summary: SHIFT_B.summary, start: SHIFT_B.start, end: SHIFT_B.end },
    ];

    await sync(ics(noUid));
    const first = rows().map((r) => r.uid).sort();

    const outcome = await sync(ics(noUid));

    expect(outcome.created).toBe(0);
    expect(outcome.deleted).toBe(0);
    expect(rows().map((r) => r.uid).sort()).toEqual(first);
  });

  it("treats 304 as a no-op but still stamps the sync time", async () => {
    await sync(ics([SHIFT_A]), { etag: '"v1"' });
    expect(calendar().sourceEtag).toBe('"v1"');

    const outcome = await sync(null);

    expect(outcome.notModified).toBe(true);
    expect(outcome.created).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(calendar().lastSyncedAt).not.toBeNull();
  });

  it("records a fetch failure without touching the mirrored events", async () => {
    await sync(ics([SHIFT_A]));

    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const outcome = await syncCalendarSource(db, calendar(), {
      zone: ZONE,
      host: HOST,
      fetchImpl: failing,
    });

    expect(outcome.ok).toBe(false);
    expect(rows()).toHaveLength(1);
    expect(calendar().lastSyncStatus).toBe("error");
    expect(calendar().lastSyncError).toContain("503");
  });

  it("stamps the attempt time on failure so a dead source backs off", async () => {
    // Without this the calendar stays permanently "due" and the runner retries
    // it on every 60s tick instead of on its own interval.
    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;

    await syncCalendarSource(db, calendar(), { zone: ZONE, host: HOST, fetchImpl: failing });

    expect(calendar().lastSyncedAt).not.toBeNull();
  });

  it("keeps the last good event count visible through a failure", async () => {
    await sync(ics([SHIFT_A, SHIFT_B]));

    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await syncCalendarSource(db, calendar(), { zone: ZONE, host: HOST, fetchImpl: failing });

    expect(calendar().lastSyncCount).toBe(2);
    expect(rows()).toHaveLength(2);
  });

  it("stores the response validators so the next poll can be conditional", async () => {
    await sync(ics([SHIFT_A]), { etag: '"abc"', "last-modified": "Mon, 02 Mar 2026 10:00:00 GMT" });

    expect(calendar().sourceEtag).toBe('"abc"');
    expect(calendar().sourceLastModified).toBe("Mon, 02 Mar 2026 10:00:00 GMT");
  });

  it("does nothing for a calendar with no subscription URL", async () => {
    db.update(calendars).set({ sourceUrl: null }).where(eq(calendars.id, "cal_work")).run();

    const outcome = await sync(ics([SHIFT_A]));

    expect(outcome.created).toBe(0);
    expect(rows()).toHaveLength(0);
  });
});

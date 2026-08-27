import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Feed slug resolution, end to end through the real database and the real .ics
 * writer.
 *
 * `db/index.ts` reads DATABASE_PATH once at module load, so everything here is
 * imported dynamically after the environment is set up — a static import would
 * bind the singleton to the developer's own scheduler.db.
 */

const ZONE = "America/New_York";
const SITE = "https://schedule.nigel-smith.dev";

let dir: string;
let buildFeed: typeof import("../build").buildFeed;
let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let saveFeedRecord: typeof import("@/db/mutations").saveFeedRecord;
let isSlugAvailable: typeof import("@/db/mutations").isSlugAvailable;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-feeds-"));
  const file = path.join(dir, "test.db");

  execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../../scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: file },
    stdio: "pipe",
  });

  process.env.DATABASE_PATH = file;
  process.env.SITE_URL = SITE;
  process.env.SCHEDULER_TIMEZONE = ZONE;

  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  ({ buildFeed } = await import("../build"));
  ({ saveFeedRecord, isSlugAvailable } = await import("@/db/mutations"));

  const { calendars, events } = schema;

  db.insert(calendars)
    .values([
      // Hidden from the public site, but published through the feed below —
      // the case the whole feature exists for.
      {
        id: "cal_shifts",
        slug: "work-shifts",
        name: "Work shifts",
        accent: 2,
        isPublic: false,
        sortOrder: 0,
        sourceUrl: "https://example.com/shifts.ics",
      },
      { id: "cal_meet", slug: "meetings", name: "Meetings", accent: 1, isPublic: true, sortOrder: 1 },
      { id: "cal_priv", slug: "private", name: "Private", accent: 3, isPublic: false, sortOrder: 2 },
    ])
    .run();

  db.insert(events)
    .values([
      {
        id: "evt_shift",
        calendarId: "cal_shifts",
        uid: `evt_shift@schedule.nigel-smith.dev`,
        sourceUid: "shift-a@work",
        summary: "Shift — Warehouse",
        dtstart: Date.UTC(2026, 2, 2, 19),
        dtend: Date.UTC(2026, 2, 3, 3),
        allDay: false,
        sequence: 0,
      },
      {
        id: "evt_standup",
        calendarId: "cal_meet",
        uid: `evt_standup@schedule.nigel-smith.dev`,
        summary: "Team standup",
        dtstart: Date.UTC(2026, 2, 3, 14),
        dtend: Date.UTC(2026, 2, 3, 14, 30),
        allDay: false,
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        sequence: 0,
      },
      {
        id: "evt_secret",
        calendarId: "cal_priv",
        uid: `evt_secret@schedule.nigel-smith.dev`,
        summary: "Not for publication",
        dtstart: Date.UTC(2026, 2, 4, 14),
        dtend: Date.UTC(2026, 2, 4, 15),
        allDay: false,
        sequence: 0,
      },
    ])
    .run();

  saveFeedRecord(db, {
    slug: "work-combined",
    name: "Work Schedule",
    isPublic: true,
    calendarIds: ["cal_shifts", "cal_meet"],
  });

  saveFeedRecord(db, {
    slug: "draft",
    name: "Draft",
    isPublic: false,
    calendarIds: ["cal_meet"],
  });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildFeed — published feeds", () => {
  it("merges every member calendar into one feed", async () => {
    const feed = await buildFeed("work-combined.ics");

    expect(feed).not.toBeNull();
    expect(feed!.body).toContain("Shift — Warehouse");
    expect(feed!.body).toContain("Team standup");
  });

  it("publishes a calendar the public site hides", async () => {
    // cal_shifts is isPublic: false, and appears here only because the feed
    // names it explicitly. Membership is the authority, not the calendar flag.
    const direct = await buildFeed("work-shifts.ics");
    expect(direct).toBeNull();

    const viaFeed = await buildFeed("work-combined.ics");
    expect(viaFeed!.body).toContain("Shift — Warehouse");
  });

  it("does not leak a calendar that is not a member", async () => {
    const feed = await buildFeed("work-combined.ics");
    expect(feed!.body).not.toContain("Not for publication");
  });

  it("names the calendar after the feed", async () => {
    const feed = await buildFeed("work-combined.ics");

    expect(feed!.calendarName).toBe("Nigel Smith — Work Schedule");
    expect(feed!.body).toContain("X-WR-CALNAME:Nigel Smith — Work Schedule");
    // One VTIMEZONE and one name, however many calendars were merged.
    expect(feed!.body.match(/X-WR-CALNAME/g)).toHaveLength(1);
    expect(feed!.body.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
  });

  it("carries the recurrence and the timezone through the merge", async () => {
    const feed = await buildFeed("work-combined.ics");

    expect(feed!.body).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(feed!.body).toContain(`TZID:${ZONE}`);
  });

  it("points the feed URL at itself", async () => {
    const feed = await buildFeed("work-combined.ics");
    expect(feed!.body).toContain(`${SITE}/calendars/work-combined.ics`);
  });

  it("404s a feed that is not public", async () => {
    expect(await buildFeed("draft.ics")).toBeNull();
  });

  it("404s an unknown slug", async () => {
    expect(await buildFeed("nope.ics")).toBeNull();
  });

  it("still serves a plain calendar slug and the combined feed", async () => {
    const meetings = await buildFeed("meetings.ics");
    expect(meetings!.body).toContain("Team standup");
    expect(meetings!.body).not.toContain("Shift — Warehouse");

    // all.ics is every *public* calendar, so the hidden mirror stays out of it.
    const all = await buildFeed("all.ics");
    expect(all!.body).toContain("Team standup");
    expect(all!.body).not.toContain("Shift — Warehouse");
  });

  it("changes the ETag when a member calendar's events change", async () => {
    const before = (await buildFeed("work-combined.ics"))!.etag;

    const { events } = schema;
    db.update(events)
      .set({ summary: "Shift — Front desk", sequence: 1 })
      .where(eq(events.id, "evt_shift"))
      .run();

    expect((await buildFeed("work-combined.ics"))!.etag).not.toBe(before);
  });
});

describe("slug namespace", () => {
  it("refuses a feed slug that a calendar already uses", () => {
    const result = saveFeedRecord(db, {
      slug: "meetings",
      name: "Clash",
      isPublic: true,
      calendarIds: ["cal_meet"],
    });
    expect(result).toEqual({ ok: false, reason: "slug_taken" });
  });

  it("refuses a calendar slug that a feed already uses", () => {
    expect(isSlugAvailable(db, "work-combined")).toBe(false);
  });

  it("refuses the reserved combined-feed slug", () => {
    expect(isSlugAvailable(db, "all")).toBe(false);
  });

  it("lets a feed keep its own slug when edited", () => {
    expect(isSlugAvailable(db, "work-combined", { feedId: "x" })).toBe(false);

    const [feed] = db
      .select()
      .from(schema.publishedFeeds)
      .where(eq(schema.publishedFeeds.slug, "work-combined"))
      .all();
    expect(isSlugAvailable(db, "work-combined", { feedId: feed.id })).toBe(true);
  });

  it("refuses a feed with no calendars", () => {
    const result = saveFeedRecord(db, {
      slug: "empty",
      name: "Empty",
      isPublic: true,
      calendarIds: [],
    });
    expect(result).toEqual({ ok: false, reason: "no_calendars" });
  });
});

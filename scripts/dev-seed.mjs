/** Sample data for local development. Not run in production. */
import Database from "better-sqlite3";
import { DateTime } from "luxon";

const ZONE = process.env.SCHEDULER_TIMEZONE || "America/New_York";
const sqlite = new Database(process.env.DATABASE_PATH || "./data/scheduler.db");
sqlite.pragma("foreign_keys = ON");

const at = (iso) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
const now = Date.now();
const monday = DateTime.now().setZone(ZONE).startOf("week");
const d = (days, time) => at(`${monday.plus({ days }).toFormat("yyyy-MM-dd")}T${time}`);

sqlite.prepare("DELETE FROM events").run();
sqlite.prepare("DELETE FROM calendars WHERE id != 'cal_default_personal'").run();

const cal = sqlite.prepare(
  `INSERT OR REPLACE INTO calendars (id, slug, name, description, accent, is_public, sort_order, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
);
cal.run("cal_default_personal", "personal", "Personal", "Personal commitments.", 1, 1, 0, now, now);
cal.run("cal_work", "work", "Work", "Work and client time.", 4, 1, 1, now, now);
cal.run("cal_study", "study", "Study", "Certs and coursework.", 3, 1, 2, now, now);
cal.run("cal_private", "private", "Private", "Hidden from the public feed.", 2, 0, 3, now, now);

const ins = sqlite.prepare(
  `INSERT INTO events (id, calendar_id, uid, summary, description, location, url, dtstart, dtend, all_day, rrule, exdates, status, sequence, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);

const rows = [
  ["e1", "cal_work", "Standup", "Daily sync with the team.", "Google Meet", d(0, "09:30"), d(0, "09:45"), 0, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
  ["e2", "cal_work", "Client review", null, "Remote", d(2, "14:00"), d(2, "15:00"), 0, null],
  ["e3", "cal_default_personal", "Gym", null, null, d(1, "18:00"), d(1, "19:00"), 0, "FREQ=WEEKLY;BYDAY=TU,TH"],
  ["e4", "cal_study", "AWS SAA revision", "Chapter 7 - VPC peering.", null, d(3, "20:00"), d(3, "21:30"), 0, "FREQ=WEEKLY;BYDAY=TH;COUNT=8"],
  ["e5", "cal_default_personal", "Dentist", null, "Main St", d(4, "11:00"), d(4, "11:45"), 0, null],
  ["e6", "cal_default_personal", "Long weekend", "Away.", null, d(12, "00:00"), d(15, "00:00"), 1, null],
  ["e7", "cal_private", "Private appointment", null, null, d(2, "16:00"), d(2, "17:00"), 0, null],
];

for (const [id, calId, summary, desc, loc, start, end, allDay, rrule] of rows) {
  ins.run(id, calId, `${id}@localhost`, summary, desc, loc, null, start, end, allDay, rrule, null, "CONFIRMED", 0, now, now);
}

// One occurrence of the standup moved, and one skipped, to exercise overrides.
sqlite.prepare("UPDATE events SET exdates = ? WHERE id = 'e1'").run(JSON.stringify([d(2, "09:30")]));
sqlite
  .prepare(
    `INSERT OR REPLACE INTO event_overrides (id, event_id, recurrence_id, summary, description, location, dtstart, dtend, cancelled, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  .run("o1", "e1", d(3, "09:30"), "Standup (late start)", null, null, d(3, "10:30"), d(3, "10:45"), 0, now, now);

console.log(`[dev-seed] ${rows.length} events across 4 calendars, week of ${monday.toFormat("yyyy-MM-dd")}`);
sqlite.close();

/**
 * Creates a default calendar so a fresh install has somewhere to put an event.
 * Idempotent — re-running is a no-op.
 */
import Database from "better-sqlite3";

const file = process.env.DATABASE_PATH || "./data/scheduler.db";
const sqlite = new Database(file);
sqlite.pragma("foreign_keys = ON");

const existing = sqlite.prepare("SELECT COUNT(*) AS n FROM calendars").get();
if (existing.n > 0) {
  console.log(`[seed] ${existing.n} calendar(s) already present — nothing to do.`);
} else {
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO calendars (id, slug, name, description, accent, is_public, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "cal_default_personal",
      "personal",
      "Personal",
      "Default calendar.",
      1,
      1,
      0,
      now,
      now,
    );
  console.log("[seed] created default calendar: personal");
}

sqlite.close();

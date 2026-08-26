import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/**
 * Single shared connection. `next dev` re-evaluates modules on every edit, so
 * the handle is parked on globalThis to avoid opening a new SQLite connection
 * (and leaking file descriptors) on each hot reload.
 */
const globalForDb = globalThis as unknown as {
  __schedulerDb?: ReturnType<typeof createDb>;
};

function createDb() {
  const file = process.env.DATABASE_PATH || "./data/scheduler.db";
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

  const sqlite = new Database(file);
  // WAL lets the public read path proceed while an admin write is in flight.
  sqlite.pragma("journal_mode = WAL");
  // Off by default in SQLite; required for our ON DELETE CASCADE to fire.
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__schedulerDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__schedulerDb = db;
}

export { schema };

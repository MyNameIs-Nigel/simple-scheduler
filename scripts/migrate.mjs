/**
 * Applies pending migrations, then exits. Run by the Docker entrypoint before
 * the server starts, and by `pnpm db:migrate` locally.
 *
 * Deliberately a standalone script rather than an instrumentation hook: a
 * failed migration should stop the container from starting at all, not surface
 * as a 500 on the first request.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const file = process.env.DATABASE_PATH || "./data/scheduler.db";
const migrationsFolder = path.resolve(import.meta.dirname, "../db/migrations");

fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

try {
  migrate(drizzle(sqlite), { migrationsFolder });
  console.log(`[migrate] up to date: ${path.resolve(file)}`);
} catch (error) {
  console.error("[migrate] failed:", error);
  process.exit(1);
} finally {
  sqlite.close();
}

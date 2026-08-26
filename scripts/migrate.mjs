/**
 * Applies pending migrations, then exits. Run by the Docker entrypoint before
 * the server starts, and by `pnpm db:migrate` locally.
 *
 * Deliberately a standalone script rather than an instrumentation hook: a
 * failed migration should stop the container from starting at all, not surface
 * as a 500 on the first request.
 *
 * It depends on better-sqlite3 only, not drizzle-orm. `next build --output
 * standalone` traces the app's own imports, and drizzle-orm is bundled into the
 * server chunks rather than left in node_modules — so it is simply not present
 * at runtime, while better-sqlite3 is (it is in serverExternalPackages).
 * Rather than fatten the image to get the drizzle migrator back, this
 * reimplements the same contract:
 *
 *   - the journal at db/migrations/meta/_journal.json lists migrations in order
 *   - applied ones are recorded in __drizzle_migrations, keyed by the sha256 of
 *     the .sql file's contents
 *   - statements within a file are separated by `--> statement-breakpoint`
 *
 * That is exactly what drizzle's own migrator does, verified against a database
 * it had already migrated, so the two stay interchangeable.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const file = process.env.DATABASE_PATH || "./data/scheduler.db";
const migrationsFolder = path.resolve(import.meta.dirname, "../db/migrations");
const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

if (!fs.existsSync(journalPath)) {
  console.error(`[migrate] no journal at ${journalPath}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric
			)`);

  const applied = new Set(
    sqlite.prepare(`SELECT hash FROM "__drizzle_migrations"`).all().map((r) => r.hash),
  );

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);

  const record = sqlite.prepare(
    `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
  );

  let count = 0;

  for (const entry of entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`journal references ${entry.tag}.sql, which does not exist`);
    }

    const sql = fs.readFileSync(sqlPath, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    if (applied.has(hash)) continue;

    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    // One transaction per migration: a failure rolls that file back whole,
    // rather than leaving a half-applied schema behind.
    sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement);
      record.run(hash, entry.when ?? Date.now());
    })();

    console.log(`[migrate] applied ${entry.tag}`);
    count += 1;
  }

  console.log(
    count === 0
      ? `[migrate] up to date: ${path.resolve(file)}`
      : `[migrate] applied ${count} migration(s): ${path.resolve(file)}`,
  );
} catch (error) {
  console.error("[migrate] failed:", error);
  process.exit(1);
} finally {
  sqlite.close();
}

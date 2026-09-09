import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Setup files run before test imports, so even routes that import the shared
// database at module scope cannot open the developer's database. Each test
// file gets its own database, including when Vitest runs files in parallel.
const originalPath = process.env.DATABASE_PATH;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");

execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/migrate.mjs")], {
  env: process.env,
  stdio: "pipe",
});

const { db } = await import("@/db");

afterAll(() => {
  db.$client.close();
  fs.rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalPath;
});

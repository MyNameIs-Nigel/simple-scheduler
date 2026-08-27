import "server-only";

import { eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { calendars, type Calendar } from "@/db/schema";
import { siteUrl, syncEnabled, syncIntervalMs, timezone } from "@/lib/env";
import { syncCalendarSource, type SyncOutcome } from "./sync";

/**
 * The background poller that keeps subscribed calendars mirrored.
 *
 * Started from instrumentation.ts when the server boots. This is correct for a
 * single-container deployment and only that: the timer lives in the server
 * process, so scaling to more than one instance would have every instance
 * polling every source.
 */

/** Wait before the first run so it never competes with the server coming up. */
const INITIAL_DELAY_MS = 10_000;

/** How often we look for due calendars. The per-calendar interval is what actually gates a fetch. */
const TICK_MS = 60_000;

const SCHEDULER_KEY = Symbol.for("simple-scheduler.sync-scheduler");

type SchedulerGlobal = typeof globalThis & {
  [SCHEDULER_KEY]?: { started: boolean; running: boolean };
};

function state() {
  const g = globalThis as SchedulerGlobal;
  g[SCHEDULER_KEY] ??= { started: false, running: false };
  return g[SCHEDULER_KEY];
}

function host(): string {
  try {
    return new URL(siteUrl()).host;
  } catch {
    return "localhost";
  }
}

/** True when the calendar has never synced or its interval has elapsed. */
function isDue(calendar: Calendar, now: number, intervalMs: number): boolean {
  if (!calendar.sourceUrl) return false;
  if (calendar.lastSyncedAt === null) return true;
  return now - calendar.lastSyncedAt >= intervalMs;
}

/**
 * Syncs every subscribed calendar whose interval has elapsed.
 *
 * Serial by design: these are a handful of calendars polled twice an hour, and
 * running them one at a time keeps each `db.transaction` clear of the others.
 */
export async function syncDueSources(opts: { force?: boolean } = {}): Promise<SyncOutcome[]> {
  const now = Date.now();
  const intervalMs = syncIntervalMs();
  const zone = timezone();
  const hostname = host();

  const subscribed = await db
    .select()
    .from(calendars)
    .where(isNotNull(calendars.sourceUrl));

  const due = opts.force ? subscribed : subscribed.filter((c) => isDue(c, now, intervalMs));
  const outcomes: SyncOutcome[] = [];

  for (const calendar of due) {
    try {
      const outcome = await syncCalendarSource(db, calendar, { zone, host: hostname });
      outcomes.push(outcome);

      if (!outcome.notModified) {
        console.log(`[sync] ${calendar.slug}: ${outcome.message}`);
      }
    } catch (error) {
      // One unreachable or malformed source must not stop the others. The
      // sync itself records its own failures; this only catches the unexpected.
      console.error(`[sync] ${calendar.slug} failed:`, error);
      outcomes.push({
        ok: false,
        created: 0,
        updated: 0,
        deleted: 0,
        resequenced: 0,
        skippedOverrides: 0,
        message: (error as Error).message,
      });
    }
  }

  return outcomes;
}

/** Syncs one calendar immediately, ignoring its interval. Used by the admin button. */
export async function syncCalendarById(id: string): Promise<SyncOutcome | null> {
  const [calendar] = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1);
  if (!calendar || !calendar.sourceUrl) return null;

  return syncCalendarSource(db, calendar, { zone: timezone(), host: host() });
}

/**
 * Starts the poll loop. Safe to call more than once.
 *
 * Returns without scheduling anything during `next build` — the build imports
 * instrumentation but never serves a request, and a build that opened the
 * database and started fetching remote URLs would be a surprising thing indeed.
 */
export function startSyncScheduler(): void {
  if (!syncEnabled()) {
    console.log("[sync] disabled by SYNC_ENABLED=false");
    return;
  }

  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // `next dev` re-evaluates modules on edit; without this every hot reload
  // would leave another timer behind.
  const s = state();
  if (s.started) return;
  s.started = true;

  const tick = async () => {
    // A slow source must not let the next tick start a second overlapping pass.
    if (s.running) return;
    s.running = true;
    try {
      await syncDueSources();
    } catch (error) {
      console.error("[sync] tick failed:", error);
    } finally {
      s.running = false;
    }
  };

  // unref so a pending timer never keeps the process alive on shutdown.
  setTimeout(tick, INITIAL_DELAY_MS).unref();
  setInterval(tick, TICK_MS).unref();

  console.log(
    `[sync] scheduler started — sources refresh every ${syncIntervalMs() / 60_000} min`,
  );
}

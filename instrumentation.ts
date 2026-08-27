/**
 * Starts the subscription poller when the server boots.
 *
 * `register()` has to finish before the server accepts requests, so this only
 * *schedules* — the first sync runs on a timer a few seconds later. Awaiting a
 * network fetch here would delay every deploy by however long the slowest
 * remote calendar takes to answer.
 *
 * The import is dynamic so better-sqlite3 stays out of the module graph
 * whenever the runtime guard fails.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startSyncScheduler } = await import("@/lib/sync/runner");
  startSyncScheduler();
}

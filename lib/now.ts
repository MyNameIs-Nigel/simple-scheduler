import "server-only";

import { connection } from "next/server";

/**
 * Request-time clock.
 *
 * Reading `Date.now()` directly in a component body breaks React's purity rule:
 * a render must be idempotent, and the linter rightly flags it. `connection()`
 * is Next 16's way to say "this value comes from the request" — it halts
 * prerendering, so the clock is read once per request rather than baked in at
 * build time.
 *
 * The same applies to our synchronous better-sqlite3 reads, which the Next docs
 * call out explicitly: without this they would otherwise run during prerender.
 */
export async function requestNow(): Promise<number> {
  await connection();
  return Date.now();
}

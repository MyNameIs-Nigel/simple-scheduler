import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { isAdminEmail } from "@/lib/env";
import { getSession, type SessionPayload } from "./session";

/**
 * The Data Access Layer — the *primary* authorisation boundary.
 *
 * `proxy.ts` also redirects unauthenticated traffic away from /admin, but that
 * is an optimistic UX check only: it runs on prefetches and never verifies the
 * signature. Per Next's own auth guide, proxy "should not be your only line of
 * defense", and Server Actions are reachable by direct POST regardless of what
 * the UI renders. So every admin page and every action calls `requireAdmin()`.
 */

/** React `cache` dedupes this across a single render pass. */
export const verifySession = cache(async (): Promise<SessionPayload | null> => {
  const session = await getSession();
  if (!session) return null;
  // A validly-signed cookie for a non-admin address is still not authorised —
  // e.g. if ADMIN_EMAIL changed after the cookie was issued.
  if (!isAdminEmail(session.email)) return null;
  return session;
});

/** Redirects to /login when there is no valid admin session. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session) redirect("/login");
  return session;
}

/** Non-redirecting variant, for rendering "Sign in" vs "Admin" in the nav. */
export async function optionalAdmin(): Promise<SessionPayload | null> {
  return verifySession();
}

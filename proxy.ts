import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. It runs on the Node.js
 * runtime and that is not configurable.
 *
 * This is an OPTIMISTIC UX redirect, not a security boundary. It only checks
 * that a session cookie is *present* — it does not verify the signature and it
 * never touches the database, because proxy runs on prefetches too.
 *
 * Real authorisation lives in `lib/auth/dal.ts` (`requireAdmin()`), which every
 * admin page and every Server Action calls. Do not move it here.
 */
export function proxy(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnTo", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: "/admin/:path*",
};

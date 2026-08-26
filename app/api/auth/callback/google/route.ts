import { NextResponse, type NextRequest } from "next/server";

import { exchangeCode } from "@/lib/auth/google";
import { isAdminEmail, siteUrl } from "@/lib/env";
import { createSession, takeOAuthState } from "@/lib/auth/session";

function denied(reason: string) {
  return NextResponse.redirect(`${siteUrl()}/login?error=${encodeURIComponent(reason)}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  if (params.get("error")) return denied(params.get("error") ?? "cancelled");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return denied("missing_code");

  // takeOAuthState clears the cookie, so a replayed callback cannot re-verify.
  const stored = await takeOAuthState();
  if (!stored) return denied("expired");
  if (stored.state !== state) return denied("state_mismatch");

  let identity;
  try {
    identity = await exchangeCode(code, stored.verifier);
  } catch (error) {
    console.error("[auth] Google code exchange failed:", error);
    return denied("exchange_failed");
  }

  if (!identity.emailVerified) return denied("email_unverified");

  // The single authorisation check. A non-admin gets no session cookie at all.
  if (!isAdminEmail(identity.email)) {
    console.warn(`[auth] rejected sign-in for non-admin address: ${identity.email}`);
    return denied("not_authorized");
  }

  await createSession({
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
  });

  return NextResponse.redirect(`${siteUrl()}${stored.returnTo}`);
}

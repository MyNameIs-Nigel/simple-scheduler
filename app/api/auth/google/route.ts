import { NextResponse, type NextRequest } from "next/server";

import { authorizationUrl, codeChallenge, randomToken } from "@/lib/auth/google";
import { setOAuthState } from "@/lib/auth/session";

/** Starts the Google OAuth handshake. */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("returnTo");
  // Only same-site paths — never reflect an absolute URL into a redirect.
  const returnTo = requested && requested.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/admin";

  const state = randomToken();
  const verifier = randomToken(64);
  await setOAuthState({ state, verifier, returnTo });

  return NextResponse.redirect(
    authorizationUrl({ state, challenge: await codeChallenge(verifier) }),
  );
}

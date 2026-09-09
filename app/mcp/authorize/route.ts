import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { mcpEnabled, siteUrl } from "@/lib/env";
import { createAuthorizationCode, getMcpClient } from "@/lib/mcp/oauth";

export async function GET(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const scope = params.get("scope") || "schedule:read";

  if (!clientId || !redirectUri) {
    return new NextResponse("Missing client_id or redirect_uri", { status: 400 });
  }

  const client = await getMcpClient(clientId);
  if (!client) {
    return new NextResponse("Client not found", { status: 400 });
  }

  if (!client.redirectUris.includes(redirectUri)) {
    return new NextResponse("redirect_uri mismatch", { status: 400 });
  }

  if (responseType !== "code") {
    const errorUrl = new URL(redirectUri);
    errorUrl.searchParams.set("error", "unsupported_response_type");
    if (state) errorUrl.searchParams.set("state", state);
    return NextResponse.redirect(errorUrl);
  }

  if (!codeChallenge || codeChallengeMethod !== "S256") {
    const errorUrl = new URL(redirectUri);
    errorUrl.searchParams.set("error", "invalid_request");
    errorUrl.searchParams.set("error_description", "PKCE with S256 code_challenge is required");
    if (state) errorUrl.searchParams.set("state", state);
    return NextResponse.redirect(errorUrl);
  }

  // Check if admin is authenticated via existing Google flow
  const session = await verifySession();
  if (!session) {
    // Redirect to login, preserving full authorize URL to return after sign in
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    const loginUrl = new URL("/login", siteUrl());
    loginUrl.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(loginUrl);
  }

  // Issue single-use authorization code
  const code = await createAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
  });

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) {
    callbackUrl.searchParams.set("state", state);
  }

  return NextResponse.redirect(callbackUrl);
}

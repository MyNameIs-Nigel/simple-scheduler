import { NextResponse } from "next/server";
import { mcpEnabled, siteUrl } from "@/lib/env";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 * Tells clients (Claude) where the authorize, token, registration, and revocation endpoints live.
 */
export async function GET() {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const base = siteUrl();
  const metadata = {
    issuer: base,
    authorization_endpoint: `${base}/mcp/authorize`,
    token_endpoint: `${base}/mcp/token`,
    registration_endpoint: `${base}/mcp/register`,
    revocation_endpoint: `${base}/mcp/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["schedule:read", "schedule:write"],
    service_documentation: `${base}/docs/mcp`,
  };

  return NextResponse.json(metadata, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

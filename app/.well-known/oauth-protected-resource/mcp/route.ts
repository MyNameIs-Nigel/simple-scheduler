import { NextResponse } from "next/server";
import { mcpEnabled, siteUrl } from "@/lib/env";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9704 / draft-ietf-oauth-resource-metadata).
 * Advertises the authorization servers that can issue tokens for this resource.
 */
export async function GET() {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const base = siteUrl();
  const metadata = {
    // Exact match to connector URL character-for-character
    resource: `${base}/mcp`,
    // Authorization server(s) capable of issuing tokens for this resource
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}/docs/mcp`,
  };

  return NextResponse.json(metadata, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

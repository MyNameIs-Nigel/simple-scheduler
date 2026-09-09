import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled, siteUrl } from "@/lib/env";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9704).
 * Claude looks at /.well-known/oauth-protected-resource when probing resource metadata.
 */
export async function GET(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const base = siteUrl();
  const metadata = {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["schedule:read", "schedule:write"],
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

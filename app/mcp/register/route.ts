import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled } from "@/lib/env";
import { isAllowedRedirectUri, pruneExpiredOAuthData, registerMcpClient } from "@/lib/mcp/oauth";
import { checkRateLimit } from "@/lib/mcp/hardening";

export async function POST(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Rate limiting: 10 registrations per IP per hour
  const ip = request.headers.get("x-forwarded-for") || "unknown_ip";
  const rateLimit = checkRateLimit(`dcr_${ip}`, 10, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "slow_down",
        error_description: "Too many registration attempts. Please try again later.",
      },
      { status: 429 },
    );
  }

  // Opportunistic cleanup of expired codes
  pruneExpiredOAuthData().catch(() => {});

  let body: {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const { client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method } =
    body;

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris must be a non-empty array",
      },
      { status: 400 },
    );
  }

  // Validate redirect URIs
  for (const uri of redirect_uris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      return NextResponse.json(
        {
          error: "invalid_redirect_uri",
          error_description: `Redirect URI not allowed: ${uri}`,
        },
        { status: 400 },
      );
    }
  }

  const client = await registerMcpClient({
    clientName: client_name,
    redirectUris: redirect_uris,
    grantTypes: grant_types,
    responseTypes: response_types,
    tokenEndpointAuthMethod: token_endpoint_auth_method,
  });

  // RFC 7591 OAuth 2.0 Dynamic Client Registration Response
  return NextResponse.json(
    {
      client_id: client.id,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

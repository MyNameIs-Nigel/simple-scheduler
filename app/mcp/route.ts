import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled, siteUrl } from "@/lib/env";

/**
 * Validates Origin header per MCP Streamable HTTP specification.
 * If Origin is present:
 * - Allow localhost/127.0.0.1 in development
 * - Allow Anthropic domains (claude.ai, claude.com, anthropic.com)
 * - Allow same-origin (SITE_URL)
 * Returns true if valid, false if rejected.
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // Direct non-browser clients (Claude Code, curl, etc.) don't send Origin

  try {
    const parsed = new URL(origin);
    const site = new URL(siteUrl());
    if (parsed.origin === site.origin) return true;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost")
    ) {
      return true;
    }

    if (
      hostname === "claude.ai" ||
      hostname.endsWith(".claude.ai") ||
      hostname === "claude.com" ||
      hostname.endsWith(".claude.com") ||
      hostname === "anthropic.com" ||
      hostname.endsWith(".anthropic.com")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Builds the standard 401 Unauthorized response with WWW-Authenticate header
 * pointing at protected resource metadata.
 */
export function buildMcpUnauthorizedResponse(): NextResponse {
  const base = siteUrl();
  const metadataUrl = `${base}/.well-known/oauth-protected-resource`;
  return new NextResponse(
    JSON.stringify({
      error: "unauthorized",
      message: "Authorization required. See WWW-Authenticate header for OAuth metadata.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="${base}/mcp", resource_metadata="${metadataUrl}"`,
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return new NextResponse("Forbidden: Invalid Origin", {
      status: 403,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return buildMcpUnauthorizedResponse();
  }

  // In Phase 0, no tokens are valid yet: returns 401
  return buildMcpUnauthorizedResponse();
}

export async function OPTIONS(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Origin",
    },
  });
}

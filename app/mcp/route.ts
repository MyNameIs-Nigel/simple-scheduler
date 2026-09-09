import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled, siteUrl } from "@/lib/env";
import { verifyMcpAccessToken } from "@/lib/mcp/oauth";
import {
  executeGetAgenda,
  executeGetEvent,
  executeListCalendars,
  MCP_TOOLS,
} from "@/lib/mcp/tools";

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

  const token = authHeader.substring("Bearer ".length).trim();
  const verified = await verifyMcpAccessToken(token);
  if (!verified) {
    return buildMcpUnauthorizedResponse();
  }

  // Parse JSON-RPC MCP request
  let rpcBody: any;
  try {
    rpcBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 },
    );
  }

  const { method, params, id } = rpcBody;

  // Handle standard MCP methods
  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          prompts: {},
        },
        serverInfo: {
          name: "simple-scheduler",
          version: "1.0.0",
        },
      },
    });
  }

  if (method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS,
      },
    });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    try {
      let resultText = "";
      if (toolName === "ping") {
        resultText = "pong";
      } else if (toolName === "list_calendars") {
        resultText = await executeListCalendars(args);
      } else if (toolName === "get_agenda") {
        resultText = await executeGetAgenda(args);
      } else if (toolName === "get_event") {
        resultText = await executeGetEvent(args);
      } else {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool '${toolName}' not found or not implemented`,
          },
        });
      }

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: resultText,
            },
          ],
        },
      });
    } catch (err: any) {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing tool: ${err?.message || "Unknown error"}`,
            },
          ],
        },
      });
    }
  }

  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Unknown method '${method}'`,
    },
  });
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

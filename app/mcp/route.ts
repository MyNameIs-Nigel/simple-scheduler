import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled, siteUrl } from "@/lib/env";
import { verifyMcpAccessToken } from "@/lib/mcp/oauth";
import {
  executeCheckConflicts,
  executeCreateEvent,
  executeDeleteEvent,
  executeFindFreeTime,
  executeGetAgenda,
  executeGetEvent,
  executeListCalendars,
  executeSearchEvents,
  executeSummarizeSchedule,
  executeUpdateEvent,
  MCP_TOOLS,
} from "@/lib/mcp/tools";
import { MCP_PROMPTS, renderPrompt } from "@/lib/mcp/prompts";
import { checkRateLimit, logMcpToolInvocation } from "@/lib/mcp/hardening";

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
  let verified = await verifyMcpAccessToken(token);

  // Claude Code / Dev Static Key fallback if enabled and configured
  if (!verified && process.env.MCP_DEV_STATIC_KEY && token === process.env.MCP_DEV_STATIC_KEY) {
    verified = {
      clientId: "dev_static_client",
      scope: "schedule:read schedule:write",
      scopes: ["schedule:read", "schedule:write"],
    };
  }

  if (!verified) {
    return buildMcpUnauthorizedResponse();
  }

  // Rate limiting for MCP tool requests: 120 calls per minute per client
  const rl = checkRateLimit(`mcp_calls_${verified.clientId}`, 120, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Rate limit exceeded. Please slow down." },
      },
      { status: 429 },
    );
  }

  // Parse JSON-RPC MCP request
  let rpcBody: {
    jsonrpc?: string;
    method?: string;
    params?: {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    id?: string | number | null;
  };
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

  if (method === "prompts/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        prompts: MCP_PROMPTS,
      },
    });
  }

  if (method === "prompts/get") {
    const promptName = params?.name ?? "";
    const promptArgs = (params?.arguments ?? {}) as Record<string, string>;
    try {
      const rendered = renderPrompt(promptName, promptArgs);
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: rendered,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Prompt '${promptName}' not found`;
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: msg,
        },
      });
    }
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    try {
      let resultText = "";
      if (toolName === "ping") {
        resultText = "pong";
      } else if (toolName === "list_calendars") {
        resultText = await executeListCalendars(args as Parameters<typeof executeListCalendars>[0]);
      } else if (toolName === "get_agenda") {
        resultText = await executeGetAgenda(args as Parameters<typeof executeGetAgenda>[0]);
      } else if (toolName === "get_event") {
        resultText = await executeGetEvent(args as Parameters<typeof executeGetEvent>[0]);
      } else if (toolName === "find_free_time") {
        resultText = await executeFindFreeTime(args as Parameters<typeof executeFindFreeTime>[0]);
      } else if (toolName === "search_events") {
        resultText = await executeSearchEvents(args as Parameters<typeof executeSearchEvents>[0]);
      } else if (toolName === "summarize_schedule") {
        resultText = await executeSummarizeSchedule(args as Parameters<typeof executeSummarizeSchedule>[0]);
      } else if (toolName === "check_conflicts") {
        resultText = await executeCheckConflicts(args as Parameters<typeof executeCheckConflicts>[0]);
      } else if (toolName === "create_event") {
        if (!verified.scopes.includes("schedule:write")) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Error: schedule:write scope required to create events. Re-authorize connection with write access.",
                },
              ],
            },
          });
        }
        resultText = await executeCreateEvent(args as Parameters<typeof executeCreateEvent>[0]);
      } else if (toolName === "update_event") {
        if (!verified.scopes.includes("schedule:write")) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Error: schedule:write scope required to update events. Re-authorize connection with write access.",
                },
              ],
            },
          });
        }
        resultText = await executeUpdateEvent(args as Parameters<typeof executeUpdateEvent>[0]);
      } else if (toolName === "delete_event") {
        if (!verified.scopes.includes("schedule:write")) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Error: schedule:write scope required to delete events. Re-authorize connection with write access.",
                },
              ],
            },
          });
        }
        resultText = await executeDeleteEvent(args as Parameters<typeof executeDeleteEvent>[0]);
      } else {
        await logMcpToolInvocation({
          clientId: verified.clientId,
          toolName: String(toolName),
          scope: verified.scope,
          paramsSummary: JSON.stringify(args),
          status: "error",
          errorMessage: `Tool '${toolName}' not found`,
        });
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool '${toolName}' not found or not implemented`,
          },
        });
      }

      await logMcpToolInvocation({
        clientId: verified.clientId,
        toolName: String(toolName),
        scope: verified.scope,
        paramsSummary: JSON.stringify(args),
        status: "ok",
      });

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
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await logMcpToolInvocation({
        clientId: verified.clientId,
        toolName: String(toolName),
        scope: verified.scope,
        paramsSummary: JSON.stringify(args),
        status: "error",
        errorMessage,
      });

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing tool: ${errorMessage}`,
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

export async function OPTIONS() {
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

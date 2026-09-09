import { db } from "@/db";
import { mcpAuditLogs } from "@/db/schema";
import { nanoid } from "nanoid";

/**
 * In-memory sliding window rate limiter for endpoints.
 * Keyed by IP or identifier.
 */
type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetInMs: windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetInMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetInMs: entry.resetAt - now };
}

/**
 * Records an audit log for an MCP tool invocation.
 */
export async function logMcpToolInvocation(params: {
  clientId?: string;
  toolName: string;
  scope?: string;
  paramsSummary?: string;
  status: "ok" | "error";
  errorMessage?: string;
}): Promise<void> {
  try {
    await db
      .insert(mcpAuditLogs)
      .values({
        id: `aud_${nanoid(16)}`,
        clientId: params.clientId ?? null,
        toolName: params.toolName,
        scope: params.scope ?? null,
        paramsSummary: params.paramsSummary ? params.paramsSummary.slice(0, 500) : null,
        status: params.status,
        errorMessage: params.errorMessage ? params.errorMessage.slice(0, 500) : null,
        createdAt: Date.now(),
      })
      .run();
  } catch (err) {
    console.error("[mcp] failed to write audit log:", err);
  }
}

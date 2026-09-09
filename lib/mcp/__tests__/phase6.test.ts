import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as mcpPost } from "../../../app/mcp/route";
import { issueAccessToken, registerMcpClient, pruneExpiredOAuthData } from "@/lib/mcp/oauth";
import { checkRateLimit } from "@/lib/mcp/hardening";
import { db } from "@/db";
import { mcpAuditLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

describe("Phase 6 — Hardening (Rate Limiting, Audit Logging, Pruning, Dev Static Key)", () => {
  const originalEnv = { ...process.env };
  let testAccessToken = "";
  let clientId = "";

  beforeEach(async () => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";
    process.env.MCP_DEV_STATIC_KEY = "test-secret-dev-static-key-123456";

    const client = await registerMcpClient({
      clientName: "Phase 6 Client",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    clientId = client.id;

    testAccessToken = await issueAccessToken({
      clientId: client.id,
      scope: "schedule:read schedule:write",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("records audit logs on tool invocation", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/call",
        params: {
          name: "ping",
          arguments: {},
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);

    // Verify audit log row was written
    const logs = await db
      .select()
      .from(mcpAuditLogs)
      .where(eq(mcpAuditLogs.clientId, clientId))
      .orderBy(desc(mcpAuditLogs.createdAt))
      .limit(1);

    expect(logs.length).toBe(1);
    expect(logs[0].toolName).toBe("ping");
    expect(logs[0].status).toBe("ok");
  });

  it("authenticates via MCP_DEV_STATIC_KEY for Claude Code / local dev", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret-dev-static-key-123456",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "tools/call",
        params: {
          name: "ping",
        },
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.content[0].text).toBe("pong");
  });

  it("enforces sliding-window rate limiting correctly", () => {
    const testKey = "rate_limit_test_key";
    const limit = 3;
    const windowMs = 5000;

    const r1 = checkRateLimit(testKey, limit, windowMs);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(testKey, limit, windowMs);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(testKey, limit, windowMs);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = checkRateLimit(testKey, limit, windowMs);
    expect(r4.allowed).toBe(false);
  });

  it("pruneExpiredOAuthData executes cleanly without error", async () => {
    const result = await pruneExpiredOAuthData();
    expect(result).toHaveProperty("prunedCodes");
    expect(result).toHaveProperty("prunedTokens");
  });
});

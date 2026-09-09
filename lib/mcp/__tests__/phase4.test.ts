import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as mcpPost } from "../../../app/mcp/route";
import { issueAccessToken, registerMcpClient } from "@/lib/mcp/oauth";

describe("Phase 4 — Server-Side Prompts (daily_agenda, week_ahead, find_time_for)", () => {
  const originalEnv = { ...process.env };
  let testAccessToken = "";

  beforeEach(async () => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";

    const client = await registerMcpClient({
      clientName: "Phase 4 Client",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    testAccessToken = await issueAccessToken({
      clientId: client.id,
      scope: "schedule:read",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lists available prompts via prompts/list", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "prompts/list",
      }),
    });

    const res = await mcpPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const promptNames = data.result.prompts.map((p: any) => p.name);
    expect(promptNames).toContain("daily_agenda");
    expect(promptNames).toContain("week_ahead");
    expect(promptNames).toContain("find_time_for");
  });

  it("renders prompt templates with arguments via prompts/get", async () => {
    // 1. daily_agenda
    const req1 = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "prompts/get",
        params: {
          name: "daily_agenda",
          arguments: { date: "2026-09-09" },
        },
      }),
    });

    const res1 = await mcpPost(req1);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.result.messages[0].content.text).toContain("for 2026-09-09");
    expect(data1.result.messages[0].content.text).toContain("get_agenda");

    // 2. find_time_for
    const req2 = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "3",
        method: "prompts/get",
        params: {
          name: "find_time_for",
          arguments: {
            activity: "Team Retro",
            durationMinutes: "45",
            window: "tomorrow",
          },
        },
      }),
    });

    const res2 = await mcpPost(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.result.messages[0].content.text).toContain("Team Retro");
    expect(data2.result.messages[0].content.text).toContain("find_free_time");
  });
});

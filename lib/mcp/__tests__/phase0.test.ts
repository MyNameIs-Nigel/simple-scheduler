import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getProtectedResource } from "../../../app/.well-known/oauth-protected-resource/route";
import { GET as getProtectedResourceMcp } from "../../../app/.well-known/oauth-protected-resource/mcp/route";
import { GET as getAuthServer } from "../../../app/.well-known/oauth-authorization-server/route";
import { POST as mcpPost, isAllowedOrigin } from "../../../app/mcp/route";

describe("Phase 0 — MCP Endpoint & Discovery Metadata", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 404 on all endpoints if MCP_ENABLED is false", async () => {
    process.env.MCP_ENABLED = "false";

    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
    });
    const res = await mcpPost(req);
    expect(res.status).toBe(404);

    const prRes = await getProtectedResource();
    expect(prRes.status).toBe(404);

    const asRes = await getAuthServer();
    expect(asRes.status).toBe(404);
  });

  it("serves OAuth protected resource metadata matching connector URL character-for-character", async () => {
    const res = await getProtectedResource();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.resource).toBe("https://schedule.nigel-smith.dev/mcp");
    expect(json.authorization_servers).toEqual(["https://schedule.nigel-smith.dev"]);

    const resMcp = await getProtectedResourceMcp();
    expect(resMcp.status).toBe(200);
    const jsonMcp = await resMcp.json();
    expect(jsonMcp.resource).toBe("https://schedule.nigel-smith.dev/mcp");
  });

  it("serves OAuth authorization server metadata with correct endpoints", async () => {
    const res = await getAuthServer();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.issuer).toBe("https://schedule.nigel-smith.dev");
    expect(json.authorization_endpoint).toBe("https://schedule.nigel-smith.dev/mcp/authorize");
    expect(json.token_endpoint).toBe("https://schedule.nigel-smith.dev/mcp/token");
    expect(json.registration_endpoint).toBe("https://schedule.nigel-smith.dev/mcp/register");
    expect(json.revocation_endpoint).toBe("https://schedule.nigel-smith.dev/mcp/revoke");
    expect(json.code_challenge_methods_supported).toContain("S256");
  });

  it("validates Origin header properly", () => {
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin("https://schedule.nigel-smith.dev")).toBe(true);
    expect(isAllowedOrigin("https://claude.ai")).toBe(true);
    expect(isAllowedOrigin("https://sub.claude.ai")).toBe(true);
    expect(isAllowedOrigin("https://claude.com")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://malicious-site.example.com")).toBe(false);
  });

  it("returns 403 Forbidden on disallowed Origin", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Origin: "https://evil.com",
      },
    });
    const res = await mcpPost(req);
    expect(res.status).toBe(403);
  });

  it("returns 401 with WWW-Authenticate header pointing to discovery metadata when unauthenticated", async () => {
    const req = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Origin: "https://claude.ai",
      },
    });
    const res = await mcpPost(req);
    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain('resource_metadata="https://schedule.nigel-smith.dev/.well-known/oauth-protected-resource"');
  });
});

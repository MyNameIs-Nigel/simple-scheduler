import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as registerPost } from "../../../app/mcp/register/route";
import { GET as authorizeGet } from "../../../app/mcp/authorize/route";
import { POST as tokenPost } from "../../../app/mcp/token/route";
import { POST as revokePost } from "../../../app/mcp/revoke/route";
import { POST as mcpPost } from "../../../app/mcp/route";
import { createHash } from "node:crypto";
import * as dal from "@/lib/auth/dal";
import { vi } from "vitest";

describe("Phase 1 — Authorization Server (DCR, PKCE, Token Exchange, Refresh, Revocation, Ping)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SITE_URL = "https://schedule.nigel-smith.dev";
    process.env.MCP_ENABLED = "true";
    process.env.MCP_TOKEN_SECRET = "0123456789012345678901234567890123456789";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("completes full OAuth 2.1 flow with DCR, PKCE S256, token exchange, ping tool call, refresh token rotation, and revocation", async () => {
    // 1. DCR: Register client
    const regReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Test Client",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      }),
    });
    const regRes = await registerPost(regReq);
    expect(regRes.status).toBe(201);
    const regData = await regRes.json();
    const clientId = regData.client_id;
    expect(clientId).toBeTruthy();

    // 2. PKCE setup
    const codeVerifier = "abcdefghijklmnopqrstuvwxyz0123456789-._~verylongverifier";
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    // 3. Authorize endpoint - unauthenticated should redirect to login
    vi.spyOn(dal, "verifySession").mockResolvedValue(null);
    const authReqUnauth = new NextRequest(
      `https://schedule.nigel-smith.dev/mcp/authorize?client_id=${clientId}&redirect_uri=https://claude.ai/api/mcp/auth_callback&response_type=code&state=xyz123&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    );
    const authResUnauth = await authorizeGet(authReqUnauth);
    expect(authResUnauth.status).toBe(307);
    const loginRedirect = authResUnauth.headers.get("location");
    expect(loginRedirect).toContain("/login?returnTo=");

    // 4. Authorize endpoint - authenticated with admin session issues code
    vi.spyOn(dal, "verifySession").mockResolvedValue({
      email: "nigel.nds.smith@gmail.com",
    });
    const authReqAuth = new NextRequest(
      `https://schedule.nigel-smith.dev/mcp/authorize?client_id=${clientId}&redirect_uri=https://claude.ai/api/mcp/auth_callback&response_type=code&state=xyz123&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    );
    const authResAuth = await authorizeGet(authReqAuth);
    expect(authResAuth.status).toBe(307);
    const callbackRedirect = new URL(authResAuth.headers.get("location")!);
    expect(callbackRedirect.origin).toBe("https://claude.ai");
    expect(callbackRedirect.searchParams.get("state")).toBe("xyz123");
    const authCode = callbackRedirect.searchParams.get("code");
    expect(authCode).toBeTruthy();

    // 5. Token exchange (application/x-www-form-urlencoded)
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authCode!,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_verifier: codeVerifier,
    });
    const tokenReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });
    const tokenRes = await tokenPost(tokenReq);
    expect(tokenRes.status).toBe(200);
    const tokenData = await tokenRes.json();
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.refresh_token).toBeTruthy();
    expect(tokenData.token_type).toBe("Bearer");

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    // 6. Test replay of authorization code: MUST FAIL with invalid_grant
    const replayReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });
    const replayRes = await tokenPost(replayReq);
    expect(replayRes.status).toBe(400);
    const replayData = await replayRes.json();
    expect(replayData.error).toBe("invalid_grant");

    // 7. Make authenticated MCP tool call (initialize, tools/list, tools/call ping)
    const pingReq = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: "https://claude.ai",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/call",
        params: { name: "ping" },
      }),
    });
    const pingRes = await mcpPost(pingReq);
    expect(pingRes.status).toBe(200);
    const pingData = await pingRes.json();
    expect(pingData.result.content[0].text).toBe("pong");

    // 8. Refresh token rotation
    const refreshParams = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    });
    const refreshReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshParams.toString(),
    });
    const refreshRes = await tokenPost(refreshReq);
    expect(refreshRes.status).toBe(200);
    const refreshData = await refreshRes.json();
    expect(refreshData.access_token).toBeTruthy();
    expect(refreshData.refresh_token).toBeTruthy();
    expect(refreshData.refresh_token).not.toBe(refreshToken);

    const newAccessToken = refreshData.access_token;
    const newRefreshToken = refreshData.refresh_token;

    // Verify new access token works
    const pingReq2 = new NextRequest("https://schedule.nigel-smith.dev/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${newAccessToken}`,
        Origin: "https://claude.ai",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "tools/call",
        params: { name: "ping" },
      }),
    });
    const pingRes2 = await mcpPost(pingReq2);
    expect(pingRes2.status).toBe(200);

    // 9. Detect refresh token reuse (present old refreshToken again) -> should revoke entire family
    const reuseReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshParams.toString(),
    });
    const reuseRes = await tokenPost(reuseReq);
    expect(reuseRes.status).toBe(400);
    const reuseData = await reuseRes.json();
    expect(reuseData.error).toBe("invalid_grant");

    // Now even newRefreshToken should fail because family was revoked
    const postReuseReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: newRefreshToken,
      }).toString(),
    });
    const postReuseRes = await tokenPost(postReuseReq);
    expect(postReuseRes.status).toBe(400);

    // 10. Revoke endpoint
    const revokeReq = new NextRequest("https://schedule.nigel-smith.dev/mcp/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: newRefreshToken }).toString(),
    });
    const revokeRes = await revokePost(revokeReq);
    expect(revokeRes.status).toBe(200);
  });
});

import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled } from "@/lib/env";
import { exchangeAuthorizationCode, refreshAccessToken } from "@/lib/mcp/oauth";

export async function POST(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Parse body: Claude sends application/x-www-form-urlencoded or JSON
  const contentType = request.headers.get("content-type") || "";
  let params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const searchParams = new URLSearchParams(text);
    for (const [key, val] of searchParams.entries()) {
      params[key] = val;
    }
  } else if (contentType.includes("application/json")) {
    try {
      params = await request.json();
    } catch {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Malformed JSON" },
        { status: 400 },
      );
    }
  } else {
    // Fallback: try searchParams or text
    const text = await request.text();
    const searchParams = new URLSearchParams(text);
    for (const [key, val] of searchParams.entries()) {
      params[key] = val;
    }
  }

  const grantType = params.grant_type;
  const clientId = params.client_id;

  if (!grantType || !clientId) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "Missing grant_type or client_id",
      },
      { status: 400 },
    );
  }

  try {
    if (grantType === "authorization_code") {
      const code = params.code;
      const redirectUri = params.redirect_uri;
      const codeVerifier = params.code_verifier;

      if (!code || !redirectUri || !codeVerifier) {
        return NextResponse.json(
          {
            error: "invalid_request",
            error_description: "Missing code, redirect_uri, or code_verifier",
          },
          { status: 400 },
        );
      }

      const result = await exchangeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });

      return NextResponse.json(
        {
          access_token: result.accessToken,
          token_type: "Bearer",
          expires_in: result.expiresIn,
          refresh_token: result.refreshToken,
          scope: result.scope,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    } else if (grantType === "refresh_token") {
      const refreshToken = params.refresh_token;
      if (!refreshToken) {
        return NextResponse.json(
          {
            error: "invalid_request",
            error_description: "Missing refresh_token",
          },
          { status: 400 },
        );
      }

      const result = await refreshAccessToken({
        refreshToken,
        clientId,
        scope: params.scope,
      });

      return NextResponse.json(
        {
          access_token: result.accessToken,
          token_type: "Bearer",
          expires_in: result.expiresIn,
          refresh_token: result.refreshToken,
          scope: result.scope,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    } else {
      return NextResponse.json(
        {
          error: "unsupported_grant_type",
          error_description: `Unsupported grant_type: ${grantType}`,
        },
        { status: 400 },
      );
    }
  } catch (error: any) {
    const msg = error?.message || "Token error";
    // Check if message is a standard OAuth error code
    if (msg.startsWith("invalid_grant")) {
      return NextResponse.json(
        {
          error: "invalid_grant",
          error_description: msg,
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: msg,
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

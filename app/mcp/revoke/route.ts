import { NextResponse, type NextRequest } from "next/server";
import { mcpEnabled } from "@/lib/env";
import { revokeRefreshToken } from "@/lib/mcp/oauth";

export async function POST(request: NextRequest) {
  if (!mcpEnabled()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const contentType = request.headers.get("content-type") || "";
  let token = "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const searchParams = new URLSearchParams(text);
    token = searchParams.get("token") || "";
  } else if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      token = body.token || "";
    } catch {
      // ignore
    }
  }

  if (token) {
    await revokeRefreshToken(token);
  }

  // RFC 7009: Revocation endpoint returns 200 OK regardless of whether token existed
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
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

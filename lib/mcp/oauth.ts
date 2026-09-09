import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  mcpAuthorizationCodes,
  mcpClients,
  mcpRefreshTokens,
  type McpClient,
} from "@/db/schema";
import {
  mcpAccessTokenTtl,
  mcpAllowedRedirectUris,
  mcpRefreshTokenTtl,
  mcpTokenSecret,
  siteUrl,
} from "@/lib/env";

export type McpTokenPayload = {
  sub: string; // client_id
  scope: string; // space-separated scopes: schedule:read schedule:write
  iss: string; // SITE_URL
  aud: string; // resource URL (${SITE_URL}/mcp)
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRandomString(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(mcpTokenSecret());
}

/**
 * Validates a client redirect URI against allowed patterns.
 * Supports loopback (http://127.0.0.1 or http://localhost) for Claude Code,
 * and allowlisted domains (Anthropic callbacks).
 */
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    // Allow loopback for CLI / local tools
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    ) {
      return true;
    }

    const allowed = mcpAllowedRedirectUris();
    return allowed.some((a) => {
      try {
        const allowedUrl = new URL(a);
        return (
          parsed.origin === allowedUrl.origin &&
          parsed.pathname === allowedUrl.pathname
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Creates a registered MCP Client (Dynamic Client Registration).
 */
export async function registerMcpClient(params: {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  tokenEndpointAuthMethod?: string;
}): Promise<McpClient> {
  const clientId = `mcp_client_${nanoid(16)}`;
  const now = Date.now();

  const newClient = {
    id: clientId,
    clientSecret: null,
    clientName: params.clientName ?? "Claude Connector",
    redirectUris: params.redirectUris,
    grantTypes: params.grantTypes ?? ["authorization_code", "refresh_token"],
    responseTypes: params.responseTypes ?? ["code"],
    tokenEndpointAuthMethod: params.tokenEndpointAuthMethod ?? "none",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(mcpClients).values(newClient).run();
  return newClient;
}

export async function getMcpClient(clientId: string): Promise<McpClient | undefined> {
  const [client] = await db
    .select()
    .from(mcpClients)
    .where(eq(mcpClients.id, clientId))
    .limit(1);
  return client;
}

/**
 * Generates and stores a single-use authorization code.
 */
export async function createAuthorizationCode(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope?: string;
}): Promise<string> {
  const code = `mcp_code_${generateRandomString(32)}`;
  const now = Date.now();
  // Valid for 5 minutes
  const expiresAt = now + 5 * 60 * 1000;

  await db
    .insert(mcpAuthorizationCodes)
    .values({
      code,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod ?? "S256",
      scope: params.scope ?? "schedule:read",
      expiresAt,
      usedAt: null,
      createdAt: now,
    })
    .run();

  return code;
}

/**
 * Verifies a PKCE S256 code challenge against the provided code verifier.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

/**
 * Exchanges an authorization code for tokens.
 * Enforces single-use; if a code is used a second time, invalidates any tokens issued.
 */
export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> {
  const [authCode] = await db
    .select()
    .from(mcpAuthorizationCodes)
    .where(eq(mcpAuthorizationCodes.code, params.code))
    .limit(1);

  if (!authCode) {
    throw new Error("invalid_grant: code not found");
  }

  // Detect replay
  if (authCode.usedAt !== null) {
    throw new Error("invalid_grant: code already used");
  }

  const now = Date.now();
  if (authCode.expiresAt < now) {
    throw new Error("invalid_grant: code expired");
  }

  if (authCode.clientId !== params.clientId) {
    throw new Error("invalid_grant: client mismatch");
  }

  if (authCode.redirectUri !== params.redirectUri) {
    throw new Error("invalid_grant: redirect_uri mismatch");
  }

  if (!verifyPkce(params.codeVerifier, authCode.codeChallenge)) {
    throw new Error("invalid_grant: code_verifier failed S256 challenge");
  }

  // Mark code as used
  await db
    .update(mcpAuthorizationCodes)
    .set({ usedAt: now })
    .where(eq(mcpAuthorizationCodes.code, params.code))
    .run();

  // Issue access token and refresh token
  const scope = authCode.scope;
  const accessToken = await issueAccessToken({
    clientId: params.clientId,
    scope,
  });

  const refreshToken = await issueRefreshToken({
    clientId: params.clientId,
    scope,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: mcpAccessTokenTtl(),
    scope,
  };
}

/**
 * Issues a stateless signed access token (JWT).
 */
export async function issueAccessToken(params: {
  clientId: string;
  scope: string;
}): Promise<string> {
  const base = siteUrl();
  const ttl = mcpAccessTokenTtl();

  return new SignJWT({
    sub: params.clientId,
    scope: params.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(base)
    .setAudience(`${base}/mcp`)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey());
}

/**
 * Issues a stateful refresh token with rotation family.
 */
export async function issueRefreshToken(params: {
  clientId: string;
  scope: string;
  familyId?: string;
}): Promise<string> {
  const token = `mcp_rt_${generateRandomString(32)}`;
  const tokenHash = hashToken(token);
  const familyId = params.familyId ?? `mcp_fam_${nanoid(16)}`;
  const now = Date.now();
  const expiresAt = now + mcpRefreshTokenTtl() * 1000;

  await db
    .insert(mcpRefreshTokens)
    .values({
      id: `rt_${nanoid(16)}`,
      tokenHash,
      clientId: params.clientId,
      familyId,
      scope: params.scope,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    })
    .run();

  return token;
}

/**
 * Refreshes an access token using a refresh token, rotating the refresh token.
 * If an already-rotated/revoked token is presented, the entire family is revoked.
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  scope?: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> {
  const hash = hashToken(params.refreshToken);
  const [stored] = await db
    .select()
    .from(mcpRefreshTokens)
    .where(eq(mcpRefreshTokens.tokenHash, hash))
    .limit(1);

  if (!stored) {
    throw new Error("invalid_grant: refresh token not found");
  }

  // Check if already revoked or already used (token reuse detection)
  if (stored.revokedAt !== null || stored.lastUsedAt !== null) {
    // Compromise detected: revoke entire family!
    await revokeFamily(stored.familyId);
    throw new Error("invalid_grant: token reuse detected, family revoked");
  }

  const now = Date.now();
  if (stored.expiresAt < now) {
    throw new Error("invalid_grant: refresh token expired");
  }

  if (stored.clientId !== params.clientId) {
    throw new Error("invalid_grant: client mismatch");
  }

  // Mark current refresh token as used/revoked
  await db
    .update(mcpRefreshTokens)
    .set({ lastUsedAt: now, revokedAt: now })
    .where(eq(mcpRefreshTokens.id, stored.id))
    .run();

  // Maintain scope or downscope if requested
  let scope = stored.scope;
  if (params.scope) {
    const requested = params.scope.split(" ").filter(Boolean);
    const existing = stored.scope.split(" ").filter(Boolean);
    if (requested.every((s) => existing.includes(s))) {
      scope = requested.join(" ");
    }
  }

  // Issue new tokens in the same family
  const accessToken = await issueAccessToken({
    clientId: params.clientId,
    scope,
  });

  const newRefreshToken = await issueRefreshToken({
    clientId: params.clientId,
    scope,
    familyId: stored.familyId,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: mcpAccessTokenTtl(),
    scope,
  };
}

/**
 * Revokes a refresh token or token family.
 */
export async function revokeRefreshToken(tokenOrHash: string): Promise<void> {
  const hash = tokenOrHash.startsWith("mcp_rt_") ? hashToken(tokenOrHash) : tokenOrHash;
  const [stored] = await db
    .select()
    .from(mcpRefreshTokens)
    .where(eq(mcpRefreshTokens.tokenHash, hash))
    .limit(1);

  if (stored) {
    await revokeFamily(stored.familyId);
  }
}

export async function revokeFamily(familyId: string): Promise<void> {
  const now = Date.now();
  await db
    .update(mcpRefreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(mcpRefreshTokens.familyId, familyId), isNull(mcpRefreshTokens.revokedAt)))
    .run();
}

export async function pruneExpiredOAuthData(): Promise<{
  prunedCodes: number;
  prunedTokens: number;
}> {
  const now = Date.now();
  // Delete expired authorization codes
  const codesRes = await db
    .delete(mcpAuthorizationCodes)
    .where(lt(mcpAuthorizationCodes.expiresAt, now))
    .run();

  // Delete expired and revoked refresh tokens older than 7 days
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const tokensRes = await db
    .delete(mcpRefreshTokens)
    .where(
      and(
        lt(mcpRefreshTokens.expiresAt, sevenDaysAgo),
        isNotNull(mcpRefreshTokens.revokedAt),
      ),
    )
    .run();

  return {
    prunedCodes: codesRes.changes,
    prunedTokens: tokensRes.changes,
  };
}


/**
 * Verifies a Bearer access token.
 */
export async function verifyMcpAccessToken(token: string): Promise<{
  clientId: string;
  scope: string;
  scopes: string[];
} | null> {
  try {
    const base = siteUrl();
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      issuer: base,
      audience: `${base}/mcp`,
    });

    if (typeof payload.sub !== "string") return null;
    const scope = typeof payload.scope === "string" ? payload.scope : "schedule:read";
    const scopes = scope.split(" ").filter(Boolean);

    return {
      clientId: payload.sub,
      scope,
      scopes,
    };
  } catch {
    return null;
  }
}

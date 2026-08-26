import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { env, siteUrl } from "@/lib/env";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Cached across requests — jose handles the key rotation and refresh itself. */
const jwks = createRemoteJWKSet(new URL(JWKS_URI));

export function redirectUri(): string {
  return `${siteUrl()}/api/auth/callback/google`;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for the given verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizationUrl(params: { state: string; challenge: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env().GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Only one account may ever sign in; prompting keeps a wrong-account session
  // from being silently reused after a rejected attempt.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export type GoogleIdentity = {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

/**
 * Exchanges the authorisation code and verifies the returned id_token against
 * Google's JWKS. Signature, issuer and audience are all checked — an id_token
 * is only trustworthy once it has survived all three.
 */
export async function exchangeCode(code: string, verifier: string): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google token exchange failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Google token response contained no id_token");

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ISSUERS,
    audience: env().GOOGLE_CLIENT_ID,
  });

  if (typeof payload.email !== "string") {
    throw new Error("Google id_token contained no email claim");
  }

  return {
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

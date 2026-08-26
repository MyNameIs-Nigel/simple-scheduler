import "server-only";

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

import { env } from "@/lib/env";

/**
 * Stateless signed-JWT sessions, following
 * node_modules/next/dist/docs/01-app/02-guides/authentication.md.
 *
 * There is exactly one admin, so there is nothing worth a sessions table: the
 * cookie *is* the session, and revocation is handled by rotating SESSION_SECRET.
 */

export const SESSION_COOKIE = "scheduler_session";
export const OAUTH_STATE_COOKIE = "scheduler_oauth";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = {
  email: string;
  name?: string;
  picture?: string;
};

function key() {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function encrypt(payload: SessionPayload, expiresIn = "7d"): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key());
}

export async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.email !== "string") return null;
    return {
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch {
    // Expired, tampered with, or signed under a rotated secret — all "no session".
    return null;
  }
}

/** Secure cookies require HTTPS; localhost development is served over HTTP. */
function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get(SESSION_COOKIE)?.value);
}

/* -------------------------------------------------------------------------- */
/* OAuth handshake state                                                      */
/* -------------------------------------------------------------------------- */

export type OAuthState = {
  state: string;
  verifier: string;
  returnTo: string;
};

/**
 * The CSRF state and PKCE verifier ride in their own short-lived signed cookie.
 * Signing them means the callback can trust the pair without server-side storage.
 */
export async function setOAuthState(value: OAuthState): Promise<void> {
  const token = await new SignJWT({ ...value })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key());

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export async function takeOAuthState(): Promise<OAuthState | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (
      typeof payload.state !== "string" ||
      typeof payload.verifier !== "string" ||
      typeof payload.returnTo !== "string"
    ) {
      return null;
    }
    return { state: payload.state, verifier: payload.verifier, returnTo: payload.returnTo };
  } catch {
    return null;
  }
}

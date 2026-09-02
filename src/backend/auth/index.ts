/**
 * Server-Side Authentication & Authorization — BINANCE AI FUTURES AGENT v0.1
 *
 * SECURITY MODEL:
 * - Session tokens are HMAC-SHA-256 signed cookies (httpOnly, secure in production)
 * - SESSION_SECRET is server-only — never exposed to client, logs, or API responses
 * - Three roles: 'boss' (full access), 'viewer' (read-only), 'none' (unauthenticated)
 * - Wallet mutations require 'boss' role — never trust client-supplied identity
 * - All auth failures are logged without exposing secrets
 *
 * Token format: {payload}.{signature}
 * Payload: base64url({ userId, role, iat, exp })
 * Signature: HMAC-SHA-256(payload, SESSION_SECRET)
 */

import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../logger";

// ─── Configuration ──────────────────────────────────────────────────

const COOKIE_NAME = "__session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const PRODUCTION = process.env["NODE_ENV"] === "production";

// ─── Types ───────────────────────────────────────────────────────────

export type Role = "boss" | "viewer" | "none";

export type SessionPayload = {
  userId: string;
  role: Role;
  iat: number; // issued at (epoch ms)
  exp: number; // expires at (epoch ms)
};

export type SessionContext = {
  authenticated: boolean;
  userId: string | null;
  role: Role;
};

// ─── SESSION_SECRET ─────────────────────────────────────────────────

function getSessionSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    if (PRODUCTION) {
      throw new AuthConfigError(
        "SESSION_SECRET is required in production. Authentication disabled without it.",
      );
    }
    // Dev fallback — NOT secure for production
    logger.warn(
      "auth",
      "SESSION_SECRET not set — using development fallback. Do NOT deploy without setting SESSION_SECRET.",
    );
    return "dev-only-insecure-fallback-do-not-use-in-production";
  }
  return secret;
}

// ─── Error Types ─────────────────────────────────────────────────────

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export class AuthError extends Error {
  statusCode: 400 | 401 | 403;
  constructor(statusCode: 400 | 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

// ─── Session Token Operations ────────────────────────────────────────

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = sign(payload, secret);
  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(signature, "base64url"),
      Buffer.from(expected, "base64url"),
    );
  } catch {
    return false;
  }
}

/**
 * Create a signed session token.
 */
export function createSessionToken(
  userId: string,
  role: Role,
): string {
  const secret = getSessionSecret();
  const now = Date.now();
  const payload: SessionPayload = {
    userId,
    role,
    iat: now,
    exp: now + SESSION_MAX_AGE_MS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a session token.
 * Returns null if the token is invalid, expired, or tampered.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx === -1) return null;

    const encodedPayload = token.substring(0, dotIdx);
    const signature = token.substring(dotIdx + 1);

    if (!encodedPayload || !signature) return null;

    const secret = getSessionSecret();
    if (!verifySignature(encodedPayload, signature, secret)) {
      logAuthEvent("INVALID_SIGNATURE", "Token signature mismatch");
      return null;
    }

    const payload: SessionPayload = JSON.parse(
      base64UrlDecode(encodedPayload),
    );

    // Validate structure
    if (
      typeof payload.userId !== "string" ||
      !["boss", "viewer", "none"].includes(payload.role) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      logAuthEvent("INVALID_PAYLOAD", "Token payload has invalid structure");
      return null;
    }

    // Check expiration
    if (Date.now() > payload.exp) {
      logAuthEvent("EXPIRED_TOKEN", `Token expired for user ${payload.userId}`);
      return null;
    }

    return payload;
  } catch {
    logAuthEvent("MALFORMED_TOKEN", "Failed to decode token");
    return null;
  }
}

// ─── Cookie Operations ───────────────────────────────────────────────

/**
 * Build a Set-Cookie header for the session.
 */
export function createSessionCookie(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    `SameSite=Lax`,
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
  ];

  if (PRODUCTION) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * Build a Set-Cookie header to clear the session.
 */
export function createClearSessionCookie(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (PRODUCTION) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * Extract session token from Cookie header string.
 */
function extractTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === COOKIE_NAME) {
      return valueParts.join("="); // Rejoin in case value contains '='
    }
  }
  return null;
}

// ─── Session Context ─────────────────────────────────────────────────

/**
 * Create a session context from a Request object.
 * This is the primary entry point for server functions to get auth state.
 */
export function createSessionContext(request: Request): SessionContext {
  const cookieHeader = request.headers.get("Cookie");
  const token = extractTokenFromCookieHeader(cookieHeader);

  if (!token) {
    return { authenticated: false, userId: null, role: "none" };
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return { authenticated: false, userId: null, role: "none" };
  }

  return {
    authenticated: true,
    userId: payload.userId,
    role: payload.role,
  };
}

// ─── Authorization Guards ────────────────────────────────────────────

/**
 * Require an authenticated session. Throws AuthError (401) if not authenticated.
 */
export function requireAuth(request: Request): SessionContext {
  const ctx = createSessionContext(request);

  if (!ctx.authenticated) {
    logAuthEvent("UNAUTHENTICATED", "Request rejected — no valid session");
    throw new AuthError(401, "Authentication required");
  }

  return ctx;
}

/**
 * Require the 'boss' role. Throws AuthError if not authorized.
 * - 401 if not authenticated
 * - 403 if authenticated but not boss
 */
export function requireBoss(request: Request): SessionContext {
  const ctx = requireAuth(request);

  if (ctx.role !== "boss") {
    logAuthEvent(
      "UNAUTHORIZED",
      `User ${ctx.userId} (role: ${ctx.role}) denied boss-level access`,
    );
    throw new AuthError(403, "Insufficient permissions: boss role required");
  }

  return ctx;
}

// ─── Security Logging ────────────────────────────────────────────────

function logAuthEvent(
  eventType: string,
  message: string,
): void {
  // Never log secrets, tokens, or cookies
  logger.warn("auth", `[SECURITY] ${eventType}: ${message}`);
}

// ─── Helper for server functions ─────────────────────────────────────

/**
 * Safe error response for auth failures.
 * Returns a Response object that can be thrown from server functions.
 * Does NOT leak internal details.
 */
export function authErrorResponse(
  statusCode: 401 | 403,
  message: string,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (statusCode === 401) {
    headers["WWW-Authenticate"] = 'Cookie realm="binance-ai-agent"';
  }
  return new Response(JSON.stringify({ error: message }), {
    status: statusCode,
    headers,
  });
}

// ─── Default Boss Session (Development Only) ─────────────────────────

/**
 * Create a default boss session for development login.
 * In production, this should be replaced with proper credential verification.
 *
 * WARNING: This is a simplified login for development.
 * In production, implement proper password verification.
 */
export function createDevLoginToken(): string {
  return createSessionToken("boss-dev-001", "boss");
}

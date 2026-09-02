/**
 * Auth Guard Middleware — BINANCE AI FUTURES AGENT v0.1
 *
 * TanStack Start function middleware that validates the session cookie
 * on protected server function calls. Uses the same pattern as the
 * CSRF middleware: accesses ctx.request to read the HTTP cookie header.
 *
 * Flow:
 *   HTTP Request with __session cookie
 *     ↓
 *   csrfMiddleware (already existing)
 *     ↓
 *   authGuardMiddleware (this file)
 *     → reads cookie from ctx.request.headers
 *     → verifies HMAC signature via verifySessionToken()
 *     → if invalid: returns 401 Response immediately
 *     → if valid: adds session to sendContext for handlers
 *     ↓
 *   Server Function Handler
 *     → context.session = { authenticated, userId, role }
 *
 * Usage: opt-in per server function:
 *   export const topUpWallet = createServerFn({ method: "POST" })
 *     .middleware([bossGuardMiddleware])
 *     .validator(...)
 *     .handler(async ({ data, context }) => {
 *       const session = context.session;
 *     });
 */

import { createMiddleware } from "@tanstack/react-start";
import {
  createSessionContext,
  type SessionContext,
} from "./index";

/**
 * Auth guard middleware.
 * Validates the __session cookie. Returns 401 if no valid session.
 * Passes SessionContext to the handler via sendContext.session.
 *
 * This is a Function middleware (not Request middleware) so it can
 * use ctx.next({ sendContext: { session } }) to pass data to handlers.
 */
export const authGuardMiddleware = createMiddleware().server(
  async (ctx: any) => {
    const session = createSessionContext(ctx.request);

    if (!session.authenticated) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return ctx.next({
      sendContext: {
        session,
      },
    });
  },
);

/**
 * Boss-only auth guard middleware.
 * Requires authenticated session with 'boss' role.
 * Returns 401 if unauthenticated, 403 if not boss.
 */
export const bossGuardMiddleware = createMiddleware().server(
  async (ctx: any) => {
    const session = createSessionContext(ctx.request);

    if (!session.authenticated) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (session.role !== "boss") {
      return new Response(
        JSON.stringify({ error: "Insufficient permissions: boss role required" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return ctx.next({
      sendContext: {
        session,
      },
    });
  },
);

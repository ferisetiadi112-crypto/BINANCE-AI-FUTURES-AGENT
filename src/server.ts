import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { startTradingRuntime } from "./backend/trading/runtime";
import { initializeDatabase } from "./backend/database";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Activate trading runtime on server boot (singleton — safe to call once)
let runtimeStarted = false;

/**
 * Detect execution mode from environment.
 * TESTNET when both BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_SECRET are set.
 * PAPER otherwise.
 */
function detectExecutionMode(): "TESTNET" | "PAPER" {
  const apiKey = process.env["BINANCE_TESTNET_API_KEY"];
  const apiSecret = process.env["BINANCE_TESTNET_SECRET"];
  if (apiKey && apiSecret) {
    return "TESTNET";
  }
  return "PAPER";
}

/**
 * Detect trading enabled state from environment.
 * P7D-2B: Only enable trading when TRADING_ENABLED=true is explicitly set.
 * Default is false (trading disabled) for read-only verification phase.
 */
function detectTradingEnabled(): boolean {
  return process.env["TRADING_ENABLED"] === "true";
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Start trading runtime on first request (singleton, idempotent)
      if (!runtimeStarted) {
        runtimeStarted = true;
        const mode = detectExecutionMode();
        const tradingEnabled = detectTradingEnabled();
        console.log(`[server] Starting runtime: mode=${mode}, tradingEnabled=${tradingEnabled}`);
        try {
          // P7D-3-FIX-CONNECTION-DIAGNOSTIC-2: Initialize database BEFORE runtime
          // This ensures PostgreSQL migrations (accounts, positions, orders, etc.)
          // are created before any code tries to query them.
          await initializeDatabase();
          console.log(`[server] Database initialized`);
          await startTradingRuntime(mode, tradingEnabled);
          console.log(`[server] Runtime started successfully: mode=${mode}`);
        } catch (err) {
          console.error(`[server] Runtime start failed: ${err}`);
          // Runtime still runs — orchestrator exists but testnetReady=false
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

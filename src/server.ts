import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { startTradingRuntime } from "./backend/trading/runtime";
import { initializeDatabase } from "./backend/database";
import { logger } from "./backend/logger";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// P7D-4.4: Track if background init has been kicked off (fire-and-forget)
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

// ─── Non-blocking background initialization ──────────────────────────
// P7D-4.4: Runtime init runs in the background so the first HTTP request
// is NOT blocked. Pages show "System starting" state until ready.

let _runtimeReady = false;
let _runtimeInitPromise: Promise<void> | null = null;

export function isRuntimeReady(): boolean {
  return _runtimeReady;
}

async function initializeRuntimeInBackground(): Promise<void> {
  if (_runtimeInitPromise) return _runtimeInitPromise;

  _runtimeInitPromise = (async () => {
    const startTime = Date.now();
    const mode = detectExecutionMode();
    const tradingEnabled = detectTradingEnabled();
    logger.info("server", `Background init: mode=${mode}, tradingEnabled=${tradingEnabled}` as string);

    try {
      await initializeDatabase();
      logger.info("server", `Database initialized in ${Date.now() - startTime}ms`);
      await startTradingRuntime(mode, tradingEnabled);
      logger.info("server", `Runtime started in ${Date.now() - startTime}ms: mode=${mode}`);
      _runtimeReady = true;
    } catch (err) {
      logger.error("server", `Background runtime init failed: ${err}`);
      // Runtime not ready — pages will show degraded state, not blocked
    }
  })();

  return _runtimeInitPromise;
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
      // P7D-4.4: Start background init on first request (non-blocking).
      // Pages render immediately; runtime data appears when ready.
      if (!runtimeStarted) {
        runtimeStarted = true;
        // Fire-and-forget: don't await — let requests flow through
        initializeRuntimeInBackground();
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

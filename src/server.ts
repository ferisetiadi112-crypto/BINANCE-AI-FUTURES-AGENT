import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { logSsrError } from "./lib/ssr-error-observability";
import { startTradingRuntime } from "./backend/trading/runtime";
import { initializeDatabase } from "./backend/database";
import { initializeUnifiedState } from "./backend/exchange/unified-state";
import { initializeMarketDataState } from "./backend/exchange/market-data-state";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// ─── Background Runtime Initialization ──────────────────────────────
// P7D-4.5: Initialization runs in background so HTTP requests are served immediately.
// The boot screen polls getSystemReadiness to track real subsystem state.

let _runtimeInitPromise: Promise<void> | null = null;
let _runtimeReady = false;
let _dbReady = false;
let _runtimeError: string | null = null;

/** Check if runtime initialization is complete */
export function isRuntimeInitialized(): boolean {
  return _runtimeReady;
}

/** Check if database initialization is complete */
export function isDatabaseReady(): boolean {
  return _dbReady;
}

/** Get runtime initialization error if any */
export function getRuntimeInitError(): string | null {
  return _runtimeError;
}

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
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  // Phase 3.5-X: structured correlation log (requestId/path/source) —
  // response behavior unchanged.
  logSsrError({
    source: "h3_swallowed",
    request,
    error: consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  });
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

/**
 * P7D-4.5: Background initialization — runs once, non-blocking.
 * HTTP requests are served immediately while init runs in background.
 * The boot screen polls getSystemReadiness() to track real state.
 */
function initializeRuntimeInBackground(): Promise<void> {
  if (_runtimeInitPromise) return _runtimeInitPromise;

  _runtimeInitPromise = (async () => {
    const mode = detectExecutionMode();
    const tradingEnabled = detectTradingEnabled();
    console.log(`[server] Background init starting: mode=${mode}, tradingEnabled=${tradingEnabled}`);

    try {
      // Step 1: Database initialization
      await initializeDatabase();
      _dbReady = true;
      console.log(`[server] Database initialized`);
    } catch (err) {
      _runtimeError = `Database init failed: ${err}`;
      console.error(`[server] Database init failed: ${err}`);
      // Database failure is fatal — don't continue to runtime
      return;
    }

    try {
      // Step 2: Trading runtime initialization
      await startTradingRuntime(mode, tradingEnabled);
      _runtimeReady = true;
      console.log(`[server] Runtime started successfully: mode=${mode}`);

      // Step 3: Initialize unified exchange state (WebSocket + REST fallback)
      // This runs after runtime so the executor is available
      initializeUnifiedState().catch((err) => {
        console.error(`[server] Unified state init error: ${err}`);
      });

      // Step 4: Initialize market data state (market WebSocket + REST fallback)
      initializeMarketDataState().catch((err) => {
        console.error(`[server] Market data state init error: ${err}`);
      });
    } catch (err) {
      _runtimeError = `Runtime start failed: ${err}`;
      console.error(`[server] Runtime start failed: ${err}`);
      // Runtime error — orchestrator exists but may be degraded
      // Set ready=true so the app can still function in degraded state
      _runtimeReady = true;

      // Still try to initialize unified state (REST-only mode)
      initializeUnifiedState().catch(() => {});
    }
  })();

  return _runtimeInitPromise;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // P7D-4.5: Fire-and-forget background initialization on first request.
      // HTTP requests are NOT blocked — the boot screen polls readiness.
      if (!_runtimeInitPromise) {
        initializeRuntimeInBackground();
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request);
    } catch (error) {
      console.error(error);
      // Phase 3.5-X: structured correlation log — response behavior unchanged.
      logSsrError({ source: "server_top_level", request, error });
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

/**
 * Trading Runtime — BINANCE AI FUTURES AGENT v0.1
 *
 * Activates the TradingOrchestrator at runtime by creating a singleton instance
 * and running a periodic loop that calls processRealtimeUpdate() for all enabled
 * symbols from the Binance WebSocket feed.
 *
 * Lifecycle:
 *   startTradingRuntime()
 *     → creates TradingOrchestrator singleton (if not exists)
 *     → starts interval loop (every 15 seconds)
 *     → each tick: orchestrator.processRealtimeUpdate() processes all 12 symbols
 *
 *   stopTradingRuntime()
 *     → clears interval loop
 *     → resets singleton
 *
 * Safety:
 * - Idempotent: startTradingRuntime() is safe to call multiple times
 * - OFFLINE/STALE symbols are rejected by processRealtimeUpdate() internally
 * - No duplicate timers, no duplicate WebSocket connections
 * - Paper Trading only, Risk Engine untouched
 */

import { TradingOrchestrator } from "./orchestrator";
import { logger } from "../logger";

// ─── Configuration ───────────────────────────────────────────────

/**
 * Interval in milliseconds between each orchestrator tick.
 * Each tick processes all enabled symbols via processRealtimeUpdate().
 * 15 seconds balances responsiveness with resource usage.
 */
const TICK_INTERVAL_MS = 15_000;

// ─── Singleton State ─────────────────────────────────────────────

let _orchestrator: TradingOrchestrator | null = null;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _running = false;

// ─── Runtime Loop ────────────────────────────────────────────────

function tick(): void {
  if (!_orchestrator) return;

  try {
    const results = _orchestrator.processRealtimeUpdate();
    const processed = results.filter((r) => r.reason === "OK").length;
    const skipped = results.filter((r) => r.reason === "OFFLINE/STALE/insufficient_data").length;
    const errored = results.filter((r) => r.reason === "ERROR").length;

    if (processed > 0 || errored > 0) {
      logger.info(
        "trading-runtime",
        `Tick: ${processed} processed, ${skipped} skipped (offline/stale), ${errored} errors`,
      );
    }
  } catch (err) {
    logger.error("trading-runtime", `Tick error: ${err}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Start the trading runtime.
 *
 * Creates a singleton TradingOrchestrator and starts a periodic loop
 * that calls processRealtimeUpdate() for all enabled symbols.
 *
 * Safe to call multiple times — the singleton and interval are created only once.
 */
export function startTradingRuntime(): TradingOrchestrator {
  if (_running) {
    return _orchestrator!;
  }

  _orchestrator = new TradingOrchestrator();
  _running = true;

  // Run first tick immediately
  tick();

  // Start periodic loop
  _intervalId = setInterval(tick, TICK_INTERVAL_MS);

  logger.info("trading-runtime", "Trading runtime started (PAPER MODE, 12 symbols, 15s tick)");
  return _orchestrator;
}

/**
 * Stop the trading runtime.
 *
 * Clears the interval loop and resets the singleton.
 * WebSocket connections are managed by FeedManager (separate lifecycle).
 */
export function stopTradingRuntime(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _orchestrator = null;
  _running = false;
  logger.info("trading-runtime", "Trading runtime stopped");
}

/**
 * Get the current TradingOrchestrator instance.
 * Returns null if runtime has not been started.
 */
export function getOrchestrator(): TradingOrchestrator | null {
  return _orchestrator;
}

/**
 * Check if the trading runtime is currently active.
 */
export function isRuntimeRunning(): boolean {
  return _running;
}

/**
 * Reset runtime state (for testing only).
 */
export function resetRuntime(): void {
  stopTradingRuntime();
}

/**
 * Export tick interval for testing.
 */
export function getTickIntervalMs(): number {
  return TICK_INTERVAL_MS;
}

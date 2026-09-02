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

// ─── Runtime Stats ──────────────────────────────────────────────

export type RuntimeEvent = {
  timestamp: number;
  tickNumber: number;
  symbol: string;
  feedState: string;
  decision: string | null;
  confidence: number | null;
  strategy: string | null;
  riskApproved: boolean | null;
  riskReason: string | null;
  executionResult: string | null;
  paperTradeId: string | null;
  experienceRecorded: boolean;
  error: string | null;
};

export type PerSymbolStats = {
  symbol: string;
  processed: number;
  skipped: number;
  decisions: number;
  noTrade: number;
  riskRejected: number;
  paperExecutions: number;
  errors: number;
};

export type RuntimeStats = {
  tickCount: number;
  totalProcessed: number;
  totalSkipped: number;
  totalErrors: number;
  totalDecisions: number;
  totalNoTrade: number;
  totalRiskRejected: number;
  totalPaperExecutions: number;
  lastTickAt: number;
  startedAt: number;
};

export type RuntimeSnapshot = {
  running: boolean;
  tickIntervalMs: number;
  stats: RuntimeStats;
  perSymbol: PerSymbolStats[];
  recentEvents: RuntimeEvent[];
  eventBufferLimit: number;
};

const MAX_EVENT_BUFFER = 100;

const _stats: RuntimeStats = {
  tickCount: 0,
  totalProcessed: 0,
  totalSkipped: 0,
  totalErrors: 0,
  totalDecisions: 0,
  totalNoTrade: 0,
  totalRiskRejected: 0,
  totalPaperExecutions: 0,
  lastTickAt: 0,
  startedAt: 0,
};

const _perSymbol = new Map<string, PerSymbolStats>();
const _events: RuntimeEvent[] = [];

/**
 * Clone a RuntimeEvent. All fields are primitives, so spread is sufficient.
 * Prevents callers from mutating internal event buffer via returned references.
 */
function cloneEvent(e: RuntimeEvent): RuntimeEvent {
  return { ...e };
}

// ─── Singleton State ─────────────────────────────────────────────

let _orchestrator: TradingOrchestrator | null = null;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _running = false;

// ─── Runtime Loop ────────────────────────────────────────────────

function tick(): void {
  if (!_orchestrator) return;

  _stats.tickCount++;
  _stats.lastTickAt = Date.now();

  try {
    const results = _orchestrator.processRealtimeUpdate();
    const processed = results.filter((r) => r.reason === "OK").length;
    const skipped = results.filter((r) => r.reason === "OFFLINE/STALE/insufficient_data").length;
    const errored = results.filter((r) => r.reason === "ERROR").length;

    _stats.totalProcessed += processed;
    _stats.totalSkipped += skipped;
    _stats.totalErrors += errored;

    // Per-symbol processed/skipped counts
    for (const r of results) {
      const ps = _getOrCreatePerSymbol(r.symbol);
      if (r.reason === "OK") ps.processed++;
      else if (r.reason === "OFFLINE/STALE/insufficient_data") ps.skipped++;
    }

    // Aggregate decision-level metrics and record events
    // Per-symbol try/catch ensures one symbol's error doesn't prevent others from being recorded
    for (const r of results) {
      try {
        const sym = r.symbol;
        const ps = _getOrCreatePerSymbol(sym);

        if (r.reason === "ERROR") {
          ps.errors++;
          _events.push({
            timestamp: Date.now(),
            tickNumber: _stats.tickCount,
            symbol: sym,
            feedState: "ERROR",
            decision: null,
            confidence: null,
            strategy: null,
            riskApproved: null,
            riskReason: null,
            executionResult: null,
            paperTradeId: null,
            experienceRecorded: false,
            error: "Symbol processing error",
          });
          continue;
        }

        if (r.reason !== "OK" || !r.result) {
          // Skipped symbol
          _events.push({
            timestamp: Date.now(),
            tickNumber: _stats.tickCount,
            symbol: sym,
            feedState: r.reason || "skipped",
            decision: null,
            confidence: null,
            strategy: null,
            riskApproved: null,
            riskReason: null,
            executionResult: null,
            paperTradeId: null,
            experienceRecorded: false,
            error: null,
          });
          continue;
        }

        const { decision, riskResult, trade } = r.result;
        _stats.totalDecisions++;
        ps.decisions++;

        let eventDecision: string | null = decision.direction;
        let eventExecResult: string | null = null;
        let eventPaperId: string | null = null;

        if (decision.direction === "NO_TRADE") {
          _stats.totalNoTrade++;
          ps.noTrade++;
          eventExecResult = "NO_TRADE";
        } else if (!riskResult.approved) {
          _stats.totalRiskRejected++;
          ps.riskRejected++;
          eventExecResult = "REJECTED";
        } else if (trade) {
          _stats.totalPaperExecutions++;
          ps.paperExecutions++;
          eventExecResult = "EXECUTED";
          eventPaperId = trade.id;
        }

        _events.push({
          timestamp: Date.now(),
          tickNumber: _stats.tickCount,
          symbol: sym,
          feedState: "ONLINE",
          decision: eventDecision,
          confidence: decision.confidence,
          strategy: decision.strategy,
          riskApproved: riskResult.approved,
          riskReason: riskResult.reason,
          executionResult: eventExecResult,
          paperTradeId: eventPaperId,
          experienceRecorded: true,
          error: null,
        });
      } catch (err) {
        logger.error("trading-runtime", `Event recording error for ${r.symbol}: ${err}`);
      }
    }

    // Trim event buffer to bounded size
    while (_events.length > MAX_EVENT_BUFFER) {
      _events.shift();
    }

    if (processed > 0 || errored > 0) {
      logger.info(
        "trading-runtime",
        `Tick #${_stats.tickCount}: ${processed} processed, ${skipped} skipped, ${errored} errors`,
      );
    }
  } catch (err) {
    _stats.totalErrors++;
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
  _stats.startedAt = Date.now();

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
 * Get current runtime statistics.
 */
export function getRuntimeStats(): RuntimeStats {
  return { ..._stats };
}

/**
 * Reset runtime state (for testing only).
 */
export function resetRuntime(): void {
  stopTradingRuntime();
  _stats.tickCount = 0;
  _stats.totalProcessed = 0;
  _stats.totalSkipped = 0;
  _stats.totalErrors = 0;
  _stats.totalDecisions = 0;
  _stats.totalNoTrade = 0;
  _stats.totalRiskRejected = 0;
  _stats.totalPaperExecutions = 0;
  _stats.lastTickAt = 0;
  _stats.startedAt = 0;
  _perSymbol.clear();
  _events.length = 0;
}

/**
 * Export tick interval for testing.
 */
export function getTickIntervalMs(): number {
  return TICK_INTERVAL_MS;
}

// ─── Per-Symbol Helpers ─────────────────────────────────────────

function _getOrCreatePerSymbol(symbol: string): PerSymbolStats {
  let ps = _perSymbol.get(symbol);
  if (!ps) {
    ps = { symbol, processed: 0, skipped: 0, decisions: 0, noTrade: 0, riskRejected: 0, paperExecutions: 0, errors: 0 };
    _perSymbol.set(symbol, ps);
  }
  return ps;
}



// ─── Runtime Snapshot ───────────────────────────────────────────

/**
 * Get a complete snapshot of the runtime state.
 * Read-only — does not modify any runtime state.
 */
export function getRuntimeSnapshot(): RuntimeSnapshot {
  return {
    running: _running,
    tickIntervalMs: TICK_INTERVAL_MS,
    stats: { ..._stats },
    perSymbol: Array.from(_perSymbol.values()).map(ps => ({ ...ps })),
    recentEvents: _events.map(cloneEvent),
    eventBufferLimit: MAX_EVENT_BUFFER,
  };
}

/** Get per-symbol statistics. */
export function getPerSymbolStats(): PerSymbolStats[] {
  return Array.from(_perSymbol.values()).map(ps => ({ ...ps }));
}

/** Get recent runtime events (bounded buffer, deep-cloned for caller safety). */
export function getRuntimeEvents(): RuntimeEvent[] {
  return _events.map(cloneEvent);
}

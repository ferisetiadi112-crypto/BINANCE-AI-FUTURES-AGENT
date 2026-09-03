/**
 * Trading Runtime — BINANCE AI FUTURES AGENT v0.1 (P4)
 *
 * Activates the TradingOrchestrator at runtime by creating a singleton instance
 * and running a periodic loop that calls processRealtimeUpdate() for all enabled
 * symbols from the Binance WebSocket feed.
 *
 * P4 Execution Modes:
 * - PAPER: Uses PaperTradingEngine (simulation only)
 * - TESTNET: Uses TestnetExecutor (Binance Futures Testnet)
 *
 * Lifecycle (TESTNET):
 *   startTradingRuntime("TESTNET")
 *     → validates testnet configuration
 *     → connects to Binance Futures Testnet
 *     → reconciles positions
 *     → restores risk state
 *     → creates TradingOrchestrator singleton
 *     → starts periodic reporting (30-min interval)
 *     → starts journal retention enforcement
 *     → starts interval loop (every 15 seconds)
 *     → each tick: orchestrator.processRealtimeUpdate() processes all symbols
 *     → periodic position monitoring
 *
 * Safety:
 * - Idempotent: startTradingRuntime() is safe to call multiple times
 * - OFFLINE/STALE symbols are rejected by processRealtimeUpdate() internally
 * - No duplicate timers, no duplicate WebSocket connections
 * - Risk Engine untouched by runtime — only orchestrator interacts with it
 */

import { TradingOrchestrator, type ExecutionMode } from "./orchestrator";
import { logger } from "../logger";
import {
  startPeriodicReporting,
  stopPeriodicReporting,
} from "../journal/reporting";
import {
  startRetentionEnforcement,
  stopRetentionEnforcement,
  startReviewRetentionEnforcement,
  stopReviewRetentionEnforcement,
} from "../journal/retention";
import { getJournalEvents as getAllJournalEvents } from "../journal";
import { getReviews } from "../journal/post-trade-review";

// ─── Configuration ───────────────────────────────────────────────

const TICK_INTERVAL_MS = 15_000;
const POSITION_MONITOR_INTERVAL_MS = 30_000;

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
  testnetOrderId: number | null;
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
  testnetExecutions: number;
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
  totalTestnetExecutions: number;
  lastTickAt: number;
  startedAt: number;
  executionMode: ExecutionMode;
  testnetReady: boolean;
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
  totalTestnetExecutions: 0,
  lastTickAt: 0,
  startedAt: 0,
  executionMode: "PAPER",
  testnetReady: false,
};

const _perSymbol = new Map<string, PerSymbolStats>();
const _events: RuntimeEvent[] = [];

function cloneEvent(e: RuntimeEvent): RuntimeEvent {
  return { ...e };
}

// ─── Singleton State ─────────────────────────────────────────────

let _orchestrator: TradingOrchestrator | null = null;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _positionMonitorId: ReturnType<typeof setInterval> | null = null;
let _running = false;

// ─── Runtime Loop ────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!_orchestrator) return;

  _stats.tickCount++;
  _stats.lastTickAt = Date.now();

  try {
    const results = await _orchestrator.processRealtimeUpdate();
    const processed = results.filter((r) => r.reason === "OK").length;
    const skipped = results.filter((r) => r.reason === "OFFLINE/STALE/insufficient_data").length;
    const errored = results.filter((r) => r.reason === "ERROR").length;

    _stats.totalProcessed += processed;
    _stats.totalSkipped += skipped;
    _stats.totalErrors += errored;

    for (const r of results) {
      const ps = _getOrCreatePerSymbol(r.symbol);
      if (r.reason === "OK") ps.processed++;
      else if (r.reason === "OFFLINE/STALE/insufficient_data") ps.skipped++;
    }

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
            testnetOrderId: null,
            experienceRecorded: false,
            error: "Symbol processing error",
          });
          continue;
        }

        if (r.reason !== "OK" || !r.result) {
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
            testnetOrderId: null,
            experienceRecorded: false,
            error: null,
          });
          continue;
        }

        const { decision, riskResult, trade, testnetResult } = r.result;
        _stats.totalDecisions++;
        ps.decisions++;

        let eventDecision: string | null = decision.direction;
        let eventExecResult: string | null = null;
        let eventPaperId: string | null = null;
        let eventTestnetOrderId: number | null = null;

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
        } else if (testnetResult) {
          _stats.totalTestnetExecutions++;
          ps.testnetExecutions++;
          eventExecResult = testnetResult.success ? "TESTNET_EXECUTED" : "TESTNET_FAILED";
          eventTestnetOrderId = testnetResult.orderId;
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
          testnetOrderId: eventTestnetOrderId,
          experienceRecorded: true,
          error: null,
        });
      } catch (err) {
        logger.error("trading-runtime", `Event recording error for ${r.symbol}: ${err}`);
      }
    }

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

// ─── Position Monitor Loop (P4) ─────────────────────────────────

async function monitorPositions(): Promise<void> {
  if (!_orchestrator || !_orchestrator.isTestnetReady()) return;

  try {
    await _orchestrator.reconcilePositions();
  } catch (err) {
    logger.error("trading-runtime", `Position monitor error: ${err}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Start the trading runtime.
 *
 * @param executionMode - "PAPER" (default) or "TESTNET"
 */
export async function startTradingRuntime(
  executionMode: ExecutionMode = "PAPER",
  tradingEnabled = false,
): Promise<TradingOrchestrator> {
  if (_running) {
    return _orchestrator!;
  }

  _orchestrator = new TradingOrchestrator(executionMode, tradingEnabled);
  _running = true;
  _stats.startedAt = Date.now();
  _stats.executionMode = executionMode;

  logger.info(
    "trading-runtime",
    `Orchestrator created: executionMode=${executionMode}, tradingEnabled=${tradingEnabled}`,
  );

  // Initialize testnet if requested
  if (executionMode === "TESTNET") {
    logger.info("trading-runtime", "Attempting testnet initialization...");
    const testnetReady = await _orchestrator.initializeTestnet();
    _stats.testnetReady = testnetReady;
    logger.info(
      "trading-runtime",
      `Testnet initialization result: testnetReady=${testnetReady}`,
    );

    if (!testnetReady) {
      // P7A: NO PAPER fallback — execution stays disabled until testnet is healthy.
      // Trading is blocked because testnetReady=false. Research/journal continue.
      logger.error(
        "trading-runtime",
        "Testnet initialization failed — execution DISABLED (fail closed). No PAPER fallback.",
      );
      // executionMode stays TESTNET, testnetReady stays false → execution blocked
    }
  }

  // Start periodic reporting (H-3)
  startPeriodicReporting(() => {
    const dailyStats = _orchestrator?.getDailyStats();
    const position = _orchestrator?.getPaperEngine().getPosition();
    return {
      dailyPnl: dailyStats?.pnl ?? 0,
      sessionPnl: dailyStats?.sessionPnl ?? 0,
      isLocked: dailyStats?.locked ?? false,
      openPositions: dailyStats?.openPositionCount ?? 0,
      cooldownActive: dailyStats?.cooldownActive ?? false,
      recentActivity: _orchestrator?.getRecentActivity()?.slice(-5)?.join("\n") ?? "No activity",
    };
  });

  // Start journal retention (M-3)
  startRetentionEnforcement((cutoffTimestamp: number) => {
    const events = getAllJournalEvents();
    const oldEvents = events.filter((e) => e.timestamp < cutoffTimestamp);
    return oldEvents.length;
  });

  startReviewRetentionEnforcement((_cutoffTimestamp: number) => {
    const reviews = getReviews();
    return 0;
  });

  // Run first tick immediately and wait for it
  await tick();

  // Start periodic loop
  _intervalId = setInterval(() => tick().catch(err => logger.error("trading-runtime", `Tick error: ${err}`)), TICK_INTERVAL_MS);

  // Start position monitor loop (P4)
  if (executionMode === "TESTNET" && _stats.testnetReady) {
    _positionMonitorId = setInterval(
      () => monitorPositions().catch(err => logger.error("trading-runtime", `Monitor error: ${err}`)),
      POSITION_MONITOR_INTERVAL_MS,
    );
  }

  const modeLabel = _stats.executionMode === "TESTNET" ? "TESTNET" : "PAPER";
  logger.info("trading-runtime", `Trading runtime started (${modeLabel}, 12 symbols, 15s tick)`);
  return _orchestrator;
}

/**
 * Stop the trading runtime.
 */
export function stopTradingRuntime(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  if (_positionMonitorId !== null) {
    clearInterval(_positionMonitorId);
    _positionMonitorId = null;
  }
  _orchestrator?.stop();
  _orchestrator = null;
  _running = false;

  stopPeriodicReporting();
  stopRetentionEnforcement();
  stopReviewRetentionEnforcement();

  logger.info("trading-runtime", "Trading runtime stopped");
}

export function getOrchestrator(): TradingOrchestrator | null {
  return _orchestrator;
}

export function isRuntimeRunning(): boolean {
  return _running;
}

export function getRuntimeStats(): RuntimeStats {
  return { ..._stats };
}

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
  _stats.totalTestnetExecutions = 0;
  _stats.lastTickAt = 0;
  _stats.startedAt = 0;
  _stats.executionMode = "PAPER";
  _stats.testnetReady = false;
  _perSymbol.clear();
  _events.length = 0;
}

export function getTickIntervalMs(): number {
  return TICK_INTERVAL_MS;
}

// ─── Per-Symbol Helpers ─────────────────────────────────────────

function _getOrCreatePerSymbol(symbol: string): PerSymbolStats {
  let ps = _perSymbol.get(symbol);
  if (!ps) {
    ps = { symbol, processed: 0, skipped: 0, decisions: 0, noTrade: 0, riskRejected: 0, paperExecutions: 0, testnetExecutions: 0, errors: 0 };
    _perSymbol.set(symbol, ps);
  }
  return ps;
}

// ─── Runtime Snapshot ───────────────────────────────────────────

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

export function getPerSymbolStats(): PerSymbolStats[] {
  return Array.from(_perSymbol.values()).map(ps => ({ ...ps }));
}

export function getRuntimeEvents(): RuntimeEvent[] {
  return _events.map(cloneEvent);
}

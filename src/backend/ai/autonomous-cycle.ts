/**
 * Phase 3.8-D.4 — Autonomous Control Loop Foundation
 *
 * ONE AI Futures Agent (agentId = "orbital-futures-agent") with a safe,
 * bounded autonomous lifecycle:
 *
 *   OBSERVE → COLLECT EVIDENCE → REASON → DECIDE
 *            → CONTROLLED ACTION → VERIFY → EXPERIENCE/RECORD → NEXT CYCLE
 *
 * DESIGN GUARANTEES:
 * - Reuses existing infrastructure: Agent Core (identity/evidence/provenance),
 *   AIRouter (LLM provider chain Gemini → Groq → OpenRouter → Cerebras →
 *   Mistral → SAFE_FALLBACK), existing memory/context, existing risk state,
 *   existing journal, and the Controlled Actions registry (default-deny).
 * - NO user instruction is required to run a cycle. USER_INSTRUCTION is
 *   non-evidence; the cycle API does not even accept user text.
 * - Bounded: a cycle never loops on itself, never overlaps (in-flight guard
 *   → SKIPPED), and never retries actions. LLM fallback is the existing
 *   bounded chain inside AIRouter.
 * - Fail-closed: no market evidence → NO_TRADE (no LLM call, no fabricated
 *   decision). All failures are recorded, never retried indefinitely.
 * - READ-ONLY: only registered READ_ONLY controlled actions may run
 *   (default: system.readiness). No order/leverage/margin capability exists
 *   in this module; the trading executor is never imported.
 * - No credentials, API keys, DATABASE_URL, tokens, or raw provider payloads
 *   ever appear in cycle output or journal details.
 */

import { logger } from "../logger";
import {
  AGENT_IDENTITY,
  buildEvidenceHierarchy,
  buildReasoningProvenance,
  type ReasoningProvenance,
} from "./agent-core";
import type { AIRouter } from "./llm/router";
import type { ActionExecutionResult } from "../api/controlled-actions";
import type { MarketState } from "../runtime/types";
import { initializeScheduler, shutdownScheduler } from "./decision-scheduler";

// ─── Identity ────────────────────────────────────────────────────────

export const AUTONOMOUS_AGENT_ID: string = AGENT_IDENTITY.codename;

// ─── Cycle Types ─────────────────────────────────────────────────────

export type AutonomousCycleStatus =
  | "SKIPPED" // previous cycle still in flight (no overlap)
  | "NO_TRADE_INSUFFICIENT_EVIDENCE" // no market evidence → safe no-op
  | "COMPLETED" // reasoned + READ_ONLY action OK + verified
  | "COMPLETED_WITH_DENIED_ACTION" // cycle safe, action denied (registry)
  | "COMPLETED_WITH_FAILED_ACTION" // cycle safe, action handler errored
  | "FAILED"; // unexpected internal error (fail-closed)

export type AutonomousCycleResult = {
  cycleId: string;
  agentId: string;
  startedAt: string;
  completedAt: string;
  status: AutonomousCycleStatus;
  reason: string;
  evidenceCount: number;
  decision: string;
  confidence: number | null;
  /** Honest provenance: llm-<provider> only after schema-validated success. */
  modelVersion: string;
  actionId: string | null;
  actionStatus: "NOT_RUN" | "OK" | "ERROR" | "DENIED";
  verificationStatus: "NOT_RUN" | "VERIFIED" | "FAILED" | "DENIED";
  /** Safe structured rationale (no chain-of-thought). */
  provenance: ReasoningProvenance | null;
  /** Safe registry decision + READ_ONLY result (never credentials). */
  actionResult: ActionExecutionResult | null;
  journalRecorded: boolean;
  /** Safe observed summary for observability. */
  observed: {
    runtimeRunning: boolean;
    databaseReady: boolean;
    runtimeInitialized: boolean;
    executionMode: string | null;
    marketAvailable: boolean;
    marketSymbols: number;
    riskTradingEnabled: boolean; // read from risk engine, never set here
    providersConfigured: number;
  };
};

export type AutonomousCycleOptions = {
  /** Why this cycle was triggered (observability only). */
  reason?: string;
  /**
   * Registered READ_ONLY action to run as the cycle's controlled action.
   * Defaults to "system.readiness". Anything else still goes through the
   * registry and is DENIED if unregistered/trading-looking.
   */
  controlledActionId?: string;
  /** Optional symbol; defaults to the primary subscribed symbol. */
  symbol?: string;
  /** Test seam: inject an AIRouter (dynamic default otherwise). */
  router?: AIRouter;
};

// ─── In-flight guard (no overlap, no recursion) ──────────────────────

let _cycleInFlight = false;
let _totalCycles = 0;
let _skippedCycles = 0;
let _lastResult: Pick<AutonomousCycleResult, "cycleId" | "status" | "startedAt" | "completedAt" | "decision" | "modelVersion" | "actionId" | "actionStatus" | "verificationStatus"> | null = null;
let _cycleCounter = 0;

export function isAutonomousCycleRunning(): boolean {
  return _cycleInFlight;
}

export function getAutonomousCycleStats() {
  return {
    totalCycles: _totalCycles,
    skippedCycles: _skippedCycles,
    inFlight: _cycleInFlight,
    lastCycle: _lastResult,
  };
}

export function resetAutonomousCycleState(): void {
  _cycleInFlight = false;
  _totalCycles = 0;
  _skippedCycles = 0;
  _lastResult = null;
  _cycleCounter = 0;
}

// ─── Evidence helpers ────────────────────────────────────────────────

function evidenceFromMarketState(ms: MarketState): {
  trend: string;
  momentum: string;
  volume: string;
  volatility: string;
  structure: string;
  regime: import("../runtime/types").MarketRegime;
  regimeConfidence: number;
  indicators: { rsi: number; ema20: number; ema50: number; macd: number; atr: number };
} {
  return {
    trend: `${ms.trend} (strength: ${ms.trendStrength.toFixed(1)})`,
    momentum: `${ms.momentum} (score: ${ms.momentumScore.toFixed(1)})`,
    volume: `24h: ${ms.volume24h.toFixed(0)} (change: ${ms.volumeChange.toFixed(1)}%)`,
    volatility: `ATR: ${ms.volatility.toFixed(2)} (${ms.volatilityPercent.toFixed(2)}%)`,
    structure: ms.marketStructure,
    regime: ms.marketRegime,
    regimeConfidence: ms.regimeConfidence,
    indicators: { rsi: 0, ema20: 0, ema50: 0, macd: 0, atr: ms.volatility },
  };
}

// ─── Cycle runner ────────────────────────────────────────────────────

/**
 * Run ONE bounded autonomous cycle. Never overlaps with a previous cycle
 * (returns SKIPPED) and never retries actions. Safe to call from the
 * existing scheduler/orchestrator tick.
 */
export async function runAutonomousCycle(
  options: AutonomousCycleOptions = {},
): Promise<AutonomousCycleResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  // No-overlap guard — synchronous, so concurrent calls see it immediately.
  if (_cycleInFlight) {
    _skippedCycles++;
    return {
      cycleId: `CYC-${++_cycleCounter}`,
      agentId: AUTONOMOUS_AGENT_ID,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "SKIPPED",
      reason: "PREVIOUS_CYCLE_IN_FLIGHT",
      evidenceCount: 0,
      decision: "NO_TRADE",
      confidence: null,
      modelVersion: "skipped",
      actionId: null,
      actionStatus: "NOT_RUN",
      verificationStatus: "NOT_RUN",
      provenance: null,
      actionResult: null,
      journalRecorded: false,
      observed: {
        runtimeRunning: false,
        databaseReady: false,
        runtimeInitialized: false,
        executionMode: null,
        marketAvailable: false,
        marketSymbols: 0,
        riskTradingEnabled: false,
        providersConfigured: 0,
      },
    };
  }

  _cycleInFlight = true;
  _totalCycles++;
  const cycleId = `CYC-${Date.now().toString(36)}-${++_cycleCounter}`;
  const reason = options.reason ?? "AUTONOMOUS";
  const controlledActionId = options.controlledActionId ?? "system.readiness";

  const finish = (
    partial: Omit<AutonomousCycleResult, "cycleId" | "agentId" | "startedAt" | "completedAt">,
  ): AutonomousCycleResult => {
    const result: AutonomousCycleResult = {
      cycleId,
      agentId: AUTONOMOUS_AGENT_ID,
      startedAt,
      completedAt: new Date().toISOString(),
      ...partial,
    };
    _lastResult = {
      cycleId: result.cycleId,
      status: result.status,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      decision: result.decision,
      modelVersion: result.modelVersion,
      actionId: result.actionId,
      actionStatus: result.actionStatus,
      verificationStatus: result.verificationStatus,
    };
    return result;
  };

  try {
    // ── 1. OBSERVE (safe evidence only — no credentials) ──────────────
    const { isRuntimeRunning, getRuntimeSnapshot, getOrchestrator } = await import(
      "../trading/runtime"
    );
    const { isDatabaseReady, isRuntimeInitialized, getRuntimeInitError } = await import(
      "../../server"
    );
    const { getMarketSnapshot } = await import("../exchange/market-data-state");
    const { generateRealtimeMarketState, fetchFeedStatus } = await import(
      "../services/data-adapter"
    );
    const { buildMemoryContext } = await import("./memory-context");
    const { getRecentJournalEvents } = await import("../journal");
    const { getAvailableProviders } = await import("./llm/providers");

    const runtimeRunning = isRuntimeRunning();
    const runtimeInitialized = isRuntimeInitialized();
    const databaseReady = isDatabaseReady();
    const runtimeInitError = getRuntimeInitError();
    const snapshot = getRuntimeSnapshot();
    const orchestrator = getOrchestrator();
    const marketSnapshot = getMarketSnapshot();
    const recentJournal = getRecentJournalEvents(10);
    const providers = getAvailableProviders();

    const marketSymbol = options.symbol ?? marketSnapshot.subscribedSymbols[0] ?? null;
    let marketState: MarketState | null = null;
    let marketAvailable = false;
    let marketSymbols = 0;

    try {
      const feed = await fetchFeedStatus();
      marketSymbols = feed.symbols.length;
    } catch {
      marketSymbols = marketSnapshot.subscribedSymbols.length;
    }

    if (marketSymbol) {
      marketState = generateRealtimeMarketState(marketSymbol);
      marketAvailable = marketState !== null;
    }

    // ── 2. COLLECT EVIDENCE (existing Agent Core hierarchy) ───────────
    const memoryContext = marketState ? await buildMemoryContext(marketState) : null;

    const riskEvidence =
      orchestrator && runtimeRunning
        ? {
            label: "Risk state",
            detail: `tradingEnabled(riskEngine)=${orchestrator.getRiskEngine().isTradingEnabled()} dailyPnl=${orchestrator.getDailyStats().pnl}`,
          }
        : { label: "Risk state", detail: "runtime not running — no risk state available" };

    const lastDecision = orchestrator?.getState().lastDecision ?? null;
    const previousDecisionEvidence = lastDecision
      ? {
          label: "Previous decision",
          detail: `${lastDecision.direction} ${lastDecision.symbol} (${lastDecision.modelVersion})`,
        }
      : undefined;

    const hierarchy = buildEvidenceHierarchy({
      systemState: {
        label: "Live system state",
        detail: `runtime=${runtimeRunning} initialized=${runtimeInitialized} databaseReady=${databaseReady}${runtimeInitError ? ` error=${runtimeInitError}` : ""}`,
      },
      ...(marketState
        ? {
            marketData: {
              label: `Market data ${marketState.symbol}`,
              detail: `price=${marketState.price} regime=${marketState.marketRegime} trend=${marketState.trend} momentum=${marketState.momentum}`,
            },
          }
        : {}),
      riskState: riskEvidence,
      experiences: recentJournal.slice(0, 3).map((e) => ({
        label: `Recent experience ${e.eventType}`,
        detail: e.message,
      })),
      ...(memoryContext?.available
        ? {
            memory: {
              label: "Agent memory",
              detail: `lessons=${memoryContext.lessonCount} experiences=${memoryContext.experienceCount}`,
            },
          }
        : {}),
      ...(previousDecisionEvidence ? { previousDecisions: [previousDecisionEvidence] } : {}),
    });

    // USER_INSTRUCTION is NEVER part of an autonomous cycle — the API has
    // no user-text parameter. (classifyUserInput / buildEvidenceHierarchy
    // already enforce this for chat; here it is structurally impossible.)
    const evidenceCount = hierarchy.evidence.length;

    // ── 3+4. REASON + DECIDE (existing AIRouter; NO_TRADE if no evidence) ──
    let decision = "NO_TRADE";
    let confidence: number | null = null;
    let modelVersion = "no_market_evidence";
    let provenance: ReasoningProvenance | null = null;

    if (!marketState) {
      // Insufficient evidence → safe no-op. No LLM call, no fabrication.
      provenance = {
        decision: "NO_TRADE",
        confidence: 0,
        evidence: hierarchy.evidence.map((e) => `${e.source}: ${e.label}`),
        riskFactors: runtimeInitError ? [runtimeInitError] : [],
        rationaleSummary:
          "Insufficient market evidence available for a reasoning pass. Safe no-op: NO_TRADE.",
        modelVersion,
        timestamp: new Date().toISOString(),
      };
    } else {
      const RouterModule = await import("./llm/router");
      const router = options.router ?? new RouterModule.AIRouter();
      const routerResult = await router.route(
        marketState,
        null,
        null,
        memoryContext,
        null,
        null,
      );
      decision = routerResult.decision.direction;
      confidence = routerResult.decision.confidence;
      modelVersion =
        routerResult.provider === "safe_fallback"
          ? "safe_fallback"
          : `llm-${routerResult.provider}`;

      provenance = buildReasoningProvenance({
        decision: {
          direction: routerResult.decision.direction,
          confidence: routerResult.decision.confidence,
          strategy: routerResult.decision.strategy,
          symbol: marketState.symbol,
          modelVersion,
          timestamp: marketState.timestamp,
          marketRegime: marketState.marketRegime,
          evidence: evidenceFromMarketState(marketState),
        },
        riskFactors:
          routerResult.decision.reasoning.length > 0
            ? [routerResult.decision.reasoning.slice(0, 200)]
            : [],
      });
    }

    // ── 5. CONTROLLED ACTION (registry default-deny; READ_ONLY only) ──
    const { executeControlledAction } = await import("../api/controlled-actions");
    // Exactly one attempt — bounded, no retry, no recursion.
    const actionResult = await executeControlledAction(controlledActionId);

    const actionStatus = actionResult.decision.resultStatus; // NOT_RUN/OK/ERROR/DENIED
    const verificationStatus: AutonomousCycleResult["verificationStatus"] =
      actionStatus === "OK" ? "VERIFIED" : actionStatus === "DENIED" ? "DENIED" : "FAILED";

    // ── 6. EXPERIENCE / RECORDING (existing journal, no second journal) ──
    const { recordJournalEvent } = await import("../journal");
    let journalRecorded = false;
    try {
      recordJournalEvent({
        eventType: "ANALYSIS",
        importance: actionStatus === "OK" ? "LOW" : "MEDIUM",
        message: `Autonomous cycle ${cycleId}: decision ${decision} (${modelVersion})`,
        reasoning: provenance?.rationaleSummary ?? undefined,
        details: {
          cycleId,
          agentId: AUTONOMOUS_AGENT_ID,
          status: "EXPERIENCE_RECORDED", // recording, not claimed as ML learning
          decision,
          confidence,
          modelVersion,
          evidenceCount,
          actionId: controlledActionId,
          actionStatus,
          verificationStatus,
        },
      });
      journalRecorded = true;
    } catch (err) {
      logger.error("autonomous-cycle", `Journal record failed for ${cycleId}: ${err}`);
      journalRecorded = false;
    }

    // ── 7. Result ────────────────────────────────────────────────────
    logger.info(
      "autonomous-cycle",
      `Cycle ${cycleId}: ${decision} (${modelVersion}) action=${actionStatus} verified=${verificationStatus}`,
    );

    let status: AutonomousCycleStatus;
    if (!marketState) {
      status = "NO_TRADE_INSUFFICIENT_EVIDENCE";
    } else if (actionStatus === "DENIED") {
      status = "COMPLETED_WITH_DENIED_ACTION";
    } else if (actionStatus === "ERROR") {
      status = "COMPLETED_WITH_FAILED_ACTION";
    } else {
      status = "COMPLETED";
    }

    return finish({
      status,
      reason,
      evidenceCount,
      decision,
      confidence,
      modelVersion,
      actionId: controlledActionId,
      actionStatus: actionStatus as AutonomousCycleResult["actionStatus"],
      verificationStatus,
      provenance,
      actionResult,
      journalRecorded,
      observed: {
        runtimeRunning,
        databaseReady,
        runtimeInitialized,
        executionMode: snapshot.stats.executionMode,
        marketAvailable,
        marketSymbols,
        riskTradingEnabled: orchestrator
          ? orchestrator.getRiskEngine().isTradingEnabled()
          : false,
        providersConfigured: providers.length,
      },
    });
  } catch (err) {
    // Fail-closed: record the failure category safely, never the payload.
    const code = (err as { code?: string })?.code ?? "CYCLE_ERROR";
    logger.error("autonomous-cycle", `Cycle ${cycleId} failed category=${code}`);
    return finish({
      status: "FAILED",
      reason: "CYCLE_INTERNAL_ERROR",
      evidenceCount: 0,
      decision: "NO_TRADE",
      confidence: null,
      modelVersion: "failed",
      actionId: null,
      actionStatus: "NOT_RUN",
      verificationStatus: "NOT_RUN",
      provenance: null,
      actionResult: null,
      journalRecorded: false,
      observed: {
        runtimeRunning: false,
        databaseReady: false,
        runtimeInitialized: false,
        executionMode: null,
        marketAvailable: false,
        marketSymbols: 0,
        riskTradingEnabled: false,
        providersConfigured: 0,
      },
    });
  } finally {
    _cycleInFlight = false;
    void startedMs;
  }
}

/** Public entry honoring the in-flight guard (alias of runAutonomousCycle). */
export function maybeRunAutonomousCycle(
  options: AutonomousCycleOptions = {},
): Promise<AutonomousCycleResult> {
  return runAutonomousCycle(options);
}

// ─── Integration with the EXISTING decision scheduler ────────────────
// No second scheduler is created. This wires the cycle as the callback of
// the already-present decision-scheduler (which owns throttle + in-flight
// protection). Not auto-started at boot — an integration/server owner calls
// startAutonomousLoop() to begin the autonomous cadence.

// ─── Production loop lifecycle (Phase 3.8-D.5) ────────────────────────
// START → RUNNING → STOPPING → STOPPED. No duplicate start (guard), no
// timers left on stop (scheduler shutdown clears its timers).

export type AutonomousLoopStatus = "STOPPED" | "RUNNING" | "STOPPING";

type AutonomousLoopObservability = {
  status: AutonomousLoopStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  lastCycleAt: string | null;
  lastCycleId: string | null;
  lastCycleStatus: AutonomousCycleStatus | null;
  cyclesCompleted: number;
  cyclesSkipped: number;
  runtimeLoopAlive: boolean;
  tradingEnabled: false; // hard rule — the loop is READ-ONLY on D.5
};

let _loopStatus: AutonomousLoopStatus = "STOPPED";
let _loopStartedAt: string | null = null;
let _loopStoppedAt: string | null = null;

/** Whether the production autonomous loop is currently RUNNING. */
export function isAutonomousLoopActive(): boolean {
  return _loopStatus === "RUNNING";
}

/** Safe observability snapshot — no credentials, no raw payloads. */
export function getAutonomousLoopStatus(): AutonomousLoopObservability {
  return {
    status: _loopStatus,
    startedAt: _loopStartedAt,
    stoppedAt: _loopStoppedAt,
    lastCycleAt: _lastResult?.completedAt ?? null,
    lastCycleId: _lastResult?.cycleId ?? null,
    lastCycleStatus: _lastResult?.status ?? null,
    cyclesCompleted: _totalCycles,
    cyclesSkipped: _skippedCycles,
    runtimeLoopAlive: _loopStatus === "RUNNING",
    tradingEnabled: false,
  };
}

/**
 * Production boot guard (fail-closed): the autonomous loop may ONLY start
 * when database init succeeded, runtime init succeeded, and no boot error
 * is present. If initialization failed, the loop must not run.
 */
export function shouldStartAutonomousLoop(input: {
  databaseReady: boolean;
  runtimeInitialized: boolean;
  bootError: string | null;
}): boolean {
  if (input.bootError !== null && input.bootError.length > 0) return false;
  return input.databaseReady && input.runtimeInitialized;
}

export function startAutonomousLoop(
  options: { throttleMs?: number; controlledActionId?: string; router?: AIRouter } = {},
): void {
  // Guard: no duplicate scheduler/loop (restart-safe).
  if (_loopStatus === "RUNNING") {
    logger.warn("autonomous-loop", "Loop already RUNNING — ignoring duplicate start");
    return;
  }
  _loopStatus = "RUNNING";
  _loopStartedAt = new Date().toISOString();
  _loopStoppedAt = null;
  initializeScheduler(
    async (trigger) => {
      await maybeRunAutonomousCycle({
        reason: `SCHEDULER:${trigger.reason}`,
        ...(options.controlledActionId ? { controlledActionId: options.controlledActionId } : {}),
        ...(options.router ? { router: options.router } : {}),
      });
    },
    options.throttleMs ?? 30_000,
  );
  logger.info("autonomous-loop", `Started (throttle=${options.throttleMs ?? 30_000}ms) — READ-ONLY`);
}

export function stopAutonomousLoop(): void {
  if (_loopStatus === "STOPPED" || _loopStatus === "STOPPING") return;
  _loopStatus = "STOPPING";
  // Existing scheduler shutdown semantics: clears timers, drops callback;
  // any in-flight cycle finishes on its own (bounded, no new triggers).
  shutdownScheduler();
  _loopStatus = "STOPPED";
  _loopStoppedAt = new Date().toISOString();
  logger.info("autonomous-loop", "Stopped");
}

/**
 * Test/observability reset for the loop lifecycle (never called in prod).
 */
export function resetAutonomousLoopState(): void {
  stopAutonomousLoop();
  _loopStartedAt = null;
  _loopStoppedAt = null;
  resetAutonomousCycleState();
}
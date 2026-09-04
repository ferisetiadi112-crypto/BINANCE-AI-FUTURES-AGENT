/**
 * Agent Status — lightweight monitoring endpoint
 *
 * Single aggregate that answers everything the main monitoring screen
 * needs in ONE call:
 *   1. Is the AI online?
 *   2. What is it doing right now?
 *   3. What did it find?
 *   4. What decision did it make?
 *   5. What action did it take?
 *   6. What position is open?
 *   7. What is today's PnL?
 *   8. Is there an error requiring attention?
 *
 * HARD CONSTRAINTS:
 * - In-memory sources only (runtime singleton, orchestrator state,
 *   exchange snapshot, journal ring buffer).
 * - NO database queries, NO Binance REST calls, NO heavy computation.
 * - recentActivity is capped at 10 events — never the full journal.
 */

import { createServerFn } from "@tanstack/react-start";
import { getOrchestrator, getRuntimeSnapshot, isRuntimeRunning } from "../trading/runtime";
import type { TradingOrchestrator } from "../trading/orchestrator";
import type { RuntimeSnapshot } from "../trading/runtime";
import { getRecentJournalEvents } from "../journal";
import { getExchangeSnapshot } from "../exchange/unified-state";
import { isRuntimeInitialized, getRuntimeInitError } from "../../server";
import type { ApiResponse } from "../../types/api";

// ─── Payload ───────────────────────────────────────────────────────

export type AgentStatusPayload = {
  status: "RUNNING" | "STARTING" | "OFFLINE" | "ERROR";
  executionMode: string;
  tradingEnabled: boolean;
  /** What the agent is doing right now, e.g. "Analyzing BTCUSDT" */
  currentTask: string | null;
  /** Latest meaningful market finding in plain language */
  finding: string | null;
  /** LONG / SHORT / WAIT / CLOSE */
  decision: string | null;
  /** Why the decision/action happened */
  reason: string | null;
  /** What actually happened, e.g. "No trade executed" */
  action: string | null;
  confidence: number | null;
  position: {
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    leverage: number;
  } | null;
  pnlToday: number;
  tradeCountToday: number;
  lastUpdate: string | null;
  error: string | null;
  recentActivity: Array<{
    timestamp: number;
    eventType: string;
    message: string;
  }>;
};

export const AGENT_ACTIVITY_LIMIT = 10;

// ─── Pure builder (exported for tests) ─────────────────────────────

export function buildAgentStatus(input: {
  orchestrator: TradingOrchestrator | null;
  runtimeRunning: boolean;
  runtime: RuntimeSnapshot;
  runtimeInitialized: boolean;
  runtimeInitError: string | null;
  activity: Array<{ timestamp: number; eventType: string; message: string }>;
  exchangePositions: Array<{
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    leverage: number;
  }>;
}): AgentStatusPayload {
  const {
    orchestrator,
    runtimeRunning,
    runtime,
    runtimeInitialized,
    runtimeInitError,
    activity,
    exchangePositions,
  } = input;

  if (!orchestrator || !runtimeRunning) {
    return {
      status: runtimeInitError ? "ERROR" : runtimeInitialized ? "OFFLINE" : "STARTING",
      executionMode: runtime.stats.executionMode,
      tradingEnabled: false,
      currentTask: null,
      finding: null,
      decision: null,
      reason: null,
      action: null,
      confidence: null,
      position: null,
      pnlToday: 0,
      tradeCountToday: 0,
      lastUpdate: null,
      error: runtimeInitError,
      recentActivity: activity,
    };
  }

  const state = orchestrator.getState();
  const riskStats = orchestrator.getDailyStats();
  const decision = state.lastDecision;

  // ── Current task: derived from the latest runtime event / tick ──
  let currentTask: string | null = null;
  const lastEvent =
    runtime.recentEvents.length > 0 ? runtime.recentEvents[runtime.recentEvents.length - 1]! : null;
  if (lastEvent && lastEvent.feedState === "ONLINE") {
    currentTask = `Analyzing ${lastEvent.symbol}`;
  } else if (runtime.stats.lastTickAt > 0) {
    currentTask = "Analyzing market data";
  } else {
    currentTask = "Waiting for first market update";
  }

  // ── Finding: plain-language summary of the latest decision evidence ──
  let finding: string | null = null;
  if (decision) {
    const e = decision.evidence;
    finding = `${e.trend} trend, ${e.momentum} momentum (${decision.marketRegime} regime)`;
  }

  // ── Decision: map internal direction to the monitor vocabulary ──
  let decisionLabel: string | null = null;
  if (decision) {
    decisionLabel = decision.direction === "NO_TRADE" ? "WAIT" : decision.direction;
  }

  // ── Action: what actually happened after the risk gate ──
  let action: string | null = null;
  if (decision) {
    if (decision.direction === "NO_TRADE") {
      action = "No trade executed";
    } else if (decision.executionResult === "EXECUTED") {
      action = `Trade executed (${decision.direction} ${decision.symbol})`;
    } else if (decision.executionResult === "REJECTED" || decision.riskResult === "REJECTED") {
      action = "Trade rejected by risk engine";
    } else {
      action = "No trade executed";
    }
  }

  const reason = state.lastRiskResult?.reason ?? decision?.riskReason ?? null;

  // ── Position: TESTNET reads the in-memory exchange snapshot,
  //    PAPER reads the paper engine — neither touches the network ──
  let position: AgentStatusPayload["position"] = null;
  if (state.executionMode === "TESTNET") {
    const p = exchangePositions[0];
    if (p) position = { ...p };
  } else {
    const p = orchestrator.getPaperEngine().getPosition();
    if (p && p.side !== "FLAT") {
      position = {
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unrealizedPnl: p.unrealizedPnl,
        leverage: p.leverage,
      };
    }
  }

  // ── Error: only surfaces when attention is genuinely required ──
  let error: string | null = null;
  if (runtimeInitError) {
    error = runtimeInitError;
  } else if (state.consecutiveSyncFailures > 0 && state.connectionError) {
    error = `Exchange sync failing: ${state.connectionError}`;
  } else if (riskStats.locked && riskStats.lockReason) {
    error = `Trading locked: ${riskStats.lockReason}`;
  }

  const lastUpdateMs = Math.max(
    runtime.stats.lastTickAt,
    lastEvent?.timestamp ?? 0,
    decision?.timestamp ?? 0,
  );

  return {
    status: "RUNNING",
    executionMode: state.executionMode,
    tradingEnabled: orchestrator.getRiskEngine().isTradingEnabled(),
    currentTask,
    finding,
    decision: decisionLabel,
    reason,
    action,
    confidence: decision ? Math.round(decision.confidence * 100) : null,
    position,
    pnlToday: riskStats.pnl,
    tradeCountToday: riskStats.trades,
    lastUpdate: lastUpdateMs > 0 ? new Date(lastUpdateMs).toISOString() : null,
    error,
    recentActivity: activity,
  };
}

// ─── Server function ───────────────────────────────────────────────

export const getAgentStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ApiResponse<AgentStatusPayload>> => {
    const orchestrator = getOrchestrator();
    const activity = getRecentJournalEvents(AGENT_ACTIVITY_LIMIT).map((e) => ({
      timestamp: e.timestamp,
      eventType: e.eventType,
      message: e.message,
    }));
    const payload = buildAgentStatus({
      orchestrator,
      runtimeRunning: isRuntimeRunning(),
      runtime: getRuntimeSnapshot(),
      runtimeInitialized: isRuntimeInitialized(),
      runtimeInitError: getRuntimeInitError(),
      activity,
      exchangePositions:
        orchestrator?.getState().executionMode === "TESTNET" ? getExchangeSnapshot().positions : [],
    });
    return {
      data: payload,
      timestamp: new Date().toISOString(),
      source: "live",
    };
  },
);

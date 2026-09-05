/**
 * Phase 3.7 — Runtime lifecycle & journal semantics focused tests.
 *
 * A. orchestrator exists but no recent tick → NOT "RUNNING" (STALE/STARTING)
 * B. recent successful tick → RUNNING
 * C. feed offline → runtime status and market data status remain distinct
 * D. startup remote-only reconciliation → NOT POSITION_OPENED
 * E. actual executor-created position event → POSITION_OPENED remains valid
 * F. no fabricated margin (reconciliation event carries the real remote value)
 * G. no fabricated AI decision (stale runtime → null decision fields)
 * H. TRADING_ENABLED gating untouched — executor never invoked from these paths
 */
import { describe, expect, it } from "vitest";
import { buildAgentStatus, type AgentActivityItem } from "../api/agent-status";
import { recordPositionOpened, recordRemotePositionDiscovered } from "../journal";
import { STALE_TICK_THRESHOLD_MS } from "./runtime";

const TICK_INTERVAL_MS = 15_000;

function makeStatusInput(lastTickAt: number) {
  const orchestrator = {
    getState: () => ({
      executionMode: "TESTNET" as const,
      lastDecision: null,
      lastRiskResult: null,
      testnetReady: true,
      reconciliationComplete: true,
      connectionError: null,
      consecutiveSyncFailures: 0,
    }),
    getDailyStats: () => ({ pnl: 0, trades: 0, locked: false, lockReason: null }),
    getPaperEngine: () => ({ getPosition: () => null }),
    getRiskEngine: () => ({ isTradingEnabled: () => false }),
  } as never as Parameters<typeof buildAgentStatus>[0]["orchestrator"];

  return {
    orchestrator,
    runtimeRunning: true,
    runtime: {
      running: true,
      tickIntervalMs: TICK_INTERVAL_MS,
      stats: {
        tickCount: 5,
        totalProcessed: 0,
        totalSkipped: 0,
        totalErrors: 0,
        totalDecisions: 0,
        totalNoTrade: 0,
        totalRiskRejected: 0,
        totalPaperExecutions: 0,
        totalTestnetExecutions: 0,
        lastTickAt,
        startedAt: Date.now() - 60_000,
        executionMode: "TESTNET" as const,
        testnetReady: true,
      },
      perSymbol: [],
      recentEvents: [],
      eventBufferLimit: 100,
    },
    runtimeInitialized: true,
    runtimeInitError: null,
    activity: [] as AgentActivityItem[],
    exchangePositions: [],
  };
}

describe("Phase 3.7 — truthful runtime status", () => {
  it("A. orchestrator exists but no recent tick → NOT RUNNING (stale loop shows STARTING)", () => {
    const staleTick = Date.now() - STALE_TICK_THRESHOLD_MS - 1_000;
    const result = buildAgentStatus(makeStatusInput(staleTick));
    expect(result.status).not.toBe("RUNNING");
  });

  it("B. recent successful tick → RUNNING", () => {
    const recentTick = Date.now() - 1_000;
    const result = buildAgentStatus(makeStatusInput(recentTick));
    expect(result.status).toBe("RUNNING");
  });

  it("C. feed offline (stale tick) degrades currentTask but runtime status is computed independently", () => {
    const staleTick = Date.now() - STALE_TICK_THRESHOLD_MS - 5_000;
    const result = buildAgentStatus(makeStatusInput(staleTick));
    // Market data status is separate: no fake "Analyzing <symbol>" online claim
    expect(result.currentTask).not.toMatch(/^Analyzing [A-Z]/);
    expect(result.decision).toBeNull();
    expect(result.finding).toBeNull();
  });

  it("G. no fabricated AI decision on a stale runtime", () => {
    const staleTick = Date.now() - STALE_TICK_THRESHOLD_MS - 5_000;
    const result = buildAgentStatus(makeStatusInput(staleTick));
    expect(result.decision).toBeNull();
    expect(result.reason).toBeNull();
    expect(result.action).toBeNull();
  });

  it("H. tradingEnabled always false when risk engine has trading disabled", () => {
    const recentTick = Date.now() - 1_000;
    const result = buildAgentStatus(makeStatusInput(recentTick));
    expect(result.tradingEnabled).toBe(false);
  });
});

describe("Phase 3.7 — journal semantics", () => {
  it("D. remote-only reconciliation → STARTUP_RECONCILIATION, never POSITION_OPENED", () => {
    const evt = recordRemotePositionDiscovered("SNTUSDT", "SHORT", 0, 20);
    expect(evt.eventType).toBe("STARTUP_RECONCILIATION");
    expect(evt.eventType).not.toBe("POSITION_OPENED");
    expect(evt.message).toContain("not an AI order");
  });

  it("E. actual executor position event → POSITION_OPENED remains valid", () => {
    const evt = recordPositionOpened("BTCUSDT", "LONG", 10, 20);
    expect(evt.eventType).toBe("POSITION_OPENED");
  });

  it("F. no fabricated margin — real remote value (0) carried verbatim, message states it", () => {
    const evt = recordRemotePositionDiscovered("QUSDT", "SHORT", 0, 20);
    expect(evt.position?.margin).toBe(0);
    expect(evt.message).toContain("margin: $0.00");
  });
});

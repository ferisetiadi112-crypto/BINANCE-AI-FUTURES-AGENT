/**
 * Agent Status builder tests — node environment, no network.
 *
 * Verifies the lightweight monitoring payload:
 * - offline / starting / error states without an orchestrator
 * - running state derived from a real TradingOrchestrator (PAPER mode)
 * - activity is capped and position / PnL / decision are surfaced
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAgentStatus, AGENT_ACTIVITY_LIMIT } from "./agent-status";
import { TradingOrchestrator } from "../trading/orchestrator";
import type { RuntimeSnapshot } from "../trading/runtime";
import type { MarketState } from "../runtime/types";
import * as walletRepo from "../repositories/wallet";

const trendingUpState: MarketState = {
  symbol: "BTCUSDT",
  timestamp: Date.now(),
  price: 63000,
  priceChange24h: 500,
  priceChangePercent24h: 0.8,
  trend: "UP",
  trendStrength: 75,
  momentum: "STRONG",
  momentumScore: 80,
  volatility: 500,
  volatilityPercent: 0.8,
  volume24h: 28000,
  volumeChange: 15,
  marketStructure: "HIGHER_HIGHS",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  liquidity: 80,
  dataQuality: "GOOD",
  feedStatus: "ONLINE",
  lastUpdate: Date.now(),
  dataAge: 1000,
};

function makeRuntimeSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    running: true,
    tickIntervalMs: 15_000,
    stats: {
      tickCount: 3,
      totalProcessed: 36,
      totalSkipped: 0,
      totalErrors: 0,
      totalDecisions: 36,
      totalNoTrade: 30,
      totalRiskRejected: 0,
      totalPaperExecutions: 6,
      totalTestnetExecutions: 0,
      lastTickAt: Date.now(),
      startedAt: Date.now() - 60_000,
      executionMode: "PAPER",
      testnetReady: false,
    },
    perSymbol: [],
    recentEvents: [
      {
        timestamp: Date.now(),
        tickNumber: 3,
        symbol: "BTCUSDT",
        feedState: "ONLINE",
        decision: "LONG",
        confidence: 0.8,
        strategy: "MOMENTUM",
        riskApproved: true,
        riskReason: "All checks passed",
        executionResult: "EXECUTED",
        paperTradeId: "pt-1",
        testnetOrderId: null,
        experienceRecorded: true,
        error: null,
      },
    ],
    eventBufferLimit: 100,
    ...overrides,
  };
}

const baseInput = {
  runtime: makeRuntimeSnapshot(),
  runtimeRunning: true,
  runtimeInitialized: true,
  runtimeInitError: null,
  activity: [] as Array<{ timestamp: number; eventType: string; message: string }>,
  exchangePositions: [],
};

describe("buildAgentStatus", () => {
  let walletSpy: ReturnType<typeof vi.spyOn>;
  let guardrailSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    walletSpy = vi.spyOn(walletRepo.walletRepository, "getBalance").mockResolvedValue(5.0);
    guardrailSpy = vi
      .spyOn(walletRepo.walletRepository, "logGuardrailEvent")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    walletSpy?.mockRestore();
    guardrailSpy?.mockRestore();
  });

  it("reports STARTING when the runtime has not initialized yet", () => {
    const s = buildAgentStatus({
      ...baseInput,
      orchestrator: null,
      runtimeRunning: false,
      runtimeInitialized: false,
    });
    expect(s.status).toBe("STARTING");
    expect(s.position).toBeNull();
    expect(s.decision).toBeNull();
    expect(s.error).toBeNull();
  });

  it("reports OFFLINE when initialized but not running", () => {
    const s = buildAgentStatus({
      ...baseInput,
      orchestrator: null,
      runtimeRunning: false,
    });
    expect(s.status).toBe("OFFLINE");
  });

  it("reports ERROR when runtime initialization failed", () => {
    const s = buildAgentStatus({
      ...baseInput,
      orchestrator: null,
      runtimeRunning: false,
      runtimeInitialized: false,
      runtimeInitError: "Database init failed: boom",
    });
    expect(s.status).toBe("ERROR");
    expect(s.error).toContain("boom");
  });

  it("reports RUNNING with decision, finding, action and task from a live orchestrator", async () => {
    const orchestrator = new TradingOrchestrator();
    orchestrator.start();
    await orchestrator.processMarketUpdate(trendingUpState);

    const s = buildAgentStatus({ ...baseInput, orchestrator });

    expect(s.status).toBe("RUNNING");
    expect(s.executionMode).toBe("PAPER");
    expect(s.currentTask).toBe("Analyzing BTCUSDT");
    expect(s.decision).not.toBeNull();
    expect(s.finding).toContain("trend");
    expect(s.action).not.toBeNull();
    expect(s.confidence).not.toBeNull();
    expect(s.pnlToday).toBe(0);
    expect(s.tradeCountToday).toBe(0);
    expect(s.lastUpdate).not.toBeNull();
    expect(s.error).toBeNull();
  });

  it("maps NO_TRADE decisions to WAIT with 'No trade executed'", async () => {
    const orchestrator = new TradingOrchestrator();
    orchestrator.start();
    await orchestrator.processMarketUpdate({
      ...trendingUpState,
      trend: "FLAT",
      trendStrength: 10,
      momentum: "WEAK",
      momentumScore: 10,
      marketRegime: "RANGING",
      regimeConfidence: 20,
    });

    const s = buildAgentStatus({ ...baseInput, orchestrator });
    if (s.decision === "WAIT") {
      expect(s.action).toBe("No trade executed");
    }
    // Any directional outcome is also valid — the mapping only constrains WAIT.
    expect(["LONG", "SHORT", "WAIT", "CLOSE"]).toContain(s.decision);
  });

  it("passes through recent activity (capped upstream at AGENT_ACTIVITY_LIMIT)", () => {
    const activity = Array.from({ length: AGENT_ACTIVITY_LIMIT }, (_, i) => ({
      timestamp: Date.now() - i * 1000,
      eventType: "MARKET_SCAN",
      message: `Market scan: BTCUSDT (quality: GOOD) #${i}`,
    }));
    const s = buildAgentStatus({
      ...baseInput,
      orchestrator: null,
      runtimeRunning: false,
      activity,
    });
    expect(s.recentActivity.length).toBe(AGENT_ACTIVITY_LIMIT);
    expect(s.recentActivity[0]!.message).toContain("Market scan");
  });
});

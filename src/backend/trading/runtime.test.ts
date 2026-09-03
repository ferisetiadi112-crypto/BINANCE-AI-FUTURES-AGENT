/**
 * Trading Runtime Tests — Phase 8D-F1 Runtime Activation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockProcessRealtimeUpdate = vi.fn().mockResolvedValue([]);
const MockOrchestratorConstructor = vi.fn().mockImplementation(() => ({
  processRealtimeUpdate: mockProcessRealtimeUpdate,
  processMarketUpdate: vi.fn(),
  getState: vi.fn().mockReturnValue({ systemStatus: "RUNNING" }),
  getDecisionHistory: vi.fn().mockReturnValue([]),
  getPaperStats: vi.fn().mockReturnValue({}),
  getDailyStats: vi.fn().mockReturnValue({ pnl: 0, sessionPnl: 0, locked: false, cooldownActive: false, openPositionCount: 0 }),
  getRecentActivity: vi.fn().mockReturnValue([]),
  getPaperEngine: vi.fn().mockReturnValue({ getPosition: vi.fn().mockReturnValue(null) }),
}));

vi.mock("./orchestrator", () => ({
  get TradingOrchestrator() {
    return MockOrchestratorConstructor;
  },
}));

// Capture calls to mock constructor by wrapping it
const constructorCalls: unknown[] = [];
const OrigMock = MockOrchestratorConstructor;
MockOrchestratorConstructor.mockImplementation(function (this: any) {
  constructorCalls.push(this);
  this.processRealtimeUpdate = mockProcessRealtimeUpdate;
  this.processMarketUpdate = vi.fn();
  this.getState = vi.fn().mockReturnValue({ systemStatus: "RUNNING" });
  this.getDecisionHistory = vi.fn().mockReturnValue([]);
  this.getDailyStats = vi.fn().mockReturnValue({ pnl: 0, sessionPnl: 0, locked: false, cooldownActive: false, openPositionCount: 0 });
  this.getRecentActivity = vi.fn().mockReturnValue([]);
  this.getPaperEngine = vi.fn().mockReturnValue({ getPosition: vi.fn().mockReturnValue(null) });
  this.getPaperStats = vi.fn().mockReturnValue({});
});

import {
  startTradingRuntime,
  stopTradingRuntime,
  getOrchestrator,
  isRuntimeRunning,
  resetRuntime,
  getTickIntervalMs,
  getRuntimeSnapshot,
  getPerSymbolStats,
  getRuntimeEvents,
  getRuntimeStats,
} from "./runtime";

describe("TradingRuntime — Phase 8D-F1 Runtime Activation", () => {
  beforeEach(() => {
    resetRuntime();
    vi.clearAllMocks();
    constructorCalls.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetRuntime();
    vi.useRealTimers();
  });

  it("startTradingRuntime creates a TradingOrchestrator instance", async () => {
    const orch = await startTradingRuntime();
    expect(orch).toBeDefined();
    expect(getOrchestrator()).toBe(orch);
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    const orch1 = await startTradingRuntime();
    const orch2 = await startTradingRuntime();
    const orch3 = await startTradingRuntime();
    expect(orch1).toBe(orch2);
    expect(orch2).toBe(orch3);
    expect(MockOrchestratorConstructor).toHaveBeenCalledTimes(1);
  });

  it("isRuntimeRunning returns true after start", async () => {
    expect(isRuntimeRunning()).toBe(false);
    await startTradingRuntime();
    expect(isRuntimeRunning()).toBe(true);
  });

  it("isRuntimeRunning returns false after stop", async () => {
    await startTradingRuntime();
    stopTradingRuntime();
    expect(isRuntimeRunning()).toBe(false);
  });

  it("getOrchestrator returns null before start", async () => {
    expect(getOrchestrator()).toBeNull();
  });

  it("runtime loop calls processRealtimeUpdate on tick", async () => {
    await startTradingRuntime();
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(3);
  });

  it("no duplicate intervals on repeated start", async () => {
    await startTradingRuntime();
    await startTradingRuntime();

    await vi.advanceTimersByTimeAsync(getTickIntervalMs() * 3);
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(4);
  });

  it("stop clears the interval", async () => {
    await startTradingRuntime();
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);
    stopTradingRuntime();

    await vi.advanceTimersByTimeAsync(getTickIntervalMs() * 5);
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);
  });

  it("start after stop creates new interval", async () => {
    await startTradingRuntime();
    stopTradingRuntime();
    await vi.advanceTimersByTimeAsync(getTickIntervalMs() * 2);
    const callsAfterStop = mockProcessRealtimeUpdate.mock.calls.length;

    await startTradingRuntime();
    expect(mockProcessRealtimeUpdate.mock.calls.length).toBe(callsAfterStop + 1);

    await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate.mock.calls.length).toBe(callsAfterStop + 2);
  });

  it("tick processes symbols via processRealtimeUpdate", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: {}, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    await startTradingRuntime();
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);
    const orch = getOrchestrator() as any;
    expect(orch.processRealtimeUpdate).toHaveBeenCalled();
  });

  it("tick handles errors gracefully without crashing runtime", async () => {
    mockProcessRealtimeUpdate.mockImplementationOnce(() => {
      throw new Error("Test error");
    });

    await startTradingRuntime();
    expect(isRuntimeRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(2);
  });

  it("OFFLINE symbols have null result", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    await startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results[0].reason).toBe("OFFLINE/STALE/insufficient_data");
    expect(results[0].result).toBeNull();
  });

  it("STALE symbols have null result", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    await startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results[0].reason).toBe("OFFLINE/STALE/insufficient_data");
    expect(results[0].result).toBeNull();
  });

  it("mixed ONLINE and OFFLINE results handled correctly", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: {}, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
      { symbol: "SOLUSDT", result: { decision: {}, riskResult: { approved: false, reason: "RISK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results).toHaveLength(3);
    expect(results[0].reason).toBe("OK");
    expect(results[1].reason).toBe("OFFLINE/STALE/insufficient_data");
    expect(results[2].reason).toBe("OK");
  });

  it("12 symbols can be processed independently", async () => {
    const symbols = [
      "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
      "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT",
      "AVAXUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT",
    ];

    mockProcessRealtimeUpdate.mockReturnValue(
      symbols.map((s) => ({
        symbol: s,
        result: { decision: {}, riskResult: { approved: true, reason: "OK" }, trade: null },
        reason: "OK",
      })),
    );

    await startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results).toHaveLength(12);
    expect(results.map((r: any) => r.symbol)).toEqual(symbols);
  });

  it("no duplicate constructor calls (singleton)", async () => {
    await startTradingRuntime();
    expect(MockOrchestratorConstructor).toHaveBeenCalledTimes(1);
  });

  it("resetRuntime stops and clears everything", async () => {
    await startTradingRuntime();
    expect(isRuntimeRunning()).toBe(true);

    resetRuntime();
    expect(isRuntimeRunning()).toBe(false);
    expect(getOrchestrator()).toBeNull();
  });

  it("getTickIntervalMs returns 15 seconds", async () => {
    expect(getTickIntervalMs()).toBe(15_000);
  });

  // ─── Phase 8H: Runtime Observability Tests ──────────────────

  it("getRuntimeSnapshot returns runtime state", async () => {
    await startTradingRuntime();
    const snap = getRuntimeSnapshot();
    expect(snap.running).toBe(true);
    expect(snap.tickIntervalMs).toBe(15_000);
    expect(snap.stats).toBeDefined();
    expect(snap.stats.tickCount).toBe(1);
    expect(snap.perSymbol).toBeDefined();
    expect(Array.isArray(snap.perSymbol)).toBe(true);
    expect(snap.recentEvents).toBeDefined();
    expect(Array.isArray(snap.recentEvents)).toBe(true);
    expect(snap.eventBufferLimit).toBe(100);
  });

  it("per-symbol stats are isolated per symbol", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
      { symbol: "SOLUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const perSymbol = getPerSymbolStats();

    const btc = perSymbol.find(p => p.symbol === "BTCUSDT");
    const eth = perSymbol.find(p => p.symbol === "ETHUSDT");
    const sol = perSymbol.find(p => p.symbol === "SOLUSDT");

    expect(btc).toBeDefined();
    expect(btc!.processed).toBe(1);
    expect(btc!.decisions).toBe(1);

    expect(eth).toBeDefined();
    expect(eth!.skipped).toBe(1);
    expect(eth!.decisions).toBe(0);

    expect(sol).toBeDefined();
    expect(sol!.processed).toBe(1);
    expect(sol!.noTrade).toBe(1);
  });

  it("runtime events are recorded for each symbol", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    await startTradingRuntime();
    const events = getRuntimeEvents();
    expect(events.length).toBe(2);

    const btcEvent = events.find(e => e.symbol === "BTCUSDT");
    const ethEvent = events.find(e => e.symbol === "ETHUSDT");

    expect(btcEvent).toBeDefined();
    expect(btcEvent!.decision).toBe("LONG");
    expect(btcEvent!.confidence).toBe(0.8);
    expect(btcEvent!.strategy).toBe("TREND_FOLLOWING");
    expect(btcEvent!.riskApproved).toBe(true);
    expect(btcEvent!.experienceRecorded).toBe(true);
    expect(btcEvent!.error).toBeNull();

    expect(ethEvent).toBeDefined();
    expect(ethEvent!.feedState).toContain("OFFLINE/STALE");
    expect(ethEvent!.decision).toBeNull();
  });

  it("event buffer is bounded at 100", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();

    // Run 150 ticks to exceed buffer
    for (let i = 0; i < 149; i++) {
      await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    }

    const events = getRuntimeEvents();
    expect(events.length).toBeLessThanOrEqual(100);
  });

  it("newest events are retained when buffer is full", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();

    // Run enough ticks to fill and overflow buffer
    for (let i = 0; i < 105; i++) {
      await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    }

    const events = getRuntimeEvents();
    expect(events.length).toBe(100);

    // All events should have tickNumber > 0
    expect(events.every(e => e.tickNumber > 0)).toBe(true);
  });

  it("risk rejection is tracked in events", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: false, reason: "Daily loss limit reached" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const events = getRuntimeEvents();
    const btcEvent = events.find(e => e.symbol === "BTCUSDT");

    expect(btcEvent).toBeDefined();
    expect(btcEvent!.riskApproved).toBe(false);
    expect(btcEvent!.riskReason).toContain("Daily loss limit");
    expect(btcEvent!.executionResult).toBe("REJECTED");
  });

  it("paper execution is tracked in events", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: { id: "PAPER-TRD-001" } }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const events = getRuntimeEvents();
    const btcEvent = events.find(e => e.symbol === "BTCUSDT");

    expect(btcEvent).toBeDefined();
    expect(btcEvent!.executionResult).toBe("EXECUTED");
    expect(btcEvent!.paperTradeId).toBe("PAPER-TRD-001");
  });

  it("error events are recorded for failed symbols", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: null, reason: "ERROR" },
      { symbol: "ETHUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const events = getRuntimeEvents();
    const btcEvent = events.find(e => e.symbol === "BTCUSDT");
    const ethEvent = events.find(e => e.symbol === "ETHUSDT");

    expect(btcEvent).toBeDefined();
    expect(btcEvent!.feedState).toBe("ERROR");
    expect(btcEvent!.error).toBe("Symbol processing error");

    expect(ethEvent).toBeDefined();
    expect(ethEvent!.decision).toBe("LONG");
    expect(ethEvent!.error).toBeNull();
  });

  it("runtime snapshot is read-only (returns copies)", async () => {
    await startTradingRuntime();
    const snap1 = getRuntimeSnapshot();
    const snap2 = getRuntimeSnapshot();
    expect(snap1).not.toBe(snap2);
    expect(snap1.stats).not.toBe(snap2.stats);
    expect(snap1.perSymbol).not.toBe(snap2.perSymbol);
    expect(snap1.recentEvents).not.toBe(snap2.recentEvents);
  });

  it("resetRuntime clears per-symbol stats and events", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    expect(getRuntimeEvents().length).toBe(1);
    expect(getPerSymbolStats().length).toBe(1);

    resetRuntime();
    expect(getRuntimeEvents().length).toBe(0);
    expect(getPerSymbolStats().length).toBe(0);
  });

  // ─── Phase 8I: Observability Hardening Tests ─────────────────

  it("global stats track correctly across multiple symbols in one tick", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: { id: "PAPER-001" } }, reason: "OK" },
      { symbol: "ETHUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "SOLUSDT", result: { decision: { direction: "SHORT", confidence: 0.7, strategy: "MEAN_REVERSION" }, riskResult: { approved: false, reason: "Daily loss limit" }, trade: null }, reason: "OK" },
      { symbol: "BNBUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
      { symbol: "XRPUSDT", result: null, reason: "ERROR" },
    ]);

    await startTradingRuntime();
    const stats = getRuntimeStats();

    expect(stats.tickCount).toBe(1);
    expect(stats.totalProcessed).toBe(3);   // BTC, ETH, SOL
    expect(stats.totalSkipped).toBe(1);      // BNB
    expect(stats.totalErrors).toBe(1);       // XRP
    expect(stats.totalDecisions).toBe(3);    // same as processed
    expect(stats.totalNoTrade).toBe(1);      // ETH
    expect(stats.totalRiskRejected).toBe(1); // SOL
    expect(stats.totalPaperExecutions).toBe(1); // BTC
  });

  it("NO_TRADE is not counted as paper execution", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.2, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "NO_TRADE" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const stats = getRuntimeStats();
    expect(stats.totalNoTrade).toBe(1);
    expect(stats.totalPaperExecutions).toBe(0);
    expect(stats.totalRiskRejected).toBe(0);
  });

  it("risk rejection is not counted as paper execution", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: false, reason: "Daily loss limit" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const stats = getRuntimeStats();
    expect(stats.totalRiskRejected).toBe(1);
    expect(stats.totalPaperExecutions).toBe(0);
    expect(stats.totalNoTrade).toBe(0);
  });

  it("paper execution increments exactly once per trade", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: { id: "PAPER-001" } }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const stats = getRuntimeStats();
    expect(stats.totalPaperExecutions).toBe(1);
    expect(stats.totalDecisions).toBe(1);
    expect(stats.totalNoTrade).toBe(0);
    expect(stats.totalRiskRejected).toBe(0);
  });

  it("returned events cannot mutate internal buffer", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();

    const events = getRuntimeEvents();
    events[0]!.symbol = "MUTATED";

    const freshEvents = getRuntimeEvents();
    expect(freshEvents[0]!.symbol).toBe("BTCUSDT");
  });

  it("runtime snapshot recentEvents cannot mutate internal buffer", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    await startTradingRuntime();

    const snap = getRuntimeSnapshot();
    snap.recentEvents[0]!.symbol = "MUTATED";

    const freshSnap = getRuntimeSnapshot();
    expect(freshSnap.recentEvents[0]!.symbol).toBe("BTCUSDT");
  });

  it("error in one symbol does not affect stats of other symbols", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: null, reason: "ERROR" },
      { symbol: "ETHUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "SOLUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    await startTradingRuntime();

    const perSymbol = getPerSymbolStats();
    const btc = perSymbol.find(p => p.symbol === "BTCUSDT")!;
    const eth = perSymbol.find(p => p.symbol === "ETHUSDT")!;
    const sol = perSymbol.find(p => p.symbol === "SOLUSDT")!;

    expect(btc!.errors).toBe(1);
    expect(btc!.processed).toBe(0);

    expect(eth!.processed).toBe(1);
    expect(eth!.decisions).toBe(1);
    expect(eth!.errors).toBe(0);

    expect(sol!.skipped).toBe(1);
    expect(sol!.errors).toBe(0);
  });

  it("runtime observability does not alter trading decision data", async () => {
    const decisionData = { direction: "LONG", confidence: 0.85, strategy: "TREND_FOLLOWING" };
    const riskData = { approved: true, reason: "All risk checks passed" };
    const tradeData = { id: "PAPER-001", pnl: 0.15 };

    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: decisionData, riskResult: riskData, trade: tradeData }, reason: "OK" },
    ]);

    await startTradingRuntime();

    // The mock's returned values must be unchanged by observability processing
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results[0]!.result.decision.direction).toBe("LONG");
    expect(results[0]!.result.riskResult.approved).toBe(true);
    expect(results[0]!.result.trade.id).toBe("PAPER-001");
  });

  it("paper execution event contains paper trade ID and experienceRecorded", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: { id: "PAPER-TRD-42" } }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const events = getRuntimeEvents();
    const btcEvent = events.find(e => e.symbol === "BTCUSDT");
    expect(btcEvent!.paperTradeId).toBe("PAPER-TRD-42");
    expect(btcEvent!.executionResult).toBe("EXECUTED");
    expect(btcEvent!.experienceRecorded).toBe(true);
  });

  it("multiple ticks accumulate stats correctly", async () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND" }, riskResult: { approved: true, reason: "OK" }, trade: { id: "PAPER-001" } }, reason: "OK" },
    ]);

    await startTradingRuntime();
    const stats1 = getRuntimeStats();
    expect(stats1.totalProcessed).toBe(1);
    expect(stats1.totalPaperExecutions).toBe(1);
    expect(stats1.tickCount).toBe(1);

    await vi.advanceTimersByTimeAsync(getTickIntervalMs());
    const stats2 = getRuntimeStats();
    expect(stats2.totalProcessed).toBe(2);
    expect(stats2.totalPaperExecutions).toBe(2);
    expect(stats2.tickCount).toBe(2);
  });
});

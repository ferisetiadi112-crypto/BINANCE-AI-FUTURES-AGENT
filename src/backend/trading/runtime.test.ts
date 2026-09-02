/**
 * Trading Runtime Tests — Phase 8D-F1 Runtime Activation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockProcessRealtimeUpdate = vi.fn().mockReturnValue([]);
const MockOrchestratorConstructor = vi.fn().mockImplementation(() => ({
  processRealtimeUpdate: mockProcessRealtimeUpdate,
  processMarketUpdate: vi.fn(),
  getState: vi.fn().mockReturnValue({ systemStatus: "RUNNING" }),
  getDecisionHistory: vi.fn().mockReturnValue([]),
  getPaperStats: vi.fn().mockReturnValue({}),
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

  it("startTradingRuntime creates a TradingOrchestrator instance", () => {
    const orch = startTradingRuntime();
    expect(orch).toBeDefined();
    expect(getOrchestrator()).toBe(orch);
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const orch1 = startTradingRuntime();
    const orch2 = startTradingRuntime();
    const orch3 = startTradingRuntime();
    expect(orch1).toBe(orch2);
    expect(orch2).toBe(orch3);
    expect(MockOrchestratorConstructor).toHaveBeenCalledTimes(1);
  });

  it("isRuntimeRunning returns true after start", () => {
    expect(isRuntimeRunning()).toBe(false);
    startTradingRuntime();
    expect(isRuntimeRunning()).toBe(true);
  });

  it("isRuntimeRunning returns false after stop", () => {
    startTradingRuntime();
    stopTradingRuntime();
    expect(isRuntimeRunning()).toBe(false);
  });

  it("getOrchestrator returns null before start", () => {
    expect(getOrchestrator()).toBeNull();
  });

  it("runtime loop calls processRealtimeUpdate on tick", () => {
    startTradingRuntime();
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(3);
  });

  it("no duplicate intervals on repeated start", () => {
    startTradingRuntime();
    startTradingRuntime();

    vi.advanceTimersByTime(getTickIntervalMs() * 3);
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(4);
  });

  it("stop clears the interval", () => {
    startTradingRuntime();
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);
    stopTradingRuntime();

    vi.advanceTimersByTime(getTickIntervalMs() * 5);
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);
  });

  it("start after stop creates new interval", () => {
    startTradingRuntime();
    stopTradingRuntime();
    vi.advanceTimersByTime(getTickIntervalMs() * 2);
    const callsAfterStop = mockProcessRealtimeUpdate.mock.calls.length;

    startTradingRuntime();
    expect(mockProcessRealtimeUpdate.mock.calls.length).toBe(callsAfterStop + 1);

    vi.advanceTimersByTime(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate.mock.calls.length).toBe(callsAfterStop + 2);
  });

  it("tick processes symbols via processRealtimeUpdate", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: {}, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    startTradingRuntime();
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(1);
    const orch = getOrchestrator() as any;
    expect(orch.processRealtimeUpdate).toHaveBeenCalled();
  });

  it("tick handles errors gracefully without crashing runtime", () => {
    mockProcessRealtimeUpdate.mockImplementationOnce(() => {
      throw new Error("Test error");
    });

    startTradingRuntime();
    expect(isRuntimeRunning()).toBe(true);

    vi.advanceTimersByTime(getTickIntervalMs());
    expect(mockProcessRealtimeUpdate).toHaveBeenCalledTimes(2);
  });

  it("OFFLINE symbols have null result", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results[0].reason).toBe("OFFLINE/STALE/insufficient_data");
    expect(results[0].result).toBeNull();
  });

  it("STALE symbols have null result", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results[0].reason).toBe("OFFLINE/STALE/insufficient_data");
    expect(results[0].result).toBeNull();
  });

  it("mixed ONLINE and OFFLINE results handled correctly", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: {}, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
      { symbol: "SOLUSDT", result: { decision: {}, riskResult: { approved: false, reason: "RISK" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results).toHaveLength(3);
    expect(results[0].reason).toBe("OK");
    expect(results[1].reason).toBe("OFFLINE/STALE/insufficient_data");
    expect(results[2].reason).toBe("OK");
  });

  it("12 symbols can be processed independently", () => {
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

    startTradingRuntime();
    const results = mockProcessRealtimeUpdate.mock.results[0]!.value as any[];
    expect(results).toHaveLength(12);
    expect(results.map((r: any) => r.symbol)).toEqual(symbols);
  });

  it("no duplicate constructor calls (singleton)", () => {
    startTradingRuntime();
    expect(MockOrchestratorConstructor).toHaveBeenCalledTimes(1);
  });

  it("resetRuntime stops and clears everything", () => {
    startTradingRuntime();
    expect(isRuntimeRunning()).toBe(true);

    resetRuntime();
    expect(isRuntimeRunning()).toBe(false);
    expect(getOrchestrator()).toBeNull();
  });

  it("getTickIntervalMs returns 15 seconds", () => {
    expect(getTickIntervalMs()).toBe(15_000);
  });

  // ─── Phase 8H: Runtime Observability Tests ──────────────────

  it("getRuntimeSnapshot returns runtime state", () => {
    startTradingRuntime();
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

  it("per-symbol stats are isolated per symbol", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
      { symbol: "SOLUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();
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

  it("runtime events are recorded for each symbol", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
      { symbol: "ETHUSDT", result: null, reason: "OFFLINE/STALE/insufficient_data" },
    ]);

    startTradingRuntime();
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

  it("event buffer is bounded at 100", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();

    // Run 150 ticks to exceed buffer
    for (let i = 0; i < 149; i++) {
      vi.advanceTimersByTime(getTickIntervalMs());
    }

    const events = getRuntimeEvents();
    expect(events.length).toBeLessThanOrEqual(100);
  });

  it("newest events are retained when buffer is full", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "NO_TRADE", confidence: 0.3, strategy: "MOMENTUM" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();

    // Run enough ticks to fill and overflow buffer
    for (let i = 0; i < 105; i++) {
      vi.advanceTimersByTime(getTickIntervalMs());
    }

    const events = getRuntimeEvents();
    expect(events.length).toBe(100);

    // All events should have tickNumber > 0
    expect(events.every(e => e.tickNumber > 0)).toBe(true);
  });

  it("risk rejection is tracked in events", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: false, reason: "Daily loss limit reached" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();
    const events = getRuntimeEvents();
    const btcEvent = events.find(e => e.symbol === "BTCUSDT");

    expect(btcEvent).toBeDefined();
    expect(btcEvent!.riskApproved).toBe(false);
    expect(btcEvent!.riskReason).toContain("Daily loss limit");
    expect(btcEvent!.executionResult).toBe("REJECTED");
  });

  it("paper execution is tracked in events", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: { id: "PAPER-TRD-001" } }, reason: "OK" },
    ]);

    startTradingRuntime();
    const events = getRuntimeEvents();
    const btcEvent = events.find(e => e.symbol === "BTCUSDT");

    expect(btcEvent).toBeDefined();
    expect(btcEvent!.executionResult).toBe("EXECUTED");
    expect(btcEvent!.paperTradeId).toBe("PAPER-TRD-001");
  });

  it("error events are recorded for failed symbols", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: null, reason: "ERROR" },
      { symbol: "ETHUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();
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

  it("runtime snapshot is read-only (returns copies)", () => {
    startTradingRuntime();
    const snap1 = getRuntimeSnapshot();
    const snap2 = getRuntimeSnapshot();
    expect(snap1).not.toBe(snap2);
    expect(snap1.stats).not.toBe(snap2.stats);
    expect(snap1.perSymbol).not.toBe(snap2.perSymbol);
    expect(snap1.recentEvents).not.toBe(snap2.recentEvents);
  });

  it("resetRuntime clears per-symbol stats and events", () => {
    mockProcessRealtimeUpdate.mockReturnValue([
      { symbol: "BTCUSDT", result: { decision: { direction: "LONG", confidence: 0.8, strategy: "TREND_FOLLOWING" }, riskResult: { approved: true, reason: "OK" }, trade: null }, reason: "OK" },
    ]);

    startTradingRuntime();
    expect(getRuntimeEvents().length).toBe(1);
    expect(getPerSymbolStats().length).toBe(1);

    resetRuntime();
    expect(getRuntimeEvents().length).toBe(0);
    expect(getPerSymbolStats().length).toBe(0);
  });
});

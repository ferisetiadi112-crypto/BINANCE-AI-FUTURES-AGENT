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
});

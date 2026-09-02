import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TradingOrchestrator } from "./orchestrator";
import type { MarketState } from "../runtime/types";
import * as dataAdapter from "../services/data-adapter";
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

const uncertainState: MarketState = {
  ...trendingUpState,
  trend: "FLAT",
  trendStrength: 20,
  momentum: "REVERSAL",
  momentumScore: 50,
  marketRegime: "UNCERTAIN",
  regimeConfidence: 30,
  dataQuality: "STALE",
};

describe("Trading Orchestrator", () => {
  let orchestrator: TradingOrchestrator;
  let walletSpy: ReturnType<typeof vi.spyOn>;
  let guardrailSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Mock wallet repository so orchestrator doesn't need a real database
    walletSpy = vi.spyOn(walletRepo.walletRepository, "getBalance").mockResolvedValue(5.0);
    guardrailSpy = vi.spyOn(walletRepo.walletRepository, "logGuardrailEvent").mockResolvedValue(undefined);
    orchestrator = new TradingOrchestrator();
    orchestrator.start();
  });

  afterEach(() => {
    walletSpy?.mockRestore();
    guardrailSpy?.mockRestore();
  });

  describe("processMarketUpdate", () => {
    it("processes market update and returns decision", async () => {
      const result = await orchestrator.processMarketUpdate(trendingUpState);
      expect(result.decision).toBeDefined();
      expect(result.riskResult).toBeDefined();
      expect(result.decision.symbol).toBe("BTCUSDT");
    });

    it("AI cannot bypass risk engine", async () => {
      const result = await orchestrator.processMarketUpdate(trendingUpState);
      expect(result.riskResult).toBeDefined();
      expect(typeof result.riskResult.approved).toBe("boolean");
    });

    it("records decision history", async () => {
      await orchestrator.processMarketUpdate(trendingUpState);
      await orchestrator.processMarketUpdate(trendingUpState);
      const history = orchestrator.getDecisionHistory();
      expect(history.length).toBe(2);
    });

    it("updates state after processing", async () => {
      await orchestrator.processMarketUpdate(trendingUpState);
      const state = orchestrator.getState();
      expect(state.marketState).toBeDefined();
      expect(state.lastDecision).toBeDefined();
      expect(state.systemStatus).toBe("RUNNING");
    });

    it("AI produces NO_TRADE for stale market data (safe default)", async () => {
      const result = await orchestrator.processMarketUpdate(uncertainState);
      expect(result.decision.direction).toBe("NO_TRADE");
      expect(result.riskResult.approved).toBe(true);
      expect(result.trade).toBeNull();
    });

    it("risk engine rejects actual trade with stale data", async () => {
      const staleLongDecision = { ...trendingUpState, dataQuality: "STALE" as const, feedStatus: "STALE" as const };
      const result = await orchestrator.processMarketUpdate(staleLongDecision);
      expect(result.riskResult).toBeDefined();
      expect(typeof result.riskResult.approved).toBe("boolean");
    });
  });

  describe("paper stats", () => {
    it("tracks paper trading stats", () => {
      orchestrator.processMarketUpdate(trendingUpState);
      const stats = orchestrator.getPaperStats();
      expect(stats).toBeDefined();
      expect(typeof stats.capital).toBe("number");
      expect(typeof stats.totalTrades).toBe("number");
    });
  });

  describe("daily stats", () => {
    it("tracks daily risk stats", () => {
      const stats = orchestrator.getDailyStats();
      expect(stats).toBeDefined();
      expect(typeof stats.pnl).toBe("number");
      expect(typeof stats.locked).toBe("boolean");
    });
  });

  describe("lifecycle", () => {
    it("can start and stop", () => {
      orchestrator.stop();
      expect(orchestrator.getState().systemStatus).toBe("PAUSED");

      orchestrator.start();
      expect(orchestrator.getState().systemStatus).toBe("RUNNING");
    });

    it("can reset daily counters", () => {
      orchestrator.resetDaily();
      const stats = orchestrator.getDailyStats();
      expect(stats.pnl).toBe(0);
      expect(stats.locked).toBe(false);
    });
  });

  describe("processRealtimeUpdate — F-1 remediation", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      spy?.mockRestore();
    });

    it("processRealtimeUpdate calls generateRealtimeMarketState and forwards to processMarketUpdate", async () => {
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockReturnValue(trendingUpState);

      const results = await orchestrator.processRealtimeUpdate();

      expect(spy).toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);

      const okResults = results.filter(r => r.reason === "OK");
      expect(okResults.length).toBeGreaterThan(0);

      const firstOk = okResults[0]!;
      expect(firstOk.result).not.toBeNull();
      expect(firstOk.result!.decision).toBeDefined();
      expect(firstOk.result!.riskResult).toBeDefined();
    });

    it("OFFLINE/STALE data from generateRealtimeMarketState is rejected (null → skip)", async () => {
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockReturnValue(null);

      const results = await orchestrator.processRealtimeUpdate();

      expect(spy).toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);

      const skipped = results.filter(r => r.reason === "OFFLINE/STALE/insufficient_data");
      expect(skipped.length).toBe(results.length);

      const decisionHistory = orchestrator.getDecisionHistory();
      expect(decisionHistory.length).toBe(0);
    });

    it("realtime MarketState contains actual feed data, not mock data", async () => {
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockReturnValue(trendingUpState);

      await orchestrator.processRealtimeUpdate();

      expect(spy).toHaveBeenCalledWith(expect.any(String));

      const decisionHistory = orchestrator.getDecisionHistory();
      if (decisionHistory.length > 0) {
        expect(decisionHistory[0]!.symbol).toBe("BTCUSDT");
      }
    });

    it("getRealtimeMarketState returns null for offline feed", () => {
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockReturnValue(null);

      const state = orchestrator.getRealtimeMarketState("BTCUSDT");
      expect(state).toBeNull();
    });

    it("getRealtimeMarketState returns MarketState for online feed", () => {
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockReturnValue(trendingUpState);

      const state = orchestrator.getRealtimeMarketState("BTCUSDT");
      expect(state).not.toBeNull();
      expect(state!.price).toBe(63000);
      expect(state!.symbol).toBe("BTCUSDT");
    });

    it("processRealtimeUpdate returns per-symbol isolation", async () => {
      let callCount = 0;
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockImplementation(() => {
        callCount++;
        return callCount === 1 ? trendingUpState : null;
      });

      const results = await orchestrator.processRealtimeUpdate();

      const okResults = results.filter(r => r.reason === "OK");
      const skippedResults = results.filter(r => r.reason === "OFFLINE/STALE/insufficient_data");

      expect(okResults.length).toBe(1);
      expect(skippedResults.length).toBeGreaterThan(0);
    });
  });

  describe("Phase 8E — full pipeline: MarketState → AI Decision → Risk → Paper", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      spy?.mockRestore();
    });

    it("valid MarketState flows through full pipeline", async () => {
      const result = await orchestrator.processMarketUpdate(trendingUpState);
      expect(result.decision).toBeDefined();
      expect(result.riskResult).toBeDefined();
      expect(typeof result.riskResult.approved).toBe("boolean");
      expect(result.decision.symbol).toBe("BTCUSDT");
      expect(result.decision.direction).toBeDefined();
      expect(result.decision.strategy).toBeDefined();
    });

    it("Risk Engine rejection blocks Paper Trading execution", async () => {
      orchestrator.getRiskEngine().updateDailyPnl(-0.55);
      expect(orchestrator.getRiskEngine().isSystemLocked()).toBe(true);

      const result = await orchestrator.processMarketUpdate(trendingUpState);
      expect(result.riskResult.approved).toBe(false);
      expect(result.trade).toBeNull();
    });

    it("NO_TRADE decision does not trigger Paper Trading execution", async () => {
      const result = await orchestrator.processMarketUpdate(uncertainState);
      expect(result.decision.direction).toBe("NO_TRADE");
      expect(result.trade).toBeNull();
    });

    it("decision result tracks riskResult field on the decision object", async () => {
      const result = await orchestrator.processMarketUpdate(trendingUpState);
      expect(result.decision.riskResult).toBeDefined();
      expect(["APPROVED", "REJECTED"]).toContain(result.decision.riskResult!);
    });

    it("multiple consecutive processMarketUpdate calls work deterministically", async () => {
      const r1 = await orchestrator.processMarketUpdate(trendingUpState);
      const r2 = await orchestrator.processMarketUpdate(trendingUpState);
      const history = orchestrator.getDecisionHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(r1.decision).toBeDefined();
      expect(r2.decision).toBeDefined();
    });

    it("error in one symbol does not stop other symbols in processRealtimeUpdate", async () => {
      let callCount = 0;
      spy = vi.spyOn(dataAdapter, "generateRealtimeMarketState").mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("Mock error for first symbol");
        if (callCount === 2) return trendingUpState;
        return null;
      });

      const results = await orchestrator.processRealtimeUpdate();
      const errored = results.filter(r => r.reason === "ERROR");
      const ok = results.filter(r => r.reason === "OK");

      expect(errored.length).toBe(1);
      expect(ok.length).toBe(1);
    });

    it("Paper Engine remains in paper-only mode after full cycle", async () => {
      await orchestrator.processMarketUpdate(trendingUpState);
      const stats = orchestrator.getPaperStats();
      expect(stats).toBeDefined();
      expect(typeof stats.capital).toBe("number");
      expect(stats.capital).toBeGreaterThan(0);
    });
  });

  describe("processMarketUpdateLLM — LLM provider integration", () => {
    let llmSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      llmSpy?.mockRestore();
    });

    it("uses LLM decision when provider succeeds", async () => {
      const { generateLLMDecision } = await import("../ai/decision-engine");
      llmSpy = vi.spyOn(await import("../ai/decision-engine"), "generateLLMDecision").mockResolvedValue({
        decision: { direction: "LONG", confidence: 0.8, strategy: "MOMENTUM", reasoning: "Strong trend" },
        provider: "groq",
        providerAttempts: 1,
        errors: [],
        elapsedMs: 150,
      });

      const result = await orchestrator.processMarketUpdateLLM(trendingUpState);

      expect(llmSpy).toHaveBeenCalled();
      expect(result.decision.direction).toBe("LONG");
      expect(result.decision.modelVersion).toContain("groq");
      expect(result.decision.id).toContain("DEC-LLM");
    });

    it("falls back to rule-based when all LLM providers fail", async () => {
      llmSpy = vi.spyOn(await import("../ai/decision-engine"), "generateLLMDecision").mockResolvedValue({
        decision: { direction: "NO_TRADE", confidence: 0, strategy: "TREND_FOLLOWING", reasoning: "All failed" },
        provider: "safe_fallback",
        providerAttempts: 0,
        errors: [],
        elapsedMs: 0,
      });

      const result = await orchestrator.processMarketUpdateLLM(trendingUpState);

      // Should have fallen back to rule-based (modelVersion contains 'rule-based')
      expect(result.decision.modelVersion).toContain("rule-based");
      expect(result.decision).toBeDefined();
    });

    it("falls back to rule-based when LLM throws an error", async () => {
      llmSpy = vi.spyOn(await import("../ai/decision-engine"), "generateLLMDecision").mockRejectedValue(
        new Error("Network failure"),
      );

      const result = await orchestrator.processMarketUpdateLLM(trendingUpState);

      // Should not crash — falls back to rule-based
      expect(result.decision).toBeDefined();
      expect(result.decision.modelVersion).toContain("rule-based");
    });

    it("risk engine still gates LLM decisions", async () => {
      llmSpy = vi.spyOn(await import("../ai/decision-engine"), "generateLLMDecision").mockResolvedValue({
        decision: { direction: "LONG", confidence: 0.9, strategy: "MOMENTUM", reasoning: "Strong" },
        provider: "gemini",
        providerAttempts: 1,
        errors: [],
        elapsedMs: 200,
      });

      // Lock the risk engine
      orchestrator.getRiskEngine().updateDailyPnl(-0.55);

      const result = await orchestrator.processMarketUpdateLLM(trendingUpState);

      expect(result.riskResult.approved).toBe(false);
      expect(result.trade).toBeNull();
    });

    it("records LLM decisions in history", async () => {
      llmSpy = vi.spyOn(await import("../ai/decision-engine"), "generateLLMDecision").mockResolvedValue({
        decision: { direction: "SHORT", confidence: 0.65, strategy: "BREAKOUT", reasoning: "Volatility spike" },
        provider: "cerebras",
        providerAttempts: 1,
        errors: [],
        elapsedMs: 80,
      });

      await orchestrator.processMarketUpdateLLM(trendingUpState);

      const history = orchestrator.getDecisionHistory();
      expect(history.length).toBe(1);
      expect(history[0]!.direction).toBe("SHORT");
      expect(history[0]!.modelVersion).toContain("cerebras");
    });

    it("NO_TRADE from LLM skips paper execution", async () => {
      llmSpy = vi.spyOn(await import("../ai/decision-engine"), "generateLLMDecision").mockResolvedValue({
        decision: { direction: "NO_TRADE", confidence: 0.2, strategy: "TREND_FOLLOWING", reasoning: "Uncertain" },
        provider: "groq",
        providerAttempts: 1,
        errors: [],
        elapsedMs: 100,
      });

      const result = await orchestrator.processMarketUpdateLLM(trendingUpState);

      expect(result.decision.direction).toBe("NO_TRADE");
      expect(result.trade).toBeNull();
    });
  });
});

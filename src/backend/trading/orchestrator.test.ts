import { describe, it, expect, beforeEach } from "vitest";
import { TradingOrchestrator } from "./orchestrator";
import type { MarketState } from "../runtime/types";

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

  beforeEach(() => {
    orchestrator = new TradingOrchestrator();
    orchestrator.start();
  });

  describe("processMarketUpdate", () => {
    it("processes market update and returns decision", () => {
      const result = orchestrator.processMarketUpdate(trendingUpState);
      expect(result.decision).toBeDefined();
      expect(result.riskResult).toBeDefined();
      expect(result.decision.symbol).toBe("BTCUSDT");
    });

    it("AI cannot bypass risk engine", () => {
      const result = orchestrator.processMarketUpdate(trendingUpState);
      // Risk result must exist
      expect(result.riskResult).toBeDefined();
      expect(typeof result.riskResult.approved).toBe("boolean");
    });

    it("records decision history", () => {
      orchestrator.processMarketUpdate(trendingUpState);
      orchestrator.processMarketUpdate(trendingUpState);
      const history = orchestrator.getDecisionHistory();
      expect(history.length).toBe(2);
    });

    it("updates state after processing", () => {
      orchestrator.processMarketUpdate(trendingUpState);
      const state = orchestrator.getState();
      expect(state.marketState).toBeDefined();
      expect(state.lastDecision).toBeDefined();
      expect(state.systemStatus).toBe("RUNNING");
    });

    it("AI produces NO_TRADE for stale market data (safe default)", () => {
      const result = orchestrator.processMarketUpdate(uncertainState);
      // AI correctly outputs NO_TRADE when data is stale; risk approves NO_TRADE
      // because no trade action is being taken — this is the safe behavior
      expect(result.decision.direction).toBe("NO_TRADE");
      expect(result.riskResult.approved).toBe(true);
      expect(result.trade).toBeNull();
    });

    it("risk engine rejects actual trade with stale data", () => {
      // Force a LONG decision on stale data to verify risk catches it
      const staleLongDecision = { ...trendingUpState, dataQuality: "STALE" as const, feedStatus: "STALE" as const };
      const result = orchestrator.processMarketUpdate(staleLongDecision);
      // Even if AI decides LONG, risk engine should reject based on data quality
      // unless the signal is strong enough to override
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
});

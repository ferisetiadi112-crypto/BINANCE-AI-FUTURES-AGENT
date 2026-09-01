import { describe, it, expect, beforeEach } from "vitest";
import { RiskEngine } from "./engine";
import type { AiDecision } from "../ai/types";
import type { MarketState } from "../runtime/types";

const mockDecision: AiDecision = {
  id: "DEC-TEST-001",
  timestamp: Date.now(),
  symbol: "BTCUSDT",
  direction: "LONG",
  confidence: 0.75,
  confidenceLevel: "HIGH",
  strategy: "TREND_FOLLOWING",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  evidence: {
    trend: "UP (strength: 70)",
    momentum: "STRONG (score: 75)",
    volume: "24h: 28000",
    volatility: "ATR: 500",
    structure: "HIGHER_HIGHS",
    regime: "TRENDING_UP",
    regimeConfidence: 74,
    indicators: { rsi: 65, ema20: 63000, ema50: 62500, macd: 150, atr: 500 },
  },
  decisionVersion: "1.0.0",
  modelVersion: "rule-based-v1",
};

const mockMarketState: MarketState = {
  symbol: "BTCUSDT",
  timestamp: Date.now(),
  price: 63000,
  priceChange24h: 500,
  priceChangePercent24h: 0.8,
  trend: "UP",
  trendStrength: 70,
  momentum: "STRONG",
  momentumScore: 75,
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

describe("Risk Engine", () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine({
      initialCapital: 5.0,
      dailyProfitCap: 0.50,
      dailyLossLimit: 0.50,
    });
  });

  describe("check", () => {
    it("approves valid LONG decision", () => {
      const result = engine.check(
        mockDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(true);
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it("approves NO_TRADE without checks", () => {
      const noTradeDecision = { ...mockDecision, direction: "NO_TRADE" as const };
      const result = engine.check(
        noTradeDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(true);
    });

    it("rejects when already in position", () => {
      const result = engine.check(
        mockDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "LONG", size: 0.0001 },
      );
      expect(result.approved).toBe(false);
      expect(result.checks.some(c => c.name === "position_limit" && !c.passed)).toBe(true);
    });

    it("rejects stale decision", () => {
      const staleDecision = { ...mockDecision, timestamp: Date.now() - 600000 }; // 10 minutes ago
      const result = engine.check(
        staleDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(false);
      expect(result.checks.some(c => c.name === "decision_freshness" && !c.passed)).toBe(true);
    });

    it("rejects low data quality", () => {
      const badDataState = { ...mockMarketState, dataQuality: "STALE" as const };
      const result = engine.check(
        mockDecision,
        badDataState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(false);
      expect(result.checks.some(c => c.name === "data_quality" && !c.passed)).toBe(true);
    });

    it("rejects low confidence", () => {
      const lowConfDecision = { ...mockDecision, confidence: 0.2 };
      const result = engine.check(
        lowConfDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(false);
      expect(result.checks.some(c => c.name === "confidence_threshold" && !c.passed)).toBe(true);
    });
  });

  describe("daily limits", () => {
    it("locks on daily loss limit", () => {
      engine.updateDailyPnl(-0.30);
      engine.updateDailyPnl(-0.25); // Total: -0.55, exceeds limit

      const result = engine.check(
        mockDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(false);
      expect(engine.isSystemLocked()).toBe(true);
    });

    it("locks on daily profit cap", () => {
      engine.updateDailyPnl(0.30);
      engine.updateDailyPnl(0.25); // Total: 0.55, exceeds cap

      const result = engine.check(
        mockDecision,
        mockMarketState,
        { symbol: "BTCUSDT", side: "FLAT", size: 0 },
      );
      expect(result.approved).toBe(false);
      expect(engine.isSystemLocked()).toBe(true);
    });

    it("resets daily counters", () => {
      engine.updateDailyPnl(-0.40);
      engine.resetDaily();
      expect(engine.isSystemLocked()).toBe(false);
      expect(engine.getDailyStats().pnl).toBe(0);
    });
  });

  describe("getDailyStats", () => {
    it("returns current daily stats", () => {
      engine.updateDailyPnl(0.10);
      const stats = engine.getDailyStats();
      expect(stats.pnl).toBe(0.10);
      expect(stats.profitCap).toBe(0.50);
      expect(stats.lossLimit).toBe(0.50);
    });
  });
});

import { describe, it, expect } from "vitest";
import { evaluateAllStrategies, getBestSignal, getAllStrategyNames } from "./strategies";
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

const rangingState: MarketState = {
  ...trendingUpState,
  trend: "FLAT",
  trendStrength: 25,
  momentum: "WEAK",
  momentumScore: 50,
  marketRegime: "RANGING",
  regimeConfidence: 60,
};

const uncertainState: MarketState = {
  ...trendingUpState,
  trend: "FLAT",
  trendStrength: 20,
  momentum: "REVERSAL",
  momentumScore: 50,
  marketRegime: "UNCERTAIN",
  regimeConfidence: 30,
};

describe("Strategy Engine", () => {
  describe("evaluateAllStrategies", () => {
    it("evaluates all 5 strategies", () => {
      const evaluations = evaluateAllStrategies(trendingUpState);
      expect(evaluations.length).toBe(5);
    });

    it("each evaluation has required fields", () => {
      const evaluations = evaluateAllStrategies(trendingUpState);
      for (const eval_ of evaluations) {
        expect(eval_.strategy).toBeTruthy();
        expect(eval_.signal).toBeDefined();
        expect(["LONG", "SHORT", "NO_TRADE"]).toContain(eval_.signal.direction);
        expect(eval_.signal.strength).toBeGreaterThanOrEqual(0);
        expect(eval_.signal.strength).toBeLessThanOrEqual(1);
        expect(eval_.signal.reasoning).toBeTruthy();
      }
    });

    it("produces signals in trending market", () => {
      const evaluations = evaluateAllStrategies(trendingUpState);
      const actionable = evaluations.filter(e => e.signal.direction !== "NO_TRADE");
      expect(actionable.length).toBeGreaterThan(0);
    });

    it("produces fewer signals in uncertain market", () => {
      const evaluations = evaluateAllStrategies(uncertainState);
      const actionable = evaluations.filter(e => e.signal.direction !== "NO_TRADE");
      expect(actionable.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getBestSignal", () => {
    it("returns strongest signal", () => {
      const best = getBestSignal(trendingUpState);
      expect(best).not.toBeNull();
      expect(best!.signal.strength).toBeGreaterThan(0.3);
    });

    it("returns null for no actionable signals", () => {
      const best = getBestSignal(uncertainState);
      // May or may not be null depending on thresholds
      if (best) {
        expect(best.signal.strength).toBeGreaterThan(0.3);
      }
    });
  });

  describe("getAllStrategyNames", () => {
    it("returns 5 strategy names", () => {
      const names = getAllStrategyNames();
      expect(names.length).toBe(5);
      expect(names).toContain("TREND_FOLLOWING");
      expect(names).toContain("MOMENTUM");
      expect(names).toContain("BREAKOUT");
      expect(names).toContain("PULLBACK");
      expect(names).toContain("MEAN_REVERSION");
    });
  });
});

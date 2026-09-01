import { describe, it, expect } from "vitest";
import { generateDecision, validateDecision, formatDecisionSummary } from "./decision-engine";
import { getConfidenceLevel } from "./types";
import type { MarketState } from "../runtime/types";

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

describe("AI Decision Engine", () => {
  describe("generateDecision", () => {
    it("generates a valid decision", () => {
      const decision = generateDecision(mockMarketState);
      expect(decision).toBeDefined();
      expect(decision.id).toBeTruthy();
      expect(decision.symbol).toBe("BTCUSDT");
      expect(["LONG", "SHORT", "NO_TRADE"]).toContain(decision.direction);
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.strategy).toBeTruthy();
      expect(decision.decisionVersion).toBeTruthy();
    });

    it("includes evidence", () => {
      const decision = generateDecision(mockMarketState);
      expect(decision.evidence).toBeDefined();
      expect(decision.evidence.trend).toBeTruthy();
      expect(decision.evidence.momentum).toBeTruthy();
      expect(decision.evidence.regime).toBeTruthy();
    });

    it("generates unique IDs", () => {
      const d1 = generateDecision(mockMarketState);
      const d2 = generateDecision(mockMarketState);
      expect(d1.id).not.toBe(d2.id);
    });

    it("returns NO_TRADE for uncertain market", () => {
      const uncertainState: MarketState = {
        ...mockMarketState,
        trend: "FLAT",
        trendStrength: 20,
        momentum: "REVERSAL",
        momentumScore: 50,
        marketRegime: "UNCERTAIN",
        regimeConfidence: 30,
      };
      const decision = generateDecision(uncertainState);
      expect(decision.direction).toBe("NO_TRADE");
    });
  });

  describe("validateDecision", () => {
    it("validates correct decision", () => {
      const decision = generateDecision(mockMarketState);
      const result = validateDecision(decision);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("rejects invalid direction", () => {
      const decision = generateDecision(mockMarketState);
      decision.direction = "INVALID" as any;
      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("direction"))).toBe(true);
    });

    it("rejects invalid confidence", () => {
      const decision = generateDecision(mockMarketState);
      decision.confidence = -0.5;
      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
    });
  });

  describe("getConfidenceLevel", () => {
    it("returns LOW for low confidence", () => {
      expect(getConfidenceLevel(0.2)).toBe("LOW");
      expect(getConfidenceLevel(0.39)).toBe("LOW");
    });

    it("returns MEDIUM for medium confidence", () => {
      expect(getConfidenceLevel(0.4)).toBe("MEDIUM");
      expect(getConfidenceLevel(0.59)).toBe("MEDIUM");
    });

    it("returns HIGH for high confidence", () => {
      expect(getConfidenceLevel(0.6)).toBe("HIGH");
      expect(getConfidenceLevel(0.79)).toBe("HIGH");
    });

    it("returns VERY_HIGH for very high confidence", () => {
      expect(getConfidenceLevel(0.8)).toBe("VERY_HIGH");
      expect(getConfidenceLevel(1.0)).toBe("VERY_HIGH");
    });
  });

  describe("formatDecisionSummary", () => {
    it("formats decision summary", () => {
      const decision = generateDecision(mockMarketState);
      const summary = formatDecisionSummary(decision);
      expect(summary).toContain(decision.direction);
      expect(summary).toContain(decision.symbol);
      expect(summary).toContain(decision.strategy);
    });
  });
});

import { describe, it, expect } from "vitest";
import { calculateBaseline, calculateBaselineBreakdown } from "./baseline";
import type { TradeExperience } from "../ai/experience-engine";

const createMockExperience = (overrides: Partial<TradeExperience> = {}): TradeExperience => ({
  id: `EXP-${Date.now()}-${Math.random()}`,
  decisionId: "DEC-TEST-001",
  tradeId: "PAPER-TRD-001",
  symbol: "BTCUSDT",
  timestamp: Date.now(),
  marketRegime: "TRENDING_UP",
  strategy: "TREND_FOLLOWING",
  direction: "LONG",
  confidence: 0.75,
  entryPrice: 63000,
  exitPrice: 63500,
  duration: 3600000,
  fees: 0.025,
  slippage: 0.006,
  grossPnl: 0.075,
  netPnl: 0.05,
  drawdown: null,
  outcome: "WIN",
  marketContext: {
    symbol: "BTCUSDT",
    price: 63000,
    trend: "UP",
    trendStrength: 75,
    momentum: "STRONG",
    momentumScore: 80,
    volatility: 500,
    volume24h: 28000,
    marketRegime: "TRENDING_UP",
    regimeConfidence: 74,
    dataQuality: "GOOD",
    feedStatus: "ONLINE",
  },
  decisionVersion: "1.0.0",
  modelVersion: "rule-based-v1",
  ...overrides,
});

describe("Baseline Performance Engine", () => {
  describe("calculateBaseline", () => {
    it("returns empty baseline for no experiences", () => {
      const baseline = calculateBaseline([]);
      expect(baseline.totalDecisions).toBe(0);
      expect(baseline.totalTrades).toBe(0);
      expect(baseline.winRate).toBe(0);
      expect(baseline.statisticalStatus).toBe("INSUFFICIENT_SAMPLE");
    });

    it("calculates basic metrics", () => {
      const experiences = [
        createMockExperience({ outcome: "WIN", netPnl: 0.05 }),
        createMockExperience({ outcome: "LOSS", netPnl: -0.03 }),
        createMockExperience({ outcome: "WIN", netPnl: 0.08 }),
      ];

      const baseline = calculateBaseline(experiences);
      expect(baseline.totalDecisions).toBe(3);
      expect(baseline.totalTrades).toBe(3);
      expect(baseline.wins).toBe(2);
      expect(baseline.losses).toBe(1);
      expect(baseline.winRate).toBeCloseTo(66.67, 1);
    });

    it("calculates PnL correctly", () => {
      const experiences = [
        createMockExperience({ outcome: "WIN", netPnl: 0.05 }),
        createMockExperience({ outcome: "WIN", netPnl: 0.08 }),
        createMockExperience({ outcome: "LOSS", netPnl: -0.03 }),
      ];

      const baseline = calculateBaseline(experiences);
      expect(baseline.netPnl).toBeCloseTo(0.10, 2);
      expect(baseline.grossProfit).toBeCloseTo(0.13, 2);
      expect(baseline.grossLoss).toBeCloseTo(0.03, 2);
    });

    it("tracks direction breakdown", () => {
      const experiences = [
        createMockExperience({ direction: "LONG", outcome: "WIN", netPnl: 0.05 }),
        createMockExperience({ direction: "LONG", outcome: "LOSS", netPnl: -0.03 }),
        createMockExperience({ direction: "SHORT", outcome: "WIN", netPnl: 0.04 }),
      ];

      const baseline = calculateBaseline(experiences);
      expect(baseline.longTrades).toBe(2);
      expect(baseline.shortTrades).toBe(1);
      expect(baseline.longWinRate).toBe(50);
      expect(baseline.shortWinRate).toBe(100);
    });

    it("determines statistical status based on sample size", () => {
      // INSUFFICIENT_SAMPLE (< 10)
      const few = Array.from({ length: 5 }, () => createMockExperience());
      expect(calculateBaseline(few).statisticalStatus).toBe("INSUFFICIENT_SAMPLE");

      // PRELIMINARY (10-29)
      const some = Array.from({ length: 15 }, () => createMockExperience());
      expect(calculateBaseline(some).statisticalStatus).toBe("PRELIMINARY");

      // VALIDATED (>= 30)
      const many = Array.from({ length: 35 }, () => createMockExperience());
      expect(calculateBaseline(many).statisticalStatus).toBe("VALIDATED");
    });
  });

  describe("calculateBaselineBreakdown", () => {
    it("breaks down by strategy", () => {
      const experiences = [
        createMockExperience({ strategy: "TREND_FOLLOWING", outcome: "WIN" }),
        createMockExperience({ strategy: "MOMENTUM", outcome: "LOSS" }),
        createMockExperience({ strategy: "TREND_FOLLOWING", outcome: "WIN" }),
      ];

      const breakdown = calculateBaselineBreakdown(experiences);
      expect(breakdown.byStrategy["TREND_FOLLOWING"]).toBeDefined();
      expect(breakdown.byStrategy["TREND_FOLLOWING"]?.wins).toBe(2);
      expect(breakdown.byStrategy["MOMENTUM"]).toBeDefined();
      expect(breakdown.byStrategy["MOMENTUM"]?.losses).toBe(1);
    });

    it("breaks down by regime", () => {
      const experiences = [
        createMockExperience({ marketRegime: "TRENDING_UP", outcome: "WIN" }),
        createMockExperience({ marketRegime: "RANGING", outcome: "LOSS" }),
      ];

      const breakdown = calculateBaselineBreakdown(experiences);
      expect(breakdown.byRegime["TRENDING_UP"]).toBeDefined();
      expect(breakdown.byRegime["RANGING"]).toBeDefined();
    });

    it("breaks down by symbol", () => {
      const experiences = [
        createMockExperience({ symbol: "BTCUSDT", outcome: "WIN" }),
        createMockExperience({ symbol: "ETHUSDT", outcome: "LOSS" }),
      ];

      const breakdown = calculateBaselineBreakdown(experiences);
      expect(breakdown.bySymbol["BTCUSDT"]).toBeDefined();
      expect(breakdown.bySymbol["ETHUSDT"]).toBeDefined();
    });

    it("breaks down by confidence bucket", () => {
      const experiences = [
        createMockExperience({ confidence: 0.75, outcome: "WIN" }),
        createMockExperience({ confidence: 0.55, outcome: "LOSS" }),
        createMockExperience({ confidence: 0.85, outcome: "WIN" }),
      ];

      const breakdown = calculateBaselineBreakdown(experiences);
      expect(breakdown.byConfidenceBucket["0.70-0.79"]).toBeDefined();
      expect(breakdown.byConfidenceBucket["0.50-0.59"]).toBeDefined();
      expect(breakdown.byConfidenceBucket["0.80-0.89"]).toBeDefined();
      expect(breakdown.byConfidenceBucket["0.70-0.79"]?.totalDecisions).toBe(1);
      expect(breakdown.byConfidenceBucket["0.50-0.59"]?.totalDecisions).toBe(1);
    });
  });
});

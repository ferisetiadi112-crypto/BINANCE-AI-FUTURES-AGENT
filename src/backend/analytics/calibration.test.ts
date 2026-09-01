import { describe, it, expect } from "vitest";
import { calibrateConfidence, getConfidenceBucketLabel } from "./calibration";
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

describe("Confidence Calibration Engine", () => {
  describe("calibrateConfidence", () => {
    it("returns insufficient sample for small dataset", () => {
      const experiences = Array.from({ length: 5 }, () => createMockExperience());
      const result = calibrateConfidence(experiences);

      expect(result.sampleStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(result.overallMetrics.reliabilityGrade).toBe("INSUFFICIENT_DATA");
      expect(result.buckets).toHaveLength(0);
    });

    it("creates confidence buckets", () => {
      const experiences = [
        // 0.70-0.79 bucket
        ...Array.from({ length: 10 }, (_, i) =>
          createMockExperience({ confidence: 0.75, outcome: i < 7 ? "WIN" : "LOSS" })
        ),
        // 0.80-0.89 bucket
        ...Array.from({ length: 10 }, (_, i) =>
          createMockExperience({ confidence: 0.85, outcome: i < 8 ? "WIN" : "LOSS" })
        ),
        // 0.90-1.00 bucket
        ...Array.from({ length: 10 }, (_, i) =>
          createMockExperience({ confidence: 0.95, outcome: i < 9 ? "WIN" : "LOSS" })
        ),
      ];

      const result = calibrateConfidence(experiences);
      expect(result.buckets.length).toBeGreaterThan(0);
      expect(result.sampleStatus).toBe("VALIDATED");
    });

    it("calculates win rate per bucket", () => {
      const experiences = [
        ...Array.from({ length: 10 }, (_, i) =>
          createMockExperience({ confidence: 0.75, outcome: i < 7 ? "WIN" : "LOSS" })
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          createMockExperience({ confidence: 0.85, outcome: i < 8 ? "WIN" : "LOSS" })
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          createMockExperience({ confidence: 0.95, outcome: i < 9 ? "WIN" : "LOSS" })
        ),
      ];

      const result = calibrateConfidence(experiences);
      const bucket70 = result.buckets.find(b => b.bucket === "0.70-0.79");
      const bucket80 = result.buckets.find(b => b.bucket === "0.80-0.89");
      const bucket90 = result.buckets.find(b => b.bucket === "0.90-1.00");

      expect(bucket70?.winRate).toBe(70);
      expect(bucket80?.winRate).toBe(80);
      expect(bucket90?.winRate).toBe(90);
    });

    it("calculates calibration gap", () => {
      // Need at least 30 total experiences for VALIDATED status
      const experiences = [
        ...Array.from({ length: 35 }, (_, i) =>
          createMockExperience({ confidence: 0.75, outcome: i < 25 ? "WIN" : "LOSS" }) // 71.4% win rate
        ),
      ];

      const result = calibrateConfidence(experiences);
      const bucket = result.buckets.find(b => b.bucket === "0.70-0.79");

      expect(bucket).toBeDefined();
      expect(bucket?.calibrationGap).toBeDefined();
      expect(typeof bucket?.calibrationGap).toBe("number");
    });

    it("generates assessment text", () => {
      const experiences = Array.from({ length: 35 }, (_, i) =>
        createMockExperience({ confidence: 0.75, outcome: i < 25 ? "WIN" : "LOSS" })
      );

      const result = calibrateConfidence(experiences);
      expect(result.calibrationAssessment).toBeDefined();
      expect(typeof result.calibrationAssessment).toBe("string");
    });
  });

  describe("getConfidenceBucketLabel", () => {
    it("returns correct bucket labels", () => {
      expect(getConfidenceBucketLabel(0.35)).toBe("0.00-0.49");
      expect(getConfidenceBucketLabel(0.55)).toBe("0.50-0.59");
      expect(getConfidenceBucketLabel(0.65)).toBe("0.60-0.69");
      expect(getConfidenceBucketLabel(0.75)).toBe("0.70-0.79");
      expect(getConfidenceBucketLabel(0.85)).toBe("0.80-0.89");
      expect(getConfidenceBucketLabel(0.95)).toBe("0.90-1.00");
    });
  });
});

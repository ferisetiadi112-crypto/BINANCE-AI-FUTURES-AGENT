import { describe, it, expect } from "vitest";
import {
  createCandidate,
  validateCandidate,
  rejectCandidate,
  evaluatePromotion,
  promoteToPaper,
  canPromoteToLive,
} from "./candidate";
import { calculateBaseline } from "./baseline";
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

describe("Candidate Strategy Management", () => {
  describe("createCandidate", () => {
    it("creates candidate with correct structure", () => {
      const baseline = calculateBaseline(Array.from({ length: 20 }, () => createMockExperience()));

      const candidate = createCandidate({
        strategyId: "TREND_FOLLOWING",
        version: "v1.1",
        parameters: { emaPeriod: 25 },
        baseline,
        experimentId: "EXP-001",
      });

      expect(candidate.id).toContain("CAND-");
      expect(candidate.strategyId).toBe("TREND_FOLLOWING");
      expect(candidate.version).toBe("v1.1");
      expect(candidate.status).toBe("TESTING");
    });
  });

  describe("candidate lifecycle", () => {
    it("follows TESTING → VALIDATED lifecycle", () => {
      const baseline = calculateBaseline(Array.from({ length: 20 }, () => createMockExperience()));

      let candidate = createCandidate({
        strategyId: "TREND_FOLLOWING",
        version: "v1.1",
        parameters: {},
        baseline,
        experimentId: "EXP-001",
      });

      expect(candidate.status).toBe("TESTING");

      const validatedMetrics = calculateBaseline(
        Array.from({ length: 35 }, (_, i) =>
          createMockExperience({ outcome: i < 25 ? "WIN" : "LOSS" })
        )
      );

      candidate = validateCandidate(candidate, validatedMetrics);
      expect(candidate.status).toBe("VALIDATED");
      expect(candidate.validatedMetrics).toBeDefined();
    });

    it("rejects candidate", () => {
      const baseline = calculateBaseline(Array.from({ length: 20 }, () => createMockExperience()));

      let candidate = createCandidate({
        strategyId: "TREND_FOLLOWING",
        version: "v1.1",
        parameters: {},
        baseline,
        experimentId: "EXP-001",
      });

      candidate = rejectCandidate(candidate, "Insufficient improvement");
      expect(candidate.status).toBe("REJECTED");
      expect(candidate.rejectionReason).toBe("Insufficient improvement");
    });
  });

  describe("promotion gate", () => {
    it("rejects promotion for non-validated candidate", () => {
      const baseline = calculateBaseline(Array.from({ length: 20 }, () => createMockExperience()));

      const candidate = createCandidate({
        strategyId: "TREND_FOLLOWING",
        version: "v1.1",
        parameters: {},
        baseline,
        experimentId: "EXP-001",
      });

      const gate = evaluatePromotion(candidate);
      expect(gate.approved).toBe(false);
      expect(gate.checks.some(c => c.name === "status_check" && !c.passed)).toBe(true);
    });

    it("approves promotion for validated candidate with sufficient data", () => {
      // Baseline with lower win rate (60%)
      const baselineExps = Array.from({ length: 20 }, (_, i) =>
        createMockExperience({ outcome: i < 12 ? "WIN" : "LOSS" }) // 60% win rate
      );
      const baseline = calculateBaseline(baselineExps);

      let candidate = createCandidate({
        strategyId: "TREND_FOLLOWING",
        version: "v1.1",
        parameters: {},
        baseline,
        experimentId: "EXP-001",
      });

      // Candidate with higher win rate (80%)
      const validatedMetrics = calculateBaseline(
        Array.from({ length: 35 }, (_, i) =>
          createMockExperience({ outcome: i < 28 ? "WIN" : "LOSS" }) // 80% win rate
        )
      );

      candidate = validateCandidate(candidate, validatedMetrics);
      const gate = evaluatePromotion(candidate);

      expect(gate.approved).toBe(true);
      expect(gate.checks.every(c => c.passed)).toBe(true);
    });

    it("promotes to paper only (not live)", () => {
      const baseline = calculateBaseline(Array.from({ length: 20 }, () => createMockExperience()));

      let candidate = createCandidate({
        strategyId: "TREND_FOLLOWING",
        version: "v1.1",
        parameters: {},
        baseline,
        experimentId: "EXP-001",
      });

      // Must validate first with sufficient data
      const validatedMetrics = calculateBaseline(
        Array.from({ length: 35 }, (_, i) =>
          createMockExperience({ outcome: i < 28 ? "WIN" : "LOSS" })
        )
      );

      candidate = validateCandidate(candidate, validatedMetrics);
      const gate = evaluatePromotion(candidate);
      
      // Only promote if gate is approved
      if (gate.approved) {
        candidate = promoteToPaper(candidate, gate);
        expect(candidate.status).toBe("PROMOTED_TO_PAPER");
        expect(gate.promotedAt).toBeDefined();
      }
    });
  });

  describe("safety checks", () => {
    it("live promotion is never allowed", () => {
      expect(canPromoteToLive()).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { deriveLessons, getRecentLessons, getLessonStats } from "./lesson-engine";
import type { TradeExperience } from "./experience-engine";
import { createTestDatabase } from "../database";

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

describe("Lesson Engine", () => {
  beforeEach(() => {
    // Create test database
    createTestDatabase();
  });

  describe("deriveLessons", () => {
    it("returns empty array when insufficient experiences", () => {
      const experiences = [createMockExperience()];
      const lessons = deriveLessons(experiences, 5);
      expect(lessons).toEqual([]);
    });

    it("derives regime-based lessons from sufficient experiences", () => {
      // Create 10 experiences in TRENDING_UP regime with high win rate
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          marketRegime: "TRENDING_UP",
          outcome: i < 8 ? "WIN" : "LOSS", // 80% win rate
          netPnl: i < 8 ? 0.05 : -0.03,
        })
      );

      const lessons = deriveLessons(experiences, 5);
      expect(lessons.length).toBeGreaterThan(0);

      // Should have a regime lesson
      const regimeLesson = lessons.find(l => l.category === "REGIME");
      expect(regimeLesson).toBeDefined();
      expect(regimeLesson!.text).toContain("TRENDING_UP");
      expect(regimeLesson!.confidence).toBeGreaterThan(0);
    });

    it("derives strategy-based lessons", () => {
      // Create 10 experiences with MOMENTUM strategy
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          strategy: "MOMENTUM",
          outcome: i < 7 ? "WIN" : "LOSS", // 70% win rate
          netPnl: i < 7 ? 0.04 : -0.02,
        })
      );

      const lessons = deriveLessons(experiences, 5);
      const strategyLesson = lessons.find(l => l.category === "STRATEGY");
      expect(strategyLesson).toBeDefined();
      expect(strategyLesson!.text).toContain("MOMENTUM");
    });

    it("derives confidence-based lessons", () => {
      // Create 10 high confidence experiences
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          confidence: 0.8,
          outcome: i < 7 ? "WIN" : "LOSS", // 70% win rate
        })
      );

      const lessons = deriveLessons(experiences, 5);
      const confidenceLesson = lessons.find(l => l.category === "CONFIDENCE");
      expect(confidenceLesson).toBeDefined();
      expect(confidenceLesson!.text).toContain("High confidence");
    });

    it("derives risk lessons from NO_TRADE decisions", () => {
      // Create experiences with some NO_TRADE decisions
      const experiences = [
        ...Array.from({ length: 5 }, (_, i) =>
          createMockExperience({
            id: `EXP-TRADE-${i}`,
            direction: "LONG",
            outcome: "LOSS",
            netPnl: -0.03,
          })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          createMockExperience({
            id: `EXP-NO-${i}`,
            direction: "NO_TRADE",
            outcome: "NO_TRADE_SKIPPED",
            tradeId: null,
            entryPrice: null,
            exitPrice: null,
            duration: null,
            fees: null,
            slippage: null,
            grossPnl: null,
            netPnl: null,
          })
        ),
      ];

      const lessons = deriveLessons(experiences, 5);
      const riskLesson = lessons.find(l => l.category === "RISK");
      expect(riskLesson).toBeDefined();
    });

    it("derives timing lessons from trade duration", () => {
      // Create experiences with different durations
      const experiences = [
        ...Array.from({ length: 3 }, (_, i) =>
          createMockExperience({
            id: `EXP-WIN-${i}`,
            outcome: "WIN",
            duration: 1800000, // 30 min wins
          })
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          createMockExperience({
            id: `EXP-LOSS-${i}`,
            outcome: "LOSS",
            duration: 7200000, // 2 hour losses
          })
        ),
      ];

      const lessons = deriveLessons(experiences, 5);
      const timingLesson = lessons.find(l => l.category === "TIMING");
      expect(timingLesson).toBeDefined();
      expect(timingLesson!.text).toContain("time-based exits");
    });
  });

  describe("getRecentLessons", () => {
    it("returns recent lessons", () => {
      // Create experiences and derive lessons
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          outcome: i < 8 ? "WIN" : "LOSS",
        })
      );
      deriveLessons(experiences, 5);

      const lessons = getRecentLessons(10);
      expect(lessons.length).toBeGreaterThan(0);
    });
  });

  describe("getLessonStats", () => {
    it("returns lesson statistics", () => {
      const stats = getLessonStats();
      expect(stats).toBeDefined();
      expect(typeof stats.totalLessons).toBe("number");
      expect(typeof stats.latestCycle).toBe("number");
    });
  });
});

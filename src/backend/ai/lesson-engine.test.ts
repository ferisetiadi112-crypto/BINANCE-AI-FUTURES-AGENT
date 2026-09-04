import { describe, it, expect, beforeEach } from "vitest";
import { deriveLessons, getRecentLessons, getLessonStats } from "./lesson-engine";
import type { TradeExperience } from "./experience-engine";

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
  // Run-unique suffix so lessons derived in one test run are not treated
  // as duplicates of lessons stored by a previous run (Phase 3 dedupe).
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // Small per-run variation seed so lesson statistics (and therefore lesson
  // text) differ between runs and are not flagged as duplicates.
  const seed = parseInt(runId.replace(/\D/g, "").slice(-2), 10) || 7;
  beforeEach(async () => {
    // Create test database if needed
    // Note: lesson-engine uses its own database connection
  });

  describe("deriveLessons", () => {
    it("returns empty array when insufficient experiences", async () => {
      const experiences = [createMockExperience()];
      const lessons = await deriveLessons(experiences, 5);
      expect(lessons).toEqual([]);
    });

    it("derives regime-based lessons from sufficient experiences", async () => {
      // Create 10 experiences in TRENDING_UP regime with high win rate
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          marketRegime: `TRENDING_UP-${runId}`,
          outcome: i < 8 ? "WIN" : "LOSS", // 80% win rate
          netPnl: i < 8 ? 0.05 : -0.03,
        })
      );

      const lessons = await deriveLessons(experiences, 5, { dedupe: false });
      expect(lessons.length).toBeGreaterThan(0);

      // Should have a regime lesson
      const regimeLesson = lessons.find(l => l.category === "REGIME");
      expect(regimeLesson).toBeDefined();
      expect(regimeLesson!.text).toContain("TRENDING_UP");
      expect(regimeLesson!.confidence).toBeGreaterThan(0);
    });

    it("derives strategy-based lessons", async () => {
      // Create 10 experiences with MOMENTUM strategy
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          strategy: `MOMENTUM-${runId}`,
          outcome: i < 7 ? "WIN" : "LOSS", // 70% win rate
          netPnl: i < 7 ? 0.04 : -0.02,
        })
      );

      const lessons = await deriveLessons(experiences, 5, { dedupe: false });
      const strategyLesson = lessons.find(l => l.category === "STRATEGY");
      expect(strategyLesson).toBeDefined();
      expect(strategyLesson!.text).toContain("MOMENTUM");
    });

    it("derives confidence-based lessons", async () => {
      // Create 10 high confidence experiences
      const n = 10 + (seed % 7); // 10-16 trades → varied count & rate per run
      const winCount = Math.ceil(n * 0.7);
      const experiences = Array.from({ length: n }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}-${runId}`,
          confidence: 0.8 + (i % 3) * 0.01,
          outcome: i < winCount ? "WIN" : "LOSS",
          marketRegime: `TRENDING_UP-${runId}`,
        })
      );

      const lessons = await deriveLessons(experiences, 5, { dedupe: false });
      const confidenceLesson = lessons.find(l => l.category === "CONFIDENCE");
      expect(confidenceLesson).toBeDefined();
      expect(confidenceLesson!.text).toContain("High confidence");
    });

    it("derives risk lessons from NO_TRADE decisions", async () => {
      // Create experiences with some NO_TRADE decisions
      const lossCount = 3 + (seed % 4); // varied trade count per run
      const noTradeCount = 3 + (seed % 4); // varied no-trade count per run
      const experiences = [
        ...Array.from({ length: lossCount }, (_, i) =>
          createMockExperience({
            id: `EXP-TRADE-${i}-${runId}`,
            direction: "LONG",
            outcome: "LOSS",
            netPnl: -0.03,
            marketRegime: `TRENDING_UP-${runId}`,
          })
        ),
        ...Array.from({ length: noTradeCount }, (_, i) =>
          createMockExperience({
            id: `EXP-NO-${i}-${runId}`,
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
            marketRegime: `TRENDING_UP-${runId}`,
          })
        ),
      ];

      const lessons = await deriveLessons(experiences, 5, { dedupe: false });
      const riskLesson = lessons.find(l => l.category === "RISK");
      expect(riskLesson).toBeDefined();
    });

    it("derives timing lessons from trade duration", async () => {
      // Create experiences with different durations
      const experiences = [
        ...Array.from({ length: 3 }, (_, i) =>
          createMockExperience({
            id: `EXP-WIN-${i}-${runId}`,
            outcome: "WIN",
            duration: (20 + (seed % 20)) * 60000, // varied win duration per run
            marketRegime: `TRENDING_UP-${runId}`,
          })
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          createMockExperience({
            id: `EXP-LOSS-${i}-${runId}`,
            outcome: "LOSS",
            duration: (90 + (seed % 30)) * 60000, // varied loss duration per run
            marketRegime: `TRENDING_UP-${runId}`,
          })
        ),
      ];

      const lessons = await deriveLessons(experiences, 5, { dedupe: false });
      const timingLesson = lessons.find(l => l.category === "TIMING");
      expect(timingLesson).toBeDefined();
      expect(timingLesson!.text).toContain("time-based exits");
    });
  });

  describe("getRecentLessons", () => {
    it("returns recent lessons", async () => {
      // Create experiences and derive lessons
      const experiences = Array.from({ length: 10 }, (_, i) =>
        createMockExperience({
          id: `EXP-${i}`,
          outcome: i < 8 ? "WIN" : "LOSS",
        })
      );
      await deriveLessons(experiences, 5, { dedupe: false });

      const lessons = await getRecentLessons(10);
      expect(lessons.length).toBeGreaterThan(0);
    });
  });

  describe("getLessonStats", () => {
    it("returns lesson statistics", async () => {
      const stats = await getLessonStats();
      expect(stats).toBeDefined();
      expect(typeof stats.totalLessons).toBe("number");
      expect(typeof stats.latestCycle).toBe("number");
    });
  });
});

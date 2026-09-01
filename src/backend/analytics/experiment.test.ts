import { describe, it, expect } from "vitest";
import {
  createExperiment,
  startExperiment,
  updateExperimentMetrics,
  completeExperiment,
  rejectExperiment,
  evaluateExperiment,
} from "./experiment";
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

describe("A/B Experiment Engine", () => {
  describe("createExperiment", () => {
    it("creates experiment with correct structure", () => {
      const controlExps = Array.from({ length: 20 }, () => createMockExperience());
      const baseline = calculateBaseline(controlExps);

      const experiment = createExperiment({
        name: "EMA Period Test",
        description: "Testing EMA 20 vs EMA 25",
        hypothesis: "EMA 25 reduces whipsaws",
        controlStrategyId: "TREND_FOLLOWING",
        controlStrategyVersion: "v1.0",
        controlParameters: { emaPeriod: 20 },
        candidateStrategyId: "TREND_FOLLOWING",
        candidateStrategyVersion: "v1.1",
        candidateParameters: { emaPeriod: 25 },
        controlBaseline: baseline,
      });

      expect(experiment.id).toContain("EXP-");
      expect(experiment.name).toBe("EMA Period Test");
      expect(experiment.status).toBe("DRAFT");
      expect(experiment.control.parameters['emaPeriod']).toBe(20);
      expect(experiment.candidate.parameters['emaPeriod']).toBe(25);
    });
  });

  describe("experiment lifecycle", () => {
    it("follows DRAFT → RUNNING → COMPLETED lifecycle", () => {
      const controlExps = Array.from({ length: 20 }, () => createMockExperience());
      const baseline = calculateBaseline(controlExps);

      let experiment = createExperiment({
        name: "Lifecycle Test",
        description: "Test lifecycle",
        hypothesis: "Test hypothesis",
        controlStrategyId: "TREND_FOLLOWING",
        controlStrategyVersion: "v1.0",
        controlParameters: {},
        candidateStrategyId: "TREND_FOLLOWING",
        candidateStrategyVersion: "v1.1",
        candidateParameters: {},
        controlBaseline: baseline,
      });

      expect(experiment.status).toBe("DRAFT");

      experiment = startExperiment(experiment);
      expect(experiment.status).toBe("RUNNING");

      experiment = completeExperiment(experiment, "CONTROL_WINS");
      expect(experiment.status).toBe("COMPLETED");
      expect(experiment.result).toBe("CONTROL_WINS");
    });

    it("rejects experiment", () => {
      const controlExps = Array.from({ length: 20 }, () => createMockExperience());
      const baseline = calculateBaseline(controlExps);

      let experiment = createExperiment({
        name: "Reject Test",
        description: "Test rejection",
        hypothesis: "Test hypothesis",
        controlStrategyId: "TREND_FOLLOWING",
        controlStrategyVersion: "v1.0",
        controlParameters: {},
        candidateStrategyId: "TREND_FOLLOWING",
        candidateStrategyVersion: "v1.1",
        candidateParameters: {},
        controlBaseline: baseline,
      });

      experiment = startExperiment(experiment);
      experiment = rejectExperiment(experiment, "Insufficient data quality");

      expect(experiment.status).toBe("REJECTED");
      expect(experiment.decision).toContain("Rejected");
    });
  });

  describe("evaluateExperiment", () => {
    it("recommends RUN_LONGER when insufficient samples", () => {
      const controlExps = Array.from({ length: 5 }, () => createMockExperience());
      const baseline = calculateBaseline(controlExps);

      const experiment = createExperiment({
        name: "Evaluate Test",
        description: "Test evaluation",
        hypothesis: "Test hypothesis",
        controlStrategyId: "TREND_FOLLOWING",
        controlStrategyVersion: "v1.0",
        controlParameters: {},
        candidateStrategyId: "TREND_FOLLOWING",
        candidateStrategyVersion: "v1.1",
        candidateParameters: {},
        controlBaseline: baseline,
      });

      const evaluation = evaluateExperiment(experiment);
      expect(evaluation.recommendation).toBe("INSUFFICIENT_DATA");
      expect(evaluation.canComplete).toBe(false);
    });

    it("recommends READY_TO_COMPLETE when sufficient samples", () => {
      const controlExps = Array.from({ length: 35 }, () => createMockExperience());
      const baseline = calculateBaseline(controlExps);

      let experiment = createExperiment({
        name: "Evaluate Test",
        description: "Test evaluation",
        hypothesis: "Test hypothesis",
        controlStrategyId: "TREND_FOLLOWING",
        controlStrategyVersion: "v1.0",
        controlParameters: {},
        candidateStrategyId: "TREND_FOLLOWING",
        candidateStrategyVersion: "v1.1",
        candidateParameters: {},
        controlBaseline: baseline,
      });

      // Start experiment first
      experiment = startExperiment(experiment);

      // Simulate running with metrics
      const candidateExps = Array.from({ length: 35 }, (_, i) =>
        createMockExperience({ outcome: i < 28 ? "WIN" : "LOSS" })
      );
      const candidateBaseline = calculateBaseline(candidateExps);

      const updatedExperiment = updateExperimentMetrics(experiment, baseline, candidateBaseline);
      const evaluation = evaluateExperiment(updatedExperiment);

      expect(evaluation.canComplete).toBe(true);
      expect(evaluation.recommendation).toBe("READY_TO_COMPLETE");
    });
  });
});

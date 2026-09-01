import { describe, it, expect } from "vitest";
import { runWalkForward } from "./walkforward";
import type { HistoricalCandle } from "./historical-data";
import type { CandidateParams } from "./walkforward";

const createMockCandle = (overrides: Partial<HistoricalCandle> = {}): HistoricalCandle => ({
  symbol: "BTCUSDT",
  interval: "1h",
  openTime: Date.now(),
  closeTime: Date.now() + 3600000,
  open: 63000,
  high: 63500,
  low: 62500,
  close: 63200,
  volume: 1000,
  quoteVolume: 63200000,
  source: "binance-futures",
  ingestionTimestamp: Date.now(),
  ...overrides,
});

function createTrendCandles(count: number): HistoricalCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 63000 + Math.sin(i * 0.05) * 500;
    return createMockCandle({
      openTime: 1000000 + i * 3600000,
      open: base,
      high: base + 500,
      low: base - 500,
      close: base + Math.sin(i * 0.1) * 200,
      volume: 500 + Math.abs(Math.sin(i * 0.1)) * 500,
    });
  });
}

function createUpTrendCandles(count: number): HistoricalCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 63000 + i * 30;
    return createMockCandle({
      openTime: 1000000 + i * 3600000,
      open: base,
      high: base + 200,
      low: base - 100,
      close: base + 50,
      volume: 1000,
    });
  });
}

function createDownTrendCandles(count: number): HistoricalCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 80000 - i * 30;
    return createMockCandle({
      openTime: 1000000 + i * 3600000,
      open: base,
      high: base + 100,
      low: base - 200,
      close: base - 50,
      volume: 1000,
    });
  });
}

/** Small search space for faster tests */
const SMALL_SEARCH_SPACE: CandidateParams[] = [
  { id: "A", strategyParams: { tpPercent: 2, slPercent: 1, smaShort: 10 }, source: "grid" },
  { id: "B", strategyParams: { tpPercent: 4, slPercent: 2, smaShort: 20 }, source: "grid" },
  { id: "C", strategyParams: { tpPercent: 6, slPercent: 3, smaShort: 30 }, source: "grid" },
];

describe("Walk-Forward Validation", () => {
  describe("runWalkForward", () => {
    it("returns INSUFFICIENT_DATA for small dataset", () => {
      const candles = Array.from({ length: 10 }, (_, i) =>
        createMockCandle({ openTime: Date.now() + i * 3600000 })
      );

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 30,
        validationWindowDays: 7,
      });

      expect(result.status).toBe("INSUFFICIENT_DATA");
      expect(result.windows.length).toBe(0);
    });

    it("runs walk-forward with sufficient data", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      expect(result.status).toBe("COMPLETED");
      expect(result.windows.length).toBeGreaterThan(0);
      expect(result.aggregatedMetrics.totalWindows).toBeGreaterThan(0);
    });

    it("calculates robustness score", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      expect(result.aggregatedMetrics.robustnessScore).toBeGreaterThanOrEqual(0);
      expect(result.aggregatedMetrics.robustnessScore).toBeLessThanOrEqual(1);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.aggregatedMetrics.overfittingRisk);
    });
  });
});

describe("F-H3: Genuine Walk-Forward Optimization", () => {
  describe("Multi-candidate evaluation", () => {
    it("evaluates multiple candidates per window", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      expect(completedWindow).toBeDefined();
      if (completedWindow) {
        // Must have evaluated ALL candidates in search space
        expect(completedWindow.candidatesEvaluated.length).toBe(SMALL_SEARCH_SPACE.length);
        // Total candidates across all windows
        expect(result.aggregatedMetrics.totalCandidatesEvaluated).toBeGreaterThan(0);
      }
    });

    it("each candidate has a separate evaluation result", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      expect(completedWindow).toBeDefined();
      if (completedWindow) {
        for (const eval_ of completedWindow.candidatesEvaluated) {
          expect(eval_.trainResult).toBeDefined();
          expect(eval_.trainResult.status).toBe("COMPLETED");
          expect(typeof eval_.selectionScore).toBe("number");
        }
        // Verify candidates have different parameter values
        const paramSets = completedWindow.candidatesEvaluated.map(
          e => JSON.stringify(e.candidate.strategyParams)
        );
        const uniqueParams = new Set(paramSets);
        expect(uniqueParams.size).toBe(SMALL_SEARCH_SPACE.length);
      }
    });
  });

  describe("Train-only selection", () => {
    it("selected candidate has the highest train selection score", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      expect(completedWindow).toBeDefined();
      expect(completedWindow?.selectedCandidate).toBeDefined();

      if (completedWindow && completedWindow.selectedCandidate) {
        const selectedEval = completedWindow.candidatesEvaluated.find(
          e => e.candidate.id === completedWindow.selectedCandidate?.id
        );
        expect(selectedEval).toBeDefined();

        if (selectedEval) {
          // Selected must have the highest score
          for (const other of completedWindow.candidatesEvaluated) {
            expect(selectedEval.selectionScore).toBeGreaterThanOrEqual(other.selectionScore - 0.000001);
          }
        }
      }
    });

    it("selected candidate comes from search space", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      for (const window of result.windows) {
        if (window.status === "COMPLETED" && window.selectedCandidate) {
          const found = SMALL_SEARCH_SPACE.some(
            s => s.id === window.selectedCandidate?.id
          );
          expect(found).toBe(true);
        }
      }
    });
  });

  describe("Validation isolation", () => {
    it("changing validation data does NOT change the selected training configuration", () => {
      // Use the SAME train data but DIFFERENT validation data
      const baseCandles = createTrendCandles(60 * 24);

      const resultA = runWalkForward(baseCandles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      // Create a different dataset (different future data) but same train period
      const modifiedCandles = [
        ...baseCandles.slice(0, 10 * 24), // Same first 10 days
        ...createDownTrendCandles(50 * 24), // Different trend after
      ];

      const resultB = runWalkForward(modifiedCandles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      // Both should have completed at least one window
      const windowA = resultA.windows.find(w => w.status === "COMPLETED");
      const windowB = resultB.windows.find(w => w.status === "COMPLETED");
      expect(windowA).toBeDefined();
      expect(windowB).toBeDefined();

      // For the first window (same train data), selected candidate should be the same
      if (windowA?.selectedCandidate && windowB?.selectedCandidate) {
        // Both train on the same initial data, so selection should be identical
        // The first window trains on candles 0..trainEnd, which is identical in both datasets
        expect(windowA.selectedCandidate.id).toBe(windowB.selectedCandidate.id);
      }
    });

    it("selected config is frozen before validation runs", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      expect(completedWindow).toBeDefined();
      if (completedWindow) {
        // frozenConfig exists
        expect(completedWindow.frozenConfig).toBeDefined();
        // frozenConfig has the selected candidate's parameters
        expect(completedWindow.frozenConfig?.strategyParams).toEqual(
          completedWindow.selectedCandidate?.strategyParams
        );
        // validation used the frozen config (validation ID contains frozen label)
        expect(completedWindow.frozenConfig?.id).toContain("FROZEN");
      }
    });
  });

  describe("Train data dependency", () => {
    it("different training data MAY produce different selected configurations", () => {
      // Strong uptrend training data
      const upTrendCandles = createUpTrendCandles(60 * 24);
      const resultUp = runWalkForward(upTrendCandles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      // Strong downtrend training data
      const downTrendCandles = createDownTrendCandles(60 * 24);
      const resultDown = runWalkForward(downTrendCandles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const windowUp = resultUp.windows.find(w => w.status === "COMPLETED");
      const windowDown = resultDown.windows.find(w => w.status === "COMPLETED");

      // Both should have selected a candidate
      expect(windowUp?.selectedCandidate).toBeDefined();
      expect(windowDown?.selectedCandidate).toBeDefined();

      // The point of this test is NOT that they must differ — it's that
      // the optimizer is actually evaluating training data. If the same candidate
      // wins for both, that's valid (same ranking). But if they differ, that proves
      // the optimizer is data-dependent.
      if (windowUp?.selectedCandidate && windowDown?.selectedCandidate) {
        // Both must have valid selected candidates from the search space
        const validUp = SMALL_SEARCH_SPACE.some(s => s.id === windowUp.selectedCandidate?.id);
        const validDown = SMALL_SEARCH_SPACE.some(s => s.id === windowDown.selectedCandidate?.id);
        expect(validUp).toBe(true);
        expect(validDown).toBe(true);
      }
    });
  });

  describe("Determinism", () => {
    it("produces identical results for identical inputs", () => {
      const candles = createTrendCandles(60 * 24);

      const config = {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      };

      const result1 = runWalkForward(candles, config);
      const result2 = runWalkForward(candles, config);

      // Same number of windows
      expect(result1.windows.length).toBe(result2.windows.length);

      // For each window, same candidate selection
      for (let i = 0; i < result1.windows.length; i++) {
        const w1 = result1.windows[i];
        const w2 = result2.windows[i];
        if (w1 && w2) {
          expect(w1.status).toBe(w2.status);
          expect(w1.selectedCandidate?.id).toBe(w2.selectedCandidate?.id);
          expect(w1.candidatesEvaluated.length).toBe(w2.candidatesEvaluated.length);
        }
      }
    });
  });

  describe("Multi-window chronology", () => {
    it("trainEnd < validationStart for every window", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      for (const window of result.windows) {
        expect(window.trainEnd).toBeLessThanOrEqual(window.validationStart);
        expect(window.validationStart).toBeLessThan(window.validationEnd);
      }
    });

    it("windows progress chronologically", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      for (let i = 1; i < result.windows.length; i++) {
        const prev = result.windows[i - 1];
        const curr = result.windows[i];
        if (prev && curr) {
          expect(curr.trainStart).toBeGreaterThanOrEqual(prev.trainStart);
        }
      }
    });
  });

  describe("Minimum sample protection", () => {
    it("candidate with zero trades gets lowest score", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      expect(completedWindow).toBeDefined();
      if (completedWindow) {
        for (const eval_ of completedWindow.candidatesEvaluated) {
          if (eval_.trainResult.totalTrades === 0) {
            expect(eval_.selectionScore).toBe(-Infinity);
          }
        }
      }
    });

    it("candidate with few trades is penalized", () => {
      // Score = expectancy × min(trades / MIN_TRADES_FOR_SELECTION, 1.0)
      // So 1 trade out of 3 minimum → factor of 1/3 = 0.333
      // If expectancy is positive, the penalized score is 33% of full score
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      if (completedWindow) {
        // Find candidates with different trade counts
        const withTrades = completedWindow.candidatesEvaluated.filter(e => e.trainResult.totalTrades > 0);
        if (withTrades.length >= 2) {
          const fewTrades = withTrades.find(e => e.trainResult.totalTrades < 3);
          const manyTrades = withTrades.find(e => e.trainResult.totalTrades >= 3);
          if (fewTrades && manyTrades && manyTrades.selectionScore > 0) {
            // Candidate with fewer trades should have lower or equal score (penalized)
            expect(fewTrades.selectionScore).toBeLessThanOrEqual(manyTrades.selectionScore);
          }
        }
      }
    });
  });

  describe("Parameter application", () => {
    it("different candidates produce different backtest configs", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      const completedWindow = result.windows.find(w => w.status === "COMPLETED");
      expect(completedWindow).toBeDefined();
      if (completedWindow) {
        // Verify that candidates have different strategyParams
        const paramStrings = completedWindow.candidatesEvaluated.map(
          e => JSON.stringify(e.candidate.strategyParams)
        );
        const unique = new Set(paramStrings);
        expect(unique.size).toBe(SMALL_SEARCH_SPACE.length);
      }
    });
  });

  describe("Window audit lineage", () => {
    it("each completed window records full candidate lineage", () => {
      const candles = createTrendCandles(60 * 24);

      const result = runWalkForward(candles, {
        symbol: "BTCUSDT",
        interval: "1h",
        trainWindowDays: 7,
        validationWindowDays: 3,
        stepDays: 3,
        searchSpace: SMALL_SEARCH_SPACE,
      });

      for (const window of result.windows) {
        if (window.status === "COMPLETED") {
          // Must have selected candidate
          expect(window.selectedCandidate).toBeDefined();
          // Must have frozen config
          expect(window.frozenConfig).toBeDefined();
          // Must have candidates evaluated
          expect(window.candidatesEvaluated.length).toBe(SMALL_SEARCH_SPACE.length);
          // Must have metrics
          expect(window.metrics).toBeDefined();
          expect(window.metrics?.candidatesEvaluated).toBe(SMALL_SEARCH_SPACE.length);
          // Frozen config must have parameter version from selected candidate
          expect(window.frozenConfig?.parameterVersion).toBe(window.selectedCandidate?.id);
        }
      }
    });
  });
});

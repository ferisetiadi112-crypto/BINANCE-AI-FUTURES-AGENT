/**
 * Walk-Forward Optimization Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Implements genuine walk-forward optimization with parameter search.
 *
 * Methodology (per window):
 *   TRAIN → GENERATE CANDIDATES → EVALUATE ALL → SELECT BEST → FREEZE → VALIDATE/OOS
 *
 * SAFETY:
 *   - Validation data NEVER influences candidate selection
 *   - Same selection rule used consistently across all windows
 *   - Deterministic: same inputs → same outputs
 *   - Risk Engine remains highest authority for all candidates
 *   - Minimum sample protection prevents false winners
 */

import type { HistoricalCandle } from "./historical-data";
import type { BacktestConfig, BacktestResult } from "./engine";
import { runBacktest } from "./engine";
import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

/** A single parameter set to evaluate as a candidate */
export type CandidateParams = {
  /** Unique label for this parameter combination */
  id: string;
  /** Actual parameter values applied to the backtest config */
  strategyParams: Record<string, number>;
  /** Which generation strategy produced this candidate */
  source: "baseline" | "variation" | "grid";
};

/** Evaluation result for one candidate on training data */
export type CandidateEvaluation = {
  candidate: CandidateParams;
  trainResult: BacktestResult;
  /** Risk-adjusted selection score. Higher = better. */
  selectionScore: number;
};

export type WalkForwardWindow = {
  id: string;
  windowIndex: number;
  trainStart: number;
  trainEnd: number;
  validationStart: number;
  validationEnd: number;
  /** All candidates evaluated during training */
  candidatesEvaluated: CandidateEvaluation[];
  /** The candidate selected as best from training */
  selectedCandidate: CandidateParams | null;
  /** The config used for validation (frozen from selected candidate) */
  frozenConfig: BacktestConfig | null;
  trainResult: BacktestResult | null;
  validationResult: BacktestResult | null;
  status: "PENDING" | "OPTIMIZING" | "VALIDATING" | "COMPLETED" | "FAILED";
  metrics: {
    trainWinRate: number;
    trainPnl: number;
    trainExpectancy: number;
    validationWinRate: number;
    validationPnl: number;
    robustnessScore: number;
    candidatesEvaluated: number;
  } | null;
};

export type WalkForwardConfig = {
  symbol: string;
  interval: string;
  trainWindowDays?: number;
  validationWindowDays?: number;
  stepDays?: number;
  initialCapital?: number;
  feeRate?: number;
  slippageRate?: number;
  /** Optional: custom search space. If not provided, uses DEFAULT_SEARCH_SPACE. */
  searchSpace?: CandidateParams[];
};

export type WalkForwardResultConfig = {
  symbol: string;
  interval: string;
  trainWindowDays: number;
  validationWindowDays: number;
  stepDays: number;
  totalDays: number;
};

export type WalkForwardResult = {
  id: string;
  config: WalkForwardResultConfig;
  windows: WalkForwardWindow[];
  aggregatedMetrics: {
    totalWindows: number;
    completedWindows: number;
    averageValidationWinRate: number;
    averageValidationPnl: number;
    robustnessScore: number;
    overfittingRisk: "LOW" | "MEDIUM" | "HIGH";
    totalCandidatesEvaluated: number;
  };
  status: "COMPLETED" | "PARTIAL" | "INSUFFICIENT_DATA";
  createdAt: string;
};

// ─── Configuration ──────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const DEFAULT_TRAIN_DAYS = 30;
const DEFAULT_VALIDATION_DAYS = 7;
const DEFAULT_STEP_DAYS = 7;

/**
 * Minimum number of trades a candidate must produce to be eligible for selection.
 * Candidates with fewer trades are penalized to prevent false winners from
 * a single lucky trade being selected as "best".
 */
const MIN_TRADES_FOR_SELECTION = 3;

/**
 * Default parameter search space.
 *
 * Each parameter varies around a baseline value (the project's current defaults):
 *   tpPercent: baseline=4% → candidates [2, 4, 6]
 *   slPercent: baseline=2% → candidates [1, 2, 3]
 *   smaShort:  baseline=20  → candidates [10, 20, 30]
 *
 * Total candidates: 3 × 3 × 3 = 27
 *
 * This is deliberately small and deterministic:
 *   - No arbitrary/exotic values
 *   - All values are financially plausible
 *   - Baseline is always included (no degradation from current behavior)
 *   - Grid is explicit, auditable, versionable
 */
const DEFAULT_SEARCH_SPACE: CandidateParams[] = (() => {
  const tpValues = [2, 4, 6];
  const slValues = [1, 2, 3];
  const smaValues = [10, 20, 30];
  const candidates: CandidateParams[] = [];

  for (const tp of tpValues) {
    for (const sl of slValues) {
      for (const sma of smaValues) {
        candidates.push({
          id: `C-TP${tp}-SL${sl}-SMA${sma}`,
          strategyParams: { tpPercent: tp, slPercent: sl, smaShort: sma },
          source: "grid",
        });
      }
    }
  }
  return candidates;
})();

// ─── Selection Metric ───────────────────────────────────────────────

/**
 * Calculate selection score for a candidate based on TRAIN results only.
 *
 * Metric: RISK-ADJUSTED EXPECTANCY
 *
 * score = expectancy × min(trades / MIN_TRADES_FOR_SELECTION, 1.0)
 *
 * Where:
 *   expectancy = netPnl / totalTrades  (average PnL per trade)
 *
 * This metric:
 *   - Rewards consistent profitability (positive expectancy)
 *   - Penalizes candidates with too few trades (sample protection)
 *   - Uses the SAME metric for ALL candidates in ALL windows
 *   - Does NOT use drawdown (which could encourage overfitting to avoid drawdown
 *     rather than actually being profitable)
 *
 * Tie-break (when scores are identical):
 *   1. Higher win rate
 *   2. Higher net PnL
 *   3. More trades
 *   4. Lower parameter values (deterministic ordering: tp < sl < sma)
 */
function calculateSelectionScore(result: BacktestResult): number {
  if (result.status !== "COMPLETED" || result.totalTrades === 0) {
    return -Infinity;
  }

  const expectancy = result.netPnl / result.totalTrades;
  const sampleFactor = Math.min(result.totalTrades / MIN_TRADES_FOR_SELECTION, 1.0);

  return expectancy * sampleFactor;
}

/** Deterministic tie-breaker: returns true if candidate A beats candidate B when scores are tied */
function tieBreaker(
  evalA: CandidateEvaluation,
  evalB: CandidateEvaluation,
): boolean {
  const rA = evalA.trainResult;
  const rB = evalB.trainResult;

  // Tie-break 1: higher win rate
  if (rA.winRate !== rB.winRate) return rA.winRate > rB.winRate;

  // Tie-break 2: higher net PnL
  if (Math.abs(rA.netPnl - rB.netPnl) > 0.000001) return rA.netPnl > rB.netPnl;

  // Tie-break 3: more trades
  if (rA.totalTrades !== rB.totalTrades) return rA.totalTrades > rB.totalTrades;

  // Tie-break 4: deterministic parameter ordering (lower tpPercent first, then sl, then sma)
  const pA = evalA.candidate.strategyParams;
  const pB = evalB.candidate.strategyParams;
  const tpA = pA["tpPercent"] ?? 0;
  const tpB = pB["tpPercent"] ?? 0;
  if (tpA !== tpB) return tpA < tpB;
  const slA = pA["slPercent"] ?? 0;
  const slB = pB["slPercent"] ?? 0;
  if (slA !== slB) return slA < slB;
  const smaA = pA["smaShort"] ?? 0;
  const smaB = pB["smaShort"] ?? 0;
  return smaA < smaB;
}

// ─── Walk-Forward Engine ────────────────────────────────────────────

let wfCounter = 0;

export function runWalkForward(
  candles: HistoricalCandle[],
  config: {
    symbol: string;
    interval: string;
    trainWindowDays?: number;
    validationWindowDays?: number;
    stepDays?: number;
    initialCapital?: number;
    feeRate?: number;
    slippageRate?: number;
    searchSpace?: CandidateParams[];
  },
): WalkForwardResult {
  wfCounter++;

  const trainDays = config.trainWindowDays || DEFAULT_TRAIN_DAYS;
  const validationDays = config.validationWindowDays || DEFAULT_VALIDATION_DAYS;
  const stepDays = config.stepDays || DEFAULT_STEP_DAYS;
  const searchSpace = config.searchSpace || DEFAULT_SEARCH_SPACE;

  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  if (!firstCandle || !lastCandle) {
    return createInsufficientDataResult(config, 0, searchSpace);
  }
  const totalDays = (lastCandle.openTime - firstCandle.openTime) / DAY_MS;

  logger.info(
    "walk-forward",
    `Starting walk-forward optimization: ${config.symbol}, ` +
    `total days: ${totalDays.toFixed(1)}, candidates: ${searchSpace.length}`
  );

  // Check if we have enough data
  if (totalDays < trainDays + validationDays) {
    return createInsufficientDataResult(config, totalDays, searchSpace);
  }

  // Generate windows
  const windows: WalkForwardWindow[] = [];
  let windowIndex = 0;
  let currentStart = firstCandle.openTime;
  let totalCandidatesEvaluated = 0;

  while (currentStart + (trainDays + validationDays) * DAY_MS <= lastCandle.openTime) {
    const trainStart = currentStart;
    const trainEnd = trainStart + trainDays * DAY_MS;
    const validationStart = trainEnd;
    const validationEnd = validationStart + validationDays * DAY_MS;

    const windowId = `WF-W${windowIndex}`;

    const window: WalkForwardWindow = {
      id: windowId,
      windowIndex,
      trainStart,
      trainEnd,
      validationStart,
      validationEnd,
      candidatesEvaluated: [],
      selectedCandidate: null,
      frozenConfig: null,
      trainResult: null,
      validationResult: null,
      status: "PENDING",
      metrics: null,
    };

    windows.push(window);

    // ─── TRAINING: Generate candidates and evaluate ────────────────
    window.status = "OPTIMIZING";
    const trainCandles = candles.filter(c => c.openTime >= trainStart && c.openTime < trainEnd);

    // Need at least 200 candles for production indicator warm-up (EMA200)
    // plus train window candles for actual decision-making
    if (candles.length < 200 || trainCandles.length < 10) {
      window.status = "FAILED";
      windowIndex++;
      currentStart += stepDays * DAY_MS;
      continue;
    }

    // Evaluate every candidate on TRAIN ONLY
    const evaluations: CandidateEvaluation[] = [];

    for (const candidate of searchSpace) {
      const candidateConfig: BacktestConfig = {
        id: `${windowId}-${candidate.id}`,
        name: `WF-${windowIndex}-${candidate.id}`,
        symbol: config.symbol,
        interval: config.interval,
        startTime: trainStart,
        endTime: trainEnd,
        initialCapital: config.initialCapital || 5.0,
        feeRate: config.feeRate || 0.0004,
        slippageRate: config.slippageRate || 0.0001,
        strategyVersion: "v1.0",
        modelVersion: "rule-based-v1",
        parameterVersion: candidate.id,
        riskConfig: {
          dailyProfitCap: 0.50,
          dailyLossLimit: 0.50,
          maxLeverage: 10,
          maxExposurePercent: 80,
        },
        strategyParams: { ...candidate.strategyParams },
      };

      // Pass full candle history for indicator warm-up (EMA200 requires ~200 candles)
      // The backtest engine uses config.startTime to only make decisions within the train window
      const trainResult = runBacktest(candles, candidateConfig);
      const selectionScore = calculateSelectionScore(trainResult);

      evaluations.push({
        candidate,
        trainResult,
        selectionScore,
      });

      totalCandidatesEvaluated++;
    }

    window.candidatesEvaluated = evaluations;

    // ─── SELECT: Best candidate based on TRAIN ONLY ────────────────
    let bestEvaluation: CandidateEvaluation | null = null;
    for (const eval_ of evaluations) {
      if (bestEvaluation === null) {
        bestEvaluation = eval_;
      } else {
        // Higher score is better
        if (
          eval_.selectionScore > bestEvaluation.selectionScore ||
          (
            Math.abs(eval_.selectionScore - bestEvaluation.selectionScore) < 0.000001 &&
            tieBreaker(eval_, bestEvaluation)
          )
        ) {
          bestEvaluation = eval_;
        }
      }
    }

    if (bestEvaluation === null || bestEvaluation.selectionScore === -Infinity) {
      window.status = "FAILED";
      windowIndex++;
      currentStart += stepDays * DAY_MS;
      continue;
    }

    window.selectedCandidate = bestEvaluation.candidate;
    window.trainResult = bestEvaluation.trainResult;

    // ─── FREEZE: Lock the selected configuration ───────────────────
    const frozenConfig: BacktestConfig = {
      id: `${windowId}-FROZEN-${bestEvaluation.candidate.id}`,
      name: `WF-${windowIndex}-Frozen-${bestEvaluation.candidate.id}`,
      symbol: config.symbol,
      interval: config.interval,
      startTime: validationStart,
      endTime: validationEnd,
      initialCapital: config.initialCapital || 5.0,
      feeRate: config.feeRate || 0.0004,
      slippageRate: config.slippageRate || 0.0001,
      strategyVersion: "v1.0",
      modelVersion: "rule-based-v1",
      parameterVersion: bestEvaluation.candidate.id,
      riskConfig: {
        dailyProfitCap: 0.50,
        dailyLossLimit: 0.50,
        maxLeverage: 10,
        maxExposurePercent: 80,
      },
      strategyParams: { ...bestEvaluation.candidate.strategyParams },
    };

    window.frozenConfig = frozenConfig;

    // ─── VALIDATION: Run OOS with frozen config ────────────────────
    window.status = "VALIDATING";
    const validationCandles = candles.filter(c => c.openTime >= validationStart && c.openTime < validationEnd);

    // Pass full candle history for indicator warm-up; backtest uses config.startTime/endTime
    window.validationResult = runBacktest(candles, frozenConfig);

    // ─── RECORD RESULTS ────────────────────────────────────────────
    if (window.validationResult.status === "COMPLETED") {
      const trainWinRate = bestEvaluation.trainResult.winRate;
      const validationWinRate = window.validationResult.winRate;
      const robustnessScore = calculateRobustnessScore(trainWinRate, validationWinRate);

      window.metrics = {
        trainWinRate,
        trainPnl: bestEvaluation.trainResult.netPnl,
        trainExpectancy: bestEvaluation.selectionScore,
        validationWinRate,
        validationPnl: window.validationResult.netPnl,
        robustnessScore,
        candidatesEvaluated: evaluations.length,
      };

      window.status = "COMPLETED";
    } else {
      window.status = "FAILED";
    }

    windowIndex++;
    currentStart += stepDays * DAY_MS;
  }

  // Aggregate results
  const completedWindows = windows.filter(w => w.status === "COMPLETED");
  const aggregatedMetrics = aggregateWindowResults(completedWindows, totalCandidatesEvaluated);

  const status = completedWindows.length === windows.length
    ? "COMPLETED"
    : completedWindows.length > 0
      ? "PARTIAL"
      : "INSUFFICIENT_DATA";

  const result: WalkForwardResult = {
    id: `WF-${wfCounter}`,
    config: {
      symbol: config.symbol,
      interval: config.interval,
      trainWindowDays: trainDays,
      validationWindowDays: validationDays,
      stepDays,
      totalDays,
    },
    windows,
    aggregatedMetrics,
    status,
    createdAt: new Date().toISOString(),
  };

  logger.info(
    "walk-forward",
    `Walk-forward optimization complete: ${completedWindows.length}/${windows.length} windows, ` +
    `candidates evaluated: ${totalCandidatesEvaluated}, robustness: ${aggregatedMetrics.overfittingRisk}`
  );

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────

function calculateRobustnessScore(trainWinRate: number, validationWinRate: number): number {
  // Robustness score: how similar train and validation performance are
  // 1.0 = identical, 0.0 = completely different
  const diff = Math.abs(trainWinRate - validationWinRate) / 100;
  return Math.max(0, 1 - diff);
}

function aggregateWindowResults(
  windows: WalkForwardWindow[],
  totalCandidatesEvaluated: number,
): WalkForwardResult["aggregatedMetrics"] {
  if (windows.length === 0) {
    return {
      totalWindows: 0,
      completedWindows: 0,
      averageValidationWinRate: 0,
      averageValidationPnl: 0,
      robustnessScore: 0,
      overfittingRisk: "HIGH",
      totalCandidatesEvaluated,
    };
  }

  const totalWindows = windows.length;
  const completedWindows = windows.filter(w => w.metrics !== null).length;

  const avgValWinRate = windows
    .filter(w => w.metrics)
    .reduce((sum, w) => sum + (w.metrics?.validationWinRate || 0), 0) / completedWindows;

  const avgValPnl = windows
    .filter(w => w.metrics)
    .reduce((sum, w) => sum + (w.metrics?.validationPnl || 0), 0) / completedWindows;

  const avgRobustness = windows
    .filter(w => w.metrics)
    .reduce((sum, w) => sum + (w.metrics?.robustnessScore || 0), 0) / completedWindows;

  let overfittingRisk: "LOW" | "MEDIUM" | "HIGH";
  if (avgRobustness > 0.8) {
    overfittingRisk = "LOW";
  } else if (avgRobustness > 0.5) {
    overfittingRisk = "MEDIUM";
  } else {
    overfittingRisk = "HIGH";
  }

  return {
    totalWindows,
    completedWindows,
    averageValidationWinRate: avgValWinRate,
    averageValidationPnl: avgValPnl,
    robustnessScore: avgRobustness,
    overfittingRisk,
    totalCandidatesEvaluated,
  };
}

function createInsufficientDataResult(
  config: WalkForwardConfig,
  totalDays: number,
  searchSpace: CandidateParams[],
): WalkForwardResult {
  return {
    id: `WF-${wfCounter}`,
    config: {
      symbol: config.symbol,
      interval: config.interval,
      trainWindowDays: config.trainWindowDays || DEFAULT_TRAIN_DAYS,
      validationWindowDays: config.validationWindowDays || DEFAULT_VALIDATION_DAYS,
      stepDays: config.stepDays || DEFAULT_STEP_DAYS,
      totalDays,
    },
    windows: [],
    aggregatedMetrics: {
      totalWindows: 0,
      completedWindows: 0,
      averageValidationWinRate: 0,
      averageValidationPnl: 0,
      robustnessScore: 0,
      overfittingRisk: "HIGH",
      totalCandidatesEvaluated: 0,
    },
    status: "INSUFFICIENT_DATA",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Backtest Module — BINANCE AI FUTURES AGENT v0.1
 *
 * Barrel export for all backtest engines:
 *   - Historical Data
 *   - Backtest Engine
 *   - Walk-Forward Validation
 *   - Robustness Analysis
 */

export {
  fetchHistoricalCandles,
  validateCandles,
  deduplicateCandles,
  createDataset,
  getCandlesInTimeRange,
  getCandlesForSymbol,
  convertToCandle,
} from "./historical-data";

export type {
  HistoricalCandle,
  DatasetInfo,
  DataQualityCheck,
  Timeframe,
} from "./historical-data";

export {
  runBacktest,
} from "./engine";

export type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
} from "./engine";

export {
  runWalkForward,
} from "./walkforward";

export type {
  WalkForwardWindow,
  WalkForwardResult,
} from "./walkforward";

export {
  analyzeParameterRobustness,
  analyzeRegimeRobustness,
  analyzeSymbolRobustness,
  analyzeCostSensitivity,
  calculateOverallRobustness,
} from "./robustness";

export type {
  ParameterVariation,
  RegimeAnalysis,
  SymbolAnalysis,
  CostSensitivity,
  RobustnessResult,
} from "./robustness";

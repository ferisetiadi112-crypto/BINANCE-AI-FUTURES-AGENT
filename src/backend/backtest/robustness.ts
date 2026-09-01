/**
 * Robustness Analysis — BINANCE AI FUTURES AGENT v0.1
 *
 * Tests strategy robustness across parameters, regimes, symbols, and costs.
 * Identifies fragile strategies that only work under specific conditions.
 */

import type { HistoricalCandle } from "./historical-data";
import type { BacktestConfig, BacktestResult } from "./engine";
import { runBacktest } from "./engine";
import { logger } from "../logger";

// ─── Robustness Types ───────────────────────────────────────────────

export type ParameterVariation = {
  name: string;
  baseValue: number;
  variations: Array<{
    value: number;
    result: BacktestResult;
    isOptimal: boolean;
  }>;
  robust: boolean;
  status: "ROBUST" | "FRAGILE" | "POSSIBLE_OVERFIT";
};

export type RegimeAnalysis = {
  regime: string;
  trades: number;
  winRate: number;
  netPnl: number;
  expectancy: number;
  maxDrawdown: number;
  performance: "STRONG" | "WEAK" | "NEUTRAL";
};

export type SymbolAnalysis = {
  symbol: string;
  trades: number;
  winRate: number;
  netPnl: number;
  expectancy: number;
  performance: "STRONG" | "WEAK" | "NEUTRAL";
};

export type CostSensitivity = {
  scenario: string;
  feeRate: number;
  slippageRate: number;
  netPnl: number;
  winRate: number;
  profitable: boolean;
};

export type RobustnessResult = {
  id: string;
  parameterAnalysis: ParameterVariation[];
  regimeAnalysis: RegimeAnalysis[];
  symbolAnalysis: SymbolAnalysis[];
  costSensitivity: CostSensitivity[];
  overallRobustness: "ROBUST" | "MODERATELY_ROBUST" | "FRAGILE" | "COST_SENSITIVE";
  overfittingRisk: "LOW" | "MEDIUM" | "HIGH";
  createdAt: string;
};

// ─── Robustness Engine ──────────────────────────────────────────────

let robustnessCounter = 0;

export function analyzeParameterRobustness(
  candles: HistoricalCandle[],
  baseConfig: BacktestConfig,
  parameters: Array<{
    name: string;
    baseValue: number;
    variations: number[];
  }>,
): ParameterVariation[] {
  const results: ParameterVariation[] = [];

  for (const param of parameters) {
    const variations: ParameterVariation["variations"] = [];
    let bestPnl = -Infinity;
    let bestIndex = 0;

    for (let i = 0; i < param.variations.length; i++) {
      const value = param.variations[i];
      if (value === undefined) continue;

      // Create config with this parameter variation
      const config = createConfigWithParameter(baseConfig, param.name, value);
      const result = runBacktest(candles, config);

      variations.push({
        value,
        result,
        isOptimal: false,
      });

      if (result.netPnl > bestPnl) {
        bestPnl = result.netPnl;
        bestIndex = i;
      }
    }

    // Mark optimal
    const bestVariation = variations[bestIndex];
    if (bestVariation) {
      bestVariation.isOptimal = true;
    }

    // Check robustness: are neighboring values also profitable?
    const profitableCount = variations.filter(v => v.result.netPnl > 0).length;
    const robust = profitableCount >= variations.length * 0.6;

    let status: ParameterVariation["status"];
    if (robust) {
      status = "ROBUST";
    } else if (profitableCount === 1) {
      status = "POSSIBLE_OVERFIT";
    } else {
      status = "FRAGILE";
    }

    results.push({
      name: param.name,
      baseValue: param.baseValue,
      variations,
      robust,
      status,
    });
  }

  return results;
}

export function analyzeRegimeRobustness(
  candles: HistoricalCandle[],
  config: BacktestConfig,
): RegimeAnalysis[] {
  // Group candles by estimated regime
  const regimeGroups = groupCandlesByRegime(candles);
  const results: RegimeAnalysis[] = [];

  for (const [regime, regimeCandles] of Object.entries(regimeGroups)) {
    if (regimeCandles.length < 10) continue;

    const result = runBacktest(regimeCandles, {
      ...config,
      id: `${config.id}-${regime}`,
      name: `${config.name}-${regime}`,
    });

    if (result.status !== "COMPLETED") continue;

    let performance: RegimeAnalysis["performance"];
    if (result.winRate > 55 && result.netPnl > 0) {
      performance = "STRONG";
    } else if (result.winRate < 45 || result.netPnl < 0) {
      performance = "WEAK";
    } else {
      performance = "NEUTRAL";
    }

    results.push({
      regime,
      trades: result.totalTrades,
      winRate: result.winRate,
      netPnl: result.netPnl,
      expectancy: result.expectancy,
      maxDrawdown: result.maxDrawdown,
      performance,
    });
  }

  return results;
}

export function analyzeSymbolRobustness(
  symbolCandles: Record<string, HistoricalCandle[]>,
  config: BacktestConfig,
): SymbolAnalysis[] {
  const results: SymbolAnalysis[] = [];

  for (const [symbol, candles] of Object.entries(symbolCandles)) {
    if (candles.length < 10) continue;

    const result = runBacktest(candles, {
      ...config,
      id: `${config.id}-${symbol}`,
      name: `${config.name}-${symbol}`,
      symbol,
    });

    if (result.status !== "COMPLETED") continue;

    let performance: SymbolAnalysis["performance"];
    if (result.winRate > 55 && result.netPnl > 0) {
      performance = "STRONG";
    } else if (result.winRate < 45 || result.netPnl < 0) {
      performance = "WEAK";
    } else {
      performance = "NEUTRAL";
    }

    results.push({
      symbol,
      trades: result.totalTrades,
      winRate: result.winRate,
      netPnl: result.netPnl,
      expectancy: result.expectancy,
      performance,
    });
  }

  return results;
}

export function analyzeCostSensitivity(
  candles: HistoricalCandle[],
  config: BacktestConfig,
): CostSensitivity[] {
  const scenarios = [
    { name: "LOW_COST", feeRate: 0.0002, slippageRate: 0.00005 },
    { name: "NORMAL", feeRate: 0.0004, slippageRate: 0.0001 },
    { name: "HIGH_COST", feeRate: 0.0006, slippageRate: 0.0002 },
    { name: "VERY_HIGH_COST", feeRate: 0.001, slippageRate: 0.0005 },
  ];

  const results: CostSensitivity[] = [];

  for (const scenario of scenarios) {
    const result = runBacktest(candles, {
      ...config,
      id: `${config.id}-${scenario.name}`,
      name: `${config.name}-${scenario.name}`,
      feeRate: scenario.feeRate,
      slippageRate: scenario.slippageRate,
    });

    if (result.status !== "COMPLETED") continue;

    results.push({
      scenario: scenario.name,
      feeRate: scenario.feeRate,
      slippageRate: scenario.slippageRate,
      netPnl: result.netPnl,
      winRate: result.winRate,
      profitable: result.netPnl > 0,
    });
  }

  // Check cost sensitivity
  const profitableScenarios = results.filter(r => r.profitable).length;
  const costSensitive = profitableScenarios < results.length * 0.5;

  return results;
}

export function calculateOverallRobustness(
  parameterAnalysis: ParameterVariation[],
  regimeAnalysis: RegimeAnalysis[],
  costSensitivity: CostSensitivity[],
): RobustnessResult["overallRobustness"] {
  const robustParams = parameterAnalysis.filter(p => p.robust).length;
  const strongRegimes = regimeAnalysis.filter(r => r.performance === "STRONG").length;
  const profitableCosts = costSensitivity.filter(c => c.profitable).length;

  const paramScore = parameterAnalysis.length > 0 ? robustParams / parameterAnalysis.length : 0;
  const regimeScore = regimeAnalysis.length > 0 ? strongRegimes / regimeAnalysis.length : 0;
  const costScore = costSensitivity.length > 0 ? profitableCosts / costSensitivity.length : 0;

  const overallScore = (paramScore + regimeScore + costScore) / 3;

  if (overallScore > 0.7) return "ROBUST";
  if (overallScore > 0.5) return "MODERATELY_ROBUST";
  if (costScore < 0.5) return "COST_SENSITIVE";
  return "FRAGILE";
}

// ─── Helpers ────────────────────────────────────────────────────────

function createConfigWithParameter(
  baseConfig: BacktestConfig,
  paramName: string,
  value: number,
): BacktestConfig {
  const strategyParams = { ...(baseConfig.strategyParams || {}) };
  strategyParams[paramName] = value;

  return {
    ...baseConfig,
    id: `${baseConfig.id}-${paramName}-${value}`,
    name: `${baseConfig.name}-${paramName}-${value}`,
    strategyParams,
  };
}

function groupCandlesByRegime(candles: HistoricalCandle[]): Record<string, HistoricalCandle[]> {
  // Simplified regime estimation based on price movement
  const groups: Record<string, HistoricalCandle[]> = {};

  for (let i = 50; i < candles.length; i++) {
    const lookback = candles.slice(i - 50, i);
    const current = candles[i];
    if (!current) continue;

    // Simple regime estimation
    const sma20 = lookback.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
    const sma50 = lookback.reduce((sum, c) => sum + c.close, 0) / 50;

    let regime: string;
    if (current.close > sma20 && sma20 > sma50) {
      regime = "TRENDING_UP";
    } else if (current.close < sma20 && sma20 < sma50) {
      regime = "TRENDING_DOWN";
    } else {
      regime = "RANGING";
    }

    if (!groups[regime]) groups[regime] = [];
    const regimeGroup = groups[regime];
    if (regimeGroup) {
      regimeGroup.push(current);
    }
  }

  return groups;
}

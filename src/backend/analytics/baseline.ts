/**
 * Baseline Performance Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Calculates immutable baseline metrics for strategy evaluation.
 * Baseline serves as the fixed comparison point for experiments.
 *
 * Key Principle:
 *   Baseline is IMMUTABLE for one experiment cycle.
 *   New experiments create new baselines.
 */

import type { TradeExperience, TradeOutcome } from "../ai/experience-engine";
import { getRecentExperiences } from "../ai/experience-engine";
import { logger } from "../logger";

// ─── Baseline Types ─────────────────────────────────────────────────

export type BaselineMetrics = {
  // Core metrics
  totalDecisions: number;
  totalTrades: number;
  totalNoTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  cancelled: number;
  
  // Rates
  winRate: number;
  lossRate: number;
  breakevenRate: number;
  noTradeFrequency: number;
  
  // PnL
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  
  // Averages
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  averageTradeDuration: number;
  
  // Costs
  totalFees: number;
  totalSlippage: number;
  
  // Direction breakdown
  longTrades: number;
  longWinRate: number;
  longPnl: number;
  shortTrades: number;
  shortWinRate: number;
  shortPnl: number;
  
  // Risk
  maxDrawdown: number;
  
  // Sample size
  sampleSize: number;
  minimumSampleSize: number;
  statisticalStatus: "INSUFFICIENT_SAMPLE" | "PRELIMINARY" | "VALIDATED";
  
  // Metadata
  baselineId: string;
  createdAt: string;
  experienceRange: {
    earliest: number;
    latest: number;
  };
};

export type BaselineBreakdown = {
  byStrategy: Record<string, BaselineMetrics>;
  byRegime: Record<string, BaselineMetrics>;
  bySymbol: Record<string, BaselineMetrics>;
  byConfidenceBucket: Record<string, BaselineMetrics>;
};

// ─── Configuration ──────────────────────────────────────────────────

const MINIMUM_SAMPLE_SIZE = 30; // Minimum experiences for statistical validity
const PRELIMINARY_SAMPLE_SIZE = 10; // Minimum for preliminary analysis

// ─── Baseline Engine ────────────────────────────────────────────────

export function calculateBaseline(experiences: TradeExperience[]): BaselineMetrics {
  if (experiences.length === 0) {
    return createEmptyBaseline();
  }

  // Core counts
  const totalDecisions = experiences.length;
  const trades = experiences.filter(e => e.direction !== "NO_TRADE");
  const noTrades = experiences.filter(e => e.direction === "NO_TRADE");
  const wins = trades.filter(e => e.outcome === "WIN");
  const losses = trades.filter(e => e.outcome === "LOSS");
  const breakevens = trades.filter(e => e.outcome === "BREAKEVEN");
  const cancelled = experiences.filter(e => e.outcome === "CANCELLED");

  // Rates
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const lossRate = totalTrades > 0 ? (losses.length / totalTrades) * 100 : 0;
  const breakevenRate = totalTrades > 0 ? (breakevens.length / totalTrades) * 100 : 0;
  const noTradeFrequency = totalDecisions > 0 ? (noTrades.length / totalDecisions) * 100 : 0;

  // PnL
  const grossProfit = wins.reduce((sum, e) => sum + (e.netPnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, e) => sum + (e.netPnl || 0), 0));
  const netPnl = trades.reduce((sum, e) => sum + (e.netPnl || 0), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Averages
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const expectancy = totalTrades > 0 ? netPnl / totalTrades : 0;

  // Duration
  const tradesWithDuration = trades.filter(e => e.duration && e.duration > 0);
  const averageTradeDuration = tradesWithDuration.length > 0
    ? tradesWithDuration.reduce((sum, e) => sum + (e.duration || 0), 0) / tradesWithDuration.length
    : 0;

  // Costs
  const totalFees = trades.reduce((sum, e) => sum + (e.fees || 0), 0);
  const totalSlippage = trades.reduce((sum, e) => sum + (e.slippage || 0), 0);

  // Direction breakdown
  const longTrades = trades.filter(e => e.direction === "LONG");
  const shortTrades = trades.filter(e => e.direction === "SHORT");
  const longWins = longTrades.filter(e => e.outcome === "WIN");
  const shortWins = shortTrades.filter(e => e.outcome === "WIN");
  const longWinRate = longTrades.length > 0 ? (longWins.length / longTrades.length) * 100 : 0;
  const shortWinRate = shortTrades.length > 0 ? (shortWins.length / shortTrades.length) * 100 : 0;
  const longPnl = longTrades.reduce((sum, e) => sum + (e.netPnl || 0), 0);
  const shortPnl = shortTrades.reduce((sum, e) => sum + (e.netPnl || 0), 0);

  // Max drawdown
  const maxDrawdown = calculateMaxDrawdown(trades);

  // Statistical status
  const sampleSize = totalTrades;
  let statisticalStatus: BaselineMetrics["statisticalStatus"];
  if (sampleSize >= MINIMUM_SAMPLE_SIZE) {
    statisticalStatus = "VALIDATED";
  } else if (sampleSize >= PRELIMINARY_SAMPLE_SIZE) {
    statisticalStatus = "PRELIMINARY";
  } else {
    statisticalStatus = "INSUFFICIENT_SAMPLE";
  }

  // Experience range
  const timestamps = experiences.map(e => e.timestamp);
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);

  return {
    totalDecisions,
    totalTrades,
    totalNoTrades: noTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    cancelled: cancelled.length,
    winRate,
    lossRate,
    breakevenRate,
    noTradeFrequency,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor,
    averageWin,
    averageLoss,
    expectancy,
    averageTradeDuration,
    totalFees,
    totalSlippage,
    longTrades: longTrades.length,
    longWinRate,
    longPnl,
    shortTrades: shortTrades.length,
    shortWinRate,
    shortPnl,
    maxDrawdown,
    sampleSize,
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    statisticalStatus,
    baselineId: `BASELINE-${Date.now()}`,
    createdAt: new Date().toISOString(),
    experienceRange: { earliest, latest },
  };
}

export function calculateBaselineBreakdown(experiences: TradeExperience[]): BaselineBreakdown {
  // By strategy
  const byStrategy: Record<string, TradeExperience[]> = {};
  for (const exp of experiences) {
    const strategy = exp.strategy;
    if (!byStrategy[strategy]) byStrategy[strategy] = [];
    byStrategy[strategy].push(exp);
  }

  // By regime
  const byRegime: Record<string, TradeExperience[]> = {};
  for (const exp of experiences) {
    const regime = exp.marketRegime;
    if (!byRegime[regime]) byRegime[regime] = [];
    byRegime[regime].push(exp);
  }

  // By symbol
  const bySymbol: Record<string, TradeExperience[]> = {};
  for (const exp of experiences) {
    const symbol = exp.symbol;
    if (!bySymbol[symbol]) bySymbol[symbol] = [];
    bySymbol[symbol].push(exp);
  }

  // By confidence bucket
  const byConfidenceBucket: Record<string, TradeExperience[]> = {};
  for (const exp of experiences) {
    const bucket = getConfidenceBucket(exp.confidence);
    if (!byConfidenceBucket[bucket]) byConfidenceBucket[bucket] = [];
    byConfidenceBucket[bucket].push(exp);
  }

  return {
    byStrategy: Object.fromEntries(
      Object.entries(byStrategy).map(([key, exps]) => [key, calculateBaseline(exps)])
    ),
    byRegime: Object.fromEntries(
      Object.entries(byRegime).map(([key, exps]) => [key, calculateBaseline(exps)])
    ),
    bySymbol: Object.fromEntries(
      Object.entries(bySymbol).map(([key, exps]) => [key, calculateBaseline(exps)])
    ),
    byConfidenceBucket: Object.fromEntries(
      Object.entries(byConfidenceBucket).map(([key, exps]) => [key, calculateBaseline(exps)])
    ),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function getConfidenceBucket(confidence: number): string {
  if (confidence < 0.5) return "0.00-0.49";
  if (confidence < 0.6) return "0.50-0.59";
  if (confidence < 0.7) return "0.60-0.69";
  if (confidence < 0.8) return "0.70-0.79";
  if (confidence < 0.9) return "0.80-0.89";
  return "0.90-1.00";
}

function calculateMaxDrawdown(trades: TradeExperience[]): number {
  let peak = 0;
  let maxDd = 0;
  let equity = 0;

  for (const trade of trades) {
    equity += trade.netPnl || 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  return maxDd;
}

function createEmptyBaseline(): BaselineMetrics {
  return {
    totalDecisions: 0,
    totalTrades: 0,
    totalNoTrades: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    cancelled: 0,
    winRate: 0,
    lossRate: 0,
    breakevenRate: 0,
    noTradeFrequency: 0,
    netPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 0,
    averageWin: 0,
    averageLoss: 0,
    expectancy: 0,
    averageTradeDuration: 0,
    totalFees: 0,
    totalSlippage: 0,
    longTrades: 0,
    longWinRate: 0,
    longPnl: 0,
    shortTrades: 0,
    shortWinRate: 0,
    shortPnl: 0,
    maxDrawdown: 0,
    sampleSize: 0,
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    statisticalStatus: "INSUFFICIENT_SAMPLE",
    baselineId: `BASELINE-${Date.now()}`,
    createdAt: new Date().toISOString(),
    experienceRange: { earliest: 0, latest: 0 },
  };
}

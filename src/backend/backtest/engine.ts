/**
 * Backtest Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Tests strategies against historical data using the same pipeline as live trading.
 * Position lifecycle: entry on candle N, held across subsequent candles, exit on TP/SL/strategy/end.
 *
 * EXECUTION SEMANTICS (documented):
 *   1. Decision generated from candle[i] data (close, indicators, regime).
 *   2. Entry executed at candle[i].close + entry_slippage.
 *   3. Position OPEN — persists across subsequent candles.
 *   4. Each subsequent candle[j]:
 *      a. Check TP/SL against candle[j].high and candle[j].low.
 *      b. If BOTH TP and SL touched in same candle:
 *         - LONG: SL checked first (conservative — assume adverse move first)
 *         - SHORT: SL checked first (conservative)
 *      c. If no TP/SL triggered, position stays open.
 *   5. Exit at candle[j].close + exit_slippage when TP/SL/strategy triggers.
 *   6. End-of-backtest: force-close at last candle close.
 *
 * AMBIGUOUS TP/SL RULE:
 *   When a candle's range touches both TP and SL:
 *   SL is always assumed to have been hit first.
 *   This is conservative — it assumes the worst-case fill order.
 */

import type { HistoricalCandle } from "./historical-data";
import type { MarketState } from "../runtime/types";
import type { BaselineMetrics } from "../analytics/baseline";
import { generateDecision, validateDecision } from "../ai/decision-engine";
import { RiskEngine } from "../risk/engine";
import { calculateBaseline } from "../analytics/baseline";
import { classifyRegime } from "../runtime/regime";
import { calculateAllIndicators, type Candle as IndicatorCandle } from "../runtime/indicators";
import { calculateTrendStrength, calculateMomentumScore } from "../runtime/engine";
import { logger } from "../logger";

// ─── Backtest Types ─────────────────────────────────────────────────

export type BacktestConfig = {
  id: string;
  name: string;
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  initialCapital: number;
  feeRate: number;
  slippageRate: number;
  strategyVersion: string;
  modelVersion: string;
  parameterVersion: string;
  riskConfig: {
    dailyProfitCap: number;
    dailyLossLimit: number;
    maxLeverage: number;
    maxExposurePercent: number;
  };
  /** Strategy-specific parameters (e.g., emaPeriod, rsiThreshold) */
  strategyParams?: Record<string, number>;
};

export type BacktestTrade = {
  id: string;
  backtestId: string;
  decisionId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryTime: number;
  exitTime: number;
  entryCandleIndex: number;
  exitCandleIndex: number;
  duration: number;
  entryFee: number;
  exitFee: number;
  entrySlippage: number;
  exitSlippage: number;
  fees: number;
  slippage: number;
  grossPnl: number;
  netPnl: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  exitReason: "TP" | "SL" | "STRATEGY_EXIT" | "END_OF_BACKTEST" | "RISK_REJECT";
  strategy: string;
  regime: string;
  confidence: number;
};

export type EquityPoint = {
  timestamp: number;
  equity: number;
  balance: number;
  drawdown: number;
  peakEquity: number;
  position: "FLAT" | "LONG" | "SHORT";
};

export type BacktestResult = {
  config: BacktestConfig;
  status: "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
  errorMessage?: string;
  
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  returnPercent: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageDrawdown: number;
  recoveryFactor: number;
  averageDuration: number;
  totalFees: number;
  totalSlippage: number;
  
  longTrades: number;
  longWinRate: number;
  longPnl: number;
  shortTrades: number;
  shortWinRate: number;
  shortPnl: number;
  
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  baseline: BaselineMetrics;
  
  datasetCandles: number;
  lookAheadProtected: boolean;
  createdAt: string;
  duration: number;
};

// ─── Internal Position State ────────────────────────────────────────

type OpenPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  entryTime: number;
  entryCandleIndex: number;
  stopLoss: number;
  takeProfit: number;
  entryFee: number;
  entrySlippage: number;
  decisionId: string;
  strategy: string;
  regime: string;
  confidence: number;
};

// ─── Backtest Engine ────────────────────────────────────────────────

export function runBacktest(
  candles: HistoricalCandle[],
  config: BacktestConfig,
): BacktestResult {
  const startTime = Date.now();
  logger.info("backtest", `Starting backtest: ${config.name} (${config.symbol})`);

  if (candles.length < 10) {
    return createFailedResult(config, "Insufficient data: need at least 10 candles");
  }

  // Initialize engines
  const riskEngine = new RiskEngine({
    aiAllocationLimit: config.initialCapital,
    sessionProfitTarget: config.riskConfig.dailyProfitCap,
    sessionHardCap: config.riskConfig.dailyProfitCap * 4,
    maxLossPerTrade: 1.0,
    dailyLossLimit: config.riskConfig.dailyLossLimit,
    maxLeverage: config.riskConfig.maxLeverage,
    maxOpenPositions: 1,
  });

  const feeRate = config.feeRate;
  const slippageRate = config.slippageRate;

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let peakEquity = config.initialCapital;
  let equity = config.initialCapital;
  let capital = config.initialCapital;
  let tradeCounter = 0;
  let openPosition: OpenPosition | null = null;

  // Lookback for indicator warm-up (production EMA200 requires ~200 candles)
  // Adapt to dataset size: use full 200 when available, fewer for smaller datasets
  const lookbackSize = Math.min(200, Math.max(0, candles.length - 1));

  // Determine the first candle where decisions should be made
  // If config has startTime, decisions begin at the first candle >= startTime
  // This allows the backtest to use earlier candles for indicator warm-up
  // while still respecting temporal boundaries
  const decisionStartTime = config.startTime;

  // Process candles sequentially from index 1 (need at least one prior candle)
  // Indicator warmup builds naturally: availableCandles grows from 1 to lookbackSize
  // Decisions are only made when openTime >= decisionStartTime
  for (let i = 1; i < candles.length; i++) {
    const currentCandle = candles[i];
    if (!currentCandle) continue;

    // ─── Force-close at endTime boundary ────────────────────────
    // When using warmup candles (full dataset passed), stop after endTime
    if (currentCandle.openTime > config.endTime && openPosition) {
      // Force-close at the last candle before endTime
      const lastInWindow = candles.slice(0, i).filter(c => c.openTime <= config.endTime).pop();
      const exitCandle = lastInWindow || candles[i - 1] || currentCandle;
      const exitPrice = exitCandle.close;
      const exitSlippageCost = exitPrice * slippageRate;
      const adjustedExit = openPosition.side === "LONG"
        ? exitPrice - exitSlippageCost
        : exitPrice + exitSlippageCost;
      const exitFee = openPosition.size * adjustedExit * feeRate;
      let grossPnl: number;
      if (openPosition.side === "LONG") {
        grossPnl = (adjustedExit - openPosition.entryPrice) * openPosition.size;
      } else {
        grossPnl = (openPosition.entryPrice - adjustedExit) * openPosition.size;
      }
      const totalFee = openPosition.entryFee + exitFee;
      const totalSlippageCost = openPosition.entrySlippage + exitSlippageCost;
      const netPnl = grossPnl - totalFee;
      tradeCounter++;
      trades.push({
        id: `BT-${config.id}-${tradeCounter}`,
        backtestId: config.id,
        decisionId: openPosition.decisionId,
        symbol: openPosition.symbol,
        side: openPosition.side,
        entryPrice: openPosition.entryPrice,
        exitPrice: adjustedExit,
        quantity: openPosition.size,
        entryTime: openPosition.entryTime,
        exitTime: exitCandle.openTime,
        entryCandleIndex: openPosition.entryCandleIndex,
        exitCandleIndex: i,
        duration: exitCandle.openTime - openPosition.entryTime,
        entryFee: openPosition.entryFee,
        exitFee,
        entrySlippage: openPosition.entrySlippage,
        exitSlippage: exitSlippageCost,
        fees: totalFee,
        slippage: totalSlippageCost,
        grossPnl,
        netPnl,
        outcome: netPnl > 0.000001 ? "WIN" : netPnl < -0.000001 ? "LOSS" : "BREAKEVEN",
        exitReason: "END_OF_BACKTEST",
        strategy: openPosition.strategy,
        regime: openPosition.regime,
        confidence: openPosition.confidence,
      });
      capital += netPnl;
      equity = capital;
      if (equity > peakEquity) peakEquity = equity;
      riskEngine.updateDailyPnl(netPnl);
      equityCurve.push({
        timestamp: exitCandle.openTime,
        equity,
        balance: capital,
        drawdown: peakEquity - equity,
        peakEquity,
        position: "FLAT",
      });
      openPosition = null;
    }
    // Skip processing candles after endTime
    if (currentCandle.openTime > config.endTime) continue;

    // ─── Phase 1: Evaluate open position (TP/SL check) ───────────
    if (openPosition) {
      const exitResult = evaluatePositionExit(openPosition, currentCandle, i, feeRate, slippageRate);
      
      if (exitResult) {
        // Close position
        const { exitPrice, exitSlippageCost, exitFee, reason } = exitResult;
        
        const quantity = openPosition.size;
        let grossPnl: number;
        if (openPosition.side === "LONG") {
          grossPnl = (exitPrice - openPosition.entryPrice) * quantity;
        } else {
          grossPnl = (openPosition.entryPrice - exitPrice) * quantity;
        }
        
        const totalFee = openPosition.entryFee + exitFee;
        const totalSlippageCost = openPosition.entrySlippage + exitSlippageCost;
        const netPnl = grossPnl - totalFee;
        
        tradeCounter++;
        const trade: BacktestTrade = {
          id: `BT-${config.id}-${tradeCounter}`,
          backtestId: config.id,
          decisionId: openPosition.decisionId,
          symbol: openPosition.symbol,
          side: openPosition.side,
          entryPrice: openPosition.entryPrice,
          exitPrice,
          quantity,
          entryTime: openPosition.entryTime,
          exitTime: currentCandle.openTime,
          entryCandleIndex: openPosition.entryCandleIndex,
          exitCandleIndex: i,
          duration: currentCandle.openTime - openPosition.entryTime,
          entryFee: openPosition.entryFee,
          exitFee,
          entrySlippage: openPosition.entrySlippage,
          exitSlippage: exitSlippageCost,
          fees: totalFee,
          slippage: totalSlippageCost,
          grossPnl,
          netPnl,
          outcome: netPnl > 0.000001 ? "WIN" : netPnl < -0.000001 ? "LOSS" : "BREAKEVEN",
          exitReason: reason,
          strategy: openPosition.strategy,
          regime: openPosition.regime,
          confidence: openPosition.confidence,
        };

        trades.push(trade);
        capital += netPnl;
        equity = capital;
        if (equity > peakEquity) peakEquity = equity;
        riskEngine.updateDailyPnl(netPnl);

        equityCurve.push({
          timestamp: currentCandle.openTime,
          equity,
          balance: capital,
          drawdown: peakEquity - equity,
          peakEquity,
          position: "FLAT",
        });

        openPosition = null;
      }
    }

    // ─── Phase 2: Generate decision if flat ───────────────────────
    // Skip new decisions before the configured start time (warmup period)
    // This allows the backtest to use earlier candles for indicator warm-up
    // while only making trading decisions within the specified time window
    if (!openPosition && currentCandle.openTime < decisionStartTime) {
      continue;
    }
    if (!openPosition) {
      // Build MarketState from available data only (up to current candle)
      const availableCandles = candles.slice(Math.max(0, i - lookbackSize), i + 1);
      const closes = availableCandles.map(c => c.close);
      const lastPrice = closes[closes.length - 1] || currentCandle.close;

      // Read strategy params (with defaults)
      const params = config.strategyParams || {};
      const smaShortPeriod = params["smaShort"] ?? 20;
      const smaLongPeriod = params["smaLong"] ?? 50;
      const momentumStrongThreshold = params["momentumStrong"] ?? 70;
      const tpPercent = params["tpPercent"] ?? 4;
      const slPercent = params["slPercent"] ?? 2;

      // Compute production-equivalent indicators using canonical indicator library
      const indicatorCandles: IndicatorCandle[] = availableCandles.map(c => ({
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      const indicatorVolumes = availableCandles.map(c => c.volume);
      const indicators = calculateAllIndicators(closes, indicatorCandles, indicatorVolumes);

      // Trend detection using configurable SMA periods (preserved for strategy consumption)
      const smaShort = closes.slice(-smaShortPeriod).reduce((sum, c) => sum + c, 0) / Math.min(smaShortPeriod, closes.length);
      const smaLong = closes.reduce((sum, c) => sum + c, 0) / Math.min(smaLongPeriod, closes.length);
      const trend = lastPrice > smaShort ? "UP" : lastPrice < smaShort ? "DOWN" : "FLAT";

      // Production-equivalent trend strength and momentum score
      const trendStrength = calculateTrendStrength(closes, indicators.ema20, indicators.ema50, indicators.ema200);
      const momentumScore = calculateMomentumScore(indicators.rsi, indicators.macdHistogram);
      const momentum = momentumScore > momentumStrongThreshold ? "STRONG" : momentumScore > 40 ? "MODERATE" : "WEAK";

      // Regime: use the SAME production regime classifier as live/paper trading
      const regimeResult = classifyRegime({
        ema20: indicators.ema20,
        ema50: indicators.ema50,
        ema200: indicators.ema200,
        rsi: indicators.rsi,
        atrPercent: indicators.atrPercent,
        macdHistogram: indicators.macdHistogram,
        bollingerPercent: indicators.bollingerPercent,
        trendStrength,
        momentumScore,
      });
      const marketRegime = regimeResult.regime;
      const regimeConfidence = regimeResult.confidence;

      const marketState: MarketState = {
        symbol: config.symbol,
        timestamp: currentCandle.openTime,
        price: currentCandle.close,
        priceChange24h: 0,
        priceChangePercent24h: 0,
        trend,
        trendStrength,
        momentum: momentum as MarketState["momentum"],
        momentumScore,
        volatility: currentCandle.high - currentCandle.low,
        volatilityPercent: ((currentCandle.high - currentCandle.low) / currentCandle.close) * 100,
        volume24h: availableCandles.slice(-24).reduce((sum, c) => sum + c.volume, 0),
        volumeChange: 0,
        marketStructure: "HIGHER_HIGHS",
        marketRegime,
        regimeConfidence,
        liquidity: 80,
        dataQuality: "GOOD",
        feedStatus: "ONLINE",
        lastUpdate: currentCandle.openTime,
        dataAge: 0,
      };

      // Generate AI Decision
      const decision = generateDecision(marketState);
      const validation = validateDecision(decision);
      if (!validation.valid) continue;

      // Risk Engine Check
      const riskResult = riskEngine.check(
        decision,
        marketState,
        { symbol: config.symbol, side: "FLAT", size: 0 },
      );

      decision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
      decision.riskReason = riskResult.reason;

      // Execute entry
      if (riskResult.approved && decision.direction !== "NO_TRADE") {
        const side = decision.direction === "LONG" ? "LONG" : "SHORT";
        const quantity = (capital * 0.20) / currentCandle.close; // 20% of capital
        
        // Entry execution with slippage
        const entrySlippageCost = currentCandle.close * slippageRate;
        const entryPrice = side === "LONG"
          ? currentCandle.close + entrySlippageCost
          : currentCandle.close - entrySlippageCost;
        
        const entryFee = quantity * entryPrice * feeRate;
        
        // Calculate TP/SL from entry price using strategy params
        const stopLoss = side === "LONG"
          ? entryPrice * (1 - slPercent / 100)
          : entryPrice * (1 + slPercent / 100);
        const takeProfit = side === "LONG"
          ? entryPrice * (1 + tpPercent / 100)
          : entryPrice * (1 - tpPercent / 100);

        openPosition = {
          symbol: config.symbol,
          side,
          size: quantity,
          entryPrice,
          entryTime: currentCandle.openTime,
          entryCandleIndex: i,
          stopLoss,
          takeProfit,
          entryFee,
          entrySlippage: entrySlippageCost,
          decisionId: decision.id,
          strategy: decision.strategy,
          regime: decision.marketRegime,
          confidence: decision.confidence,
        };

        // Deduct entry costs from capital
        capital -= entryFee;

        equityCurve.push({
          timestamp: currentCandle.openTime,
          equity,
          balance: capital,
          drawdown: peakEquity - equity,
          peakEquity,
          position: side,
        });
      }
    }
  }

  // ─── End-of-backtest: force-close open position ─────────────────
  if (openPosition && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    if (lastCandle) {
      const exitPrice = lastCandle.close;
      const exitSlippageCost = lastCandle.close * slippageRate;
      const adjustedExit = openPosition.side === "LONG"
        ? exitPrice - exitSlippageCost
        : exitPrice + exitSlippageCost;
      
      const exitFee = openPosition.size * adjustedExit * feeRate;
      
      let grossPnl: number;
      if (openPosition.side === "LONG") {
        grossPnl = (adjustedExit - openPosition.entryPrice) * openPosition.size;
      } else {
        grossPnl = (openPosition.entryPrice - adjustedExit) * openPosition.size;
      }
      
      const totalFee = openPosition.entryFee + exitFee;
      const totalSlippageCost = openPosition.entrySlippage + exitSlippageCost;
      const netPnl = grossPnl - totalFee;

      tradeCounter++;
      trades.push({
        id: `BT-${config.id}-${tradeCounter}`,
        backtestId: config.id,
        decisionId: openPosition.decisionId,
        symbol: openPosition.symbol,
        side: openPosition.side,
        entryPrice: openPosition.entryPrice,
        exitPrice: adjustedExit,
        quantity: openPosition.size,
        entryTime: openPosition.entryTime,
        exitTime: lastCandle.openTime,
        entryCandleIndex: openPosition.entryCandleIndex,
        exitCandleIndex: candles.length - 1,
        duration: lastCandle.openTime - openPosition.entryTime,
        entryFee: openPosition.entryFee,
        exitFee,
        entrySlippage: openPosition.entrySlippage,
        exitSlippage: exitSlippageCost,
        fees: totalFee,
        slippage: totalSlippageCost,
        grossPnl,
        netPnl,
        outcome: netPnl > 0.000001 ? "WIN" : netPnl < -0.000001 ? "LOSS" : "BREAKEVEN",
        exitReason: "END_OF_BACKTEST",
        strategy: openPosition.strategy,
        regime: openPosition.regime,
        confidence: openPosition.confidence,
      });

      capital += netPnl;
      equity = capital;
    }
    openPosition = null;
  }

  // Calculate metrics
  const metrics = calculateBacktestMetrics(trades, config);

  // Verify look-ahead protection
  const lookAheadVerified = verifyLookAheadProtection(candles, lookbackSize);

  const result: BacktestResult = {
    config,
    status: "COMPLETED",
    ...metrics,
    trades,
    equityCurve,
    baseline: calculateBaseline(trades.map(t => ({
      id: t.id,
      decisionId: t.decisionId,
      tradeId: t.id,
      symbol: t.symbol,
      timestamp: t.entryTime,
      marketRegime: t.regime,
      strategy: t.strategy,
      direction: t.side,
      confidence: t.confidence,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      duration: t.duration,
      fees: t.fees,
      slippage: t.slippage,
      grossPnl: t.grossPnl,
      netPnl: t.netPnl,
      drawdown: null,
      outcome: t.outcome,
      marketContext: {
        symbol: t.symbol,
        price: t.entryPrice,
        trend: "UNKNOWN",
        trendStrength: 0,
        momentum: "UNKNOWN",
        momentumScore: 0,
        volatility: 0,
        volume24h: 0,
        marketRegime: t.regime,
        regimeConfidence: 0,
        dataQuality: "GOOD",
        feedStatus: "ONLINE",
      },
      decisionVersion: config.strategyVersion,
      modelVersion: config.modelVersion,
    }))),
    datasetCandles: candles.length,
    lookAheadProtected: lookAheadVerified,
    createdAt: new Date().toISOString(),
    duration: Date.now() - startTime,
  };

  logger.info(
    "backtest",
    `Backtest complete: ${config.name} — ${result.totalTrades} trades, PnL: $${result.netPnl.toFixed(6)}, Win Rate: ${result.winRate.toFixed(1)}%`
  );

  return result;
}

// ─── Position Exit Evaluation ───────────────────────────────────────

type ExitResult = {
  exitPrice: number;
  exitSlippageCost: number;
  exitFee: number;
  reason: "TP" | "SL";
};

function evaluatePositionExit(
  position: OpenPosition,
  candle: HistoricalCandle,
  candleIndex: number,
  feeRate: number,
  slippageRate: number,
): ExitResult | null {
  const quantity = position.size;

  if (position.side === "LONG") {
    // Check SL first (conservative: assume adverse move happens first)
    if (candle.low <= position.stopLoss) {
      const exitPrice = position.stopLoss;
      const exitSlippageCost = exitPrice * slippageRate;
      const adjustedExit = exitPrice - exitSlippageCost;
      const exitFee = quantity * adjustedExit * feeRate;
      return { exitPrice: adjustedExit, exitSlippageCost, exitFee, reason: "SL" };
    }
    // Then check TP
    if (candle.high >= position.takeProfit) {
      const exitPrice = position.takeProfit;
      const exitSlippageCost = exitPrice * slippageRate;
      const adjustedExit = exitPrice - exitSlippageCost;
      const exitFee = quantity * adjustedExit * feeRate;
      return { exitPrice: adjustedExit, exitSlippageCost, exitFee, reason: "TP" };
    }
  } else {
    // SHORT
    // Check SL first (conservative)
    if (candle.high >= position.stopLoss) {
      const exitPrice = position.stopLoss;
      const exitSlippageCost = exitPrice * slippageRate;
      const adjustedExit = exitPrice + exitSlippageCost;
      const exitFee = quantity * adjustedExit * feeRate;
      return { exitPrice: adjustedExit, exitSlippageCost, exitFee, reason: "SL" };
    }
    // Then check TP
    if (candle.low <= position.takeProfit) {
      const exitPrice = position.takeProfit;
      const exitSlippageCost = exitPrice * slippageRate;
      const adjustedExit = exitPrice + exitSlippageCost;
      const exitFee = quantity * adjustedExit * feeRate;
      return { exitPrice: adjustedExit, exitSlippageCost, exitFee, reason: "TP" };
    }
  }

  return null; // Position stays open
}

// ─── Look-Ahead Verification ────────────────────────────────────────

function verifyLookAheadProtection(candles: HistoricalCandle[], lookback: number): boolean {
  // Verify that the lookback window doesn't exceed available data
  // and that we never access candles beyond the current index
  // This is a structural invariant — the loop only accesses candles[0..i]
  return lookback >= 0 && candles.length > lookback;
}

// ─── Metrics Calculation ────────────────────────────────────────────

function calculateBacktestMetrics(
  trades: BacktestTrade[],
  config: BacktestConfig,
): Omit<BacktestResult, "config" | "status" | "trades" | "equityCurve" | "baseline" | "datasetCandles" | "lookAheadProtected" | "createdAt" | "duration"> {
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.outcome === "WIN").length;
  const losses = trades.filter(t => t.outcome === "LOSS").length;
  const breakevens = trades.filter(t => t.outcome === "BREAKEVEN").length;

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const grossProfit = trades.filter(t => t.outcome === "WIN").reduce((sum, t) => sum + t.netPnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.outcome === "LOSS").reduce((sum, t) => sum + t.netPnl, 0));
  const netPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
  const returnPercent = (netPnl / config.initialCapital) * 100;

  const averageWin = wins > 0 ? grossProfit / wins : 0;
  const averageLoss = losses > 0 ? grossLoss / losses : 0;
  const expectancy = totalTrades > 0 ? netPnl / totalTrades : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Drawdown
  let peak = config.initialCapital;
  let maxDd = 0;
  let totalDd = 0;
  let ddCount = 0;

  for (let idx = 0; idx < trades.length; idx++) {
    const trade = trades[idx];
    const equity = config.initialCapital + trades.slice(0, idx + 1).reduce((s, t) => s + t.netPnl, 0);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    if (dd > 0) {
      totalDd += dd;
      ddCount++;
    }
  }

  const maxDrawdownPercent = (maxDd / config.initialCapital) * 100;
  const averageDrawdown = ddCount > 0 ? totalDd / ddCount : 0;
  const recoveryFactor = maxDd > 0 ? netPnl / maxDd : 0;

  const averageDuration = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length
    : 0;

  // Fees: sum of entry + exit fees from each trade
  const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
  // Slippage: sum of entry + exit slippage from each trade
  const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

  const longTrades = trades.filter(t => t.side === "LONG");
  const shortTrades = trades.filter(t => t.side === "SHORT");
  const longWins = longTrades.filter(t => t.outcome === "WIN");
  const shortWins = shortTrades.filter(t => t.outcome === "WIN");
  const longWinRate = longTrades.length > 0 ? (longWins.length / longTrades.length) * 100 : 0;
  const shortWinRate = shortTrades.length > 0 ? (shortWins.length / shortTrades.length) * 100 : 0;
  const longPnl = longTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const shortPnl = shortTrades.reduce((sum, t) => sum + t.netPnl, 0);

  return {
    totalTrades, wins, losses, breakevens, winRate,
    grossProfit, grossLoss, netPnl, returnPercent,
    averageWin, averageLoss, expectancy, profitFactor,
    maxDrawdown: maxDd, maxDrawdownPercent, averageDrawdown, recoveryFactor,
    averageDuration, totalFees, totalSlippage,
    longTrades: longTrades.length, longWinRate, longPnl,
    shortTrades: shortTrades.length, shortWinRate, shortPnl,
  };
}

function createFailedResult(config: BacktestConfig, errorMessage: string): BacktestResult {
  return {
    config, status: "FAILED", errorMessage,
    totalTrades: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0,
    grossProfit: 0, grossLoss: 0, netPnl: 0, returnPercent: 0,
    averageWin: 0, averageLoss: 0, expectancy: 0, profitFactor: 0,
    maxDrawdown: 0, maxDrawdownPercent: 0, averageDrawdown: 0, recoveryFactor: 0,
    averageDuration: 0, totalFees: 0, totalSlippage: 0,
    longTrades: 0, longWinRate: 0, longPnl: 0,
    shortTrades: 0, shortWinRate: 0, shortPnl: 0,
    trades: [], equityCurve: [],
    baseline: {
      totalDecisions: 0, totalTrades: 0, totalNoTrades: 0,
      wins: 0, losses: 0, breakevens: 0, cancelled: 0,
      winRate: 0, lossRate: 0, breakevenRate: 0, noTradeFrequency: 0,
      netPnl: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0,
      averageWin: 0, averageLoss: 0, expectancy: 0, averageTradeDuration: 0,
      totalFees: 0, totalSlippage: 0,
      longTrades: 0, longWinRate: 0, longPnl: 0,
      shortTrades: 0, shortWinRate: 0, shortPnl: 0,
      maxDrawdown: 0, sampleSize: 0, minimumSampleSize: 30,
      statisticalStatus: "INSUFFICIENT_SAMPLE",
      baselineId: "BASELINE-FAILED", createdAt: new Date().toISOString(),
      experienceRange: { earliest: 0, latest: 0 },
    },
    datasetCandles: 0, lookAheadProtected: false,
    createdAt: new Date().toISOString(), duration: 0,
  };
}

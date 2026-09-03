/**
 * Research Engine — BINANCE AI FUTURES AGENT v0.1 (P6)
 *
 * Performs structured market research using REAL kline data
 * from Binance Futures Testnet.
 *
 * Every data point comes from actual candles.
 * Every indicator is calculated from real OHLCV data.
 * No fabricated signals. No hardcoded patterns.
 */

import type { Kline, MarketSnapshot } from "../market/data-service";

// ─── Types ───────────────────────────────────────────────────────

export type TrendAnalysis = {
  direction: "UP" | "DOWN" | "FLAT";
  strength: number; // 0-100
  emaShort: number;
  emaLong: number;
  emaCross: "BULLISH" | "BEARISH" | "NEUTRAL";
};

export type MomentumAnalysis = {
  rsi: number; // 0-100
  rsiState: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdTrend: "BULLISH" | "BEARISH" | "NEUTRAL";
};

export type VolatilityAnalysis = {
  atr: number;
  atrPercent: number;
  bollingerUpper: number;
  bollingerLower: number;
  bollingerWidth: number;
  bollingerPercentB: number;
  regime: "HIGH" | "NORMAL" | "LOW";
};

export type VolumeAnalysis = {
  current: number;
  average: number;
  ratio: number; // current / average
  condition: "HIGH" | "NORMAL" | "LOW";
};

export type SupportResistance = {
  support: number;
  resistance: number;
  distanceToSupport: number; // percent
  distanceToResistance: number; // percent
};

export type ResearchResult = {
  symbol: string;
  timestamp: number;
  dataQuality: "GOOD" | "DEGRADED" | "STALE" | "INVALID";
  trend: TrendAnalysis;
  momentum: MomentumAnalysis;
  volatility: VolatilityAnalysis;
  volume: VolumeAnalysis;
  supportResistance: SupportResistance;
  riskReward: {
    longRiskReward: number;
    shortRiskReward: number;
  };
  score: number; // 0-100 composite research score
  tradeableDirection: "LONG" | "SHORT" | "NO_TRADE";
  evidence: string[];
  warnings: string[];
};

// ─── Technical Indicators (calculated from real klines) ──────────

function calculateEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  if (closes.length < period) {
    return closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    ema = (closes[i]! - ema) * multiplier + ema;
  }

  return ema;
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < 2) return 50;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  if (gains.length < period) return 50;

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number } {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);
  const macd = fastEMA - slowEMA;

  // Approximate signal line from recent MACD values
  const macdLine: number[] = [];
  for (let i = slowPeriod; i <= closes.length; i++) {
    const f = calculateEMA(closes.slice(0, i), fastPeriod);
    const s = calculateEMA(closes.slice(0, i), slowPeriod);
    macdLine.push(f - s);
  }

  const signal = calculateEMA(macdLine, signalPeriod);
  return { macd, signal, histogram: macd - signal };
}

function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): { upper: number; lower: number; width: number; percentB: number } {
  if (closes.length < period) {
    const avg = closes.reduce((a, b) => a + b, 0) / (closes.length || 1);
    return { upper: avg * 1.02, lower: avg * 0.98, width: 0.04, percentB: 0.5 };
  }

  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + (val - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = mean + stdDevMultiplier * stdDev;
  const lower = mean - stdDevMultiplier * stdDev;
  const width = (upper - lower) / mean;
  const current = closes[closes.length - 1]!;
  const percentB = upper !== lower ? (current - lower) / (upper - lower) : 0.5;

  return { upper, lower, width, percentB };
}

// ─── Research Engine ─────────────────────────────────────────────

export class ResearchEngine {
  /**
   * Perform comprehensive research on a symbol using real market data.
   * All indicators calculated from actual kline data.
   */
  research(snapshot: MarketSnapshot): ResearchResult {
    const klines = snapshot.klines;
    const symbol = snapshot.symbol;
    const warnings: string[] = [];
    const evidence: string[] = [];

    // Validate data
    if (klines.length < 30) {
      return invalidResearch(symbol, `Insufficient kline data: ${klines.length} candles`);
    }

    if (snapshot.dataQuality === "INVALID") {
      return invalidResearch(symbol, `Data quality: ${snapshot.dataQuality}`);
    }
    if (snapshot.dataQuality !== "GOOD") {
      warnings.push(`Data quality: ${snapshot.dataQuality}`);
    }

    const closes = klines.map((k) => k.close);
    const highs = klines.map((k) => k.high);
    const lows = klines.map((k) => k.low);
    const volumes = klines.map((k) => k.volume);
    const currentPrice = closes[closes.length - 1]!;

    // 1. Trend Analysis (from real EMAs)
    const emaShort = calculateEMA(closes, 20);
    const emaLong = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, Math.min(200, closes.length));
    const trend: TrendAnalysis = analyzeTrend(emaShort, emaLong, currentPrice, ema200);
    evidence.push(`EMA20=${emaShort.toFixed(2)}, EMA50=${emaLong.toFixed(2)} — trend: ${trend.direction}`);

    // 2. Momentum Analysis (from real RSI + MACD)
    const rsi = calculateRSI(closes);
    const macdData = calculateMACD(closes);
    const momentum: MomentumAnalysis = analyzeMomentum(rsi, macdData);
    evidence.push(`RSI=${rsi.toFixed(1)} (${momentum.rsiState}), MACD histogram=${macdData.histogram.toFixed(4)}`);

    // 3. Volatility Analysis (from real Bollinger + ATR)
    const bollinger = calculateBollingerBands(closes);
    const volatility: VolatilityAnalysis = analyzeVolatility(
      snapshot.volatility,
      currentPrice,
      bollinger,
    );
    evidence.push(`ATR=${snapshot.volatility.toFixed(2)} (${volatility.regime}), Bollinger %B=${bollinger.percentB.toFixed(2)}`);

    // 4. Volume Analysis (from real kline volumes)
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const currentVolume = volumes[volumes.length - 1]!;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    const volume: VolumeAnalysis = analyzeVolume(volumeRatio);
    evidence.push(`Volume ratio=${volumeRatio.toFixed(2)} (${volume.condition})`);

    // 5. Support/Resistance (from real price data)
    const sr = calculateSupportResistance(highs, lows, currentPrice);
    evidence.push(`Support=${sr.support.toFixed(2)} (dist=${sr.distanceToSupport.toFixed(1)}%), Resistance=${sr.resistance.toFixed(2)} (dist=${sr.distanceToResistance.toFixed(1)}%)`);

    // 6. Risk/Reward Assessment (from real ATR)
    const riskReward = calculateRiskReward(snapshot, sr);

    // 7. Composite Score (derived from all real data)
    const score = calculateResearchScore(trend, momentum, volatility, volume, riskReward);
    evidence.push(`Composite score: ${score.toFixed(0)}/100`);

    // 8. Tradeable Direction (determined from real analysis)
    const tradeableDirection = determineDirection(trend, momentum, volatility, volume, score);

    // Add warnings
    if (volatility.regime === "HIGH") {
      warnings.push("High volatility — wider stops needed, smaller position");
    }
    if (volume.condition === "LOW") {
      warnings.push("Below-average volume — lower liquidity confidence");
    }
    if (rsi > 70 || rsi < 30) {
      warnings.push(`RSI extreme at ${rsi.toFixed(1)} — reversal risk`);
    }

    return {
      symbol,
      timestamp: Date.now(),
      dataQuality: snapshot.dataQuality,
      trend,
      momentum,
      volatility,
      volume,
      supportResistance: sr,
      riskReward,
      score,
      tradeableDirection,
      evidence,
      warnings,
    };
  }
}

// ─── Analysis Helpers ────────────────────────────────────────────

function analyzeTrend(
  emaShort: number,
  emaLong: number,
  price: number,
  ema200: number,
): TrendAnalysis {
  let direction: TrendAnalysis["direction"] = "FLAT";
  let strength = 50;

  if (emaShort > emaLong && price > emaShort) {
    direction = "UP";
    strength = Math.min(100, 50 + ((emaShort - emaLong) / emaLong) * 5000);
  } else if (emaShort < emaLong && price < emaShort) {
    direction = "DOWN";
    strength = Math.min(100, 50 + ((emaLong - emaShort) / emaLong) * 5000);
  }

  let cross: TrendAnalysis["emaCross"] = "NEUTRAL";
  if (emaShort > emaLong) cross = "BULLISH";
  else if (emaShort < emaLong) cross = "BEARISH";

  // 200 EMA trend alignment
  if (price > ema200 && direction === "UP") strength = Math.min(100, strength + 10);
  if (price < ema200 && direction === "DOWN") strength = Math.min(100, strength + 10);

  return { direction, strength, emaShort, emaLong, emaCross: cross };
}

function analyzeMomentum(
  rsi: number,
  macdData: { macd: number; signal: number; histogram: number },
): MomentumAnalysis {
  let rsiState: MomentumAnalysis["rsiState"] = "NEUTRAL";
  if (rsi > 70) rsiState = "OVERBOUGHT";
  else if (rsi < 30) rsiState = "OVERSOLD";

  let macdTrend: MomentumAnalysis["macdTrend"] = "NEUTRAL";
  if (macdData.histogram > 0) macdTrend = "BULLISH";
  else if (macdData.histogram < 0) macdTrend = "BEARISH";

  return {
    rsi,
    rsiState,
    macd: macdData.macd,
    macdSignal: macdData.signal,
    macdHistogram: macdData.histogram,
    macdTrend,
  };
}

function analyzeVolatility(
  atr: number,
  price: number,
  bollinger: { upper: number; lower: number; width: number; percentB: number },
): VolatilityAnalysis {
  const atrPercent = price > 0 ? atr / price : 0;

  let regime: VolatilityAnalysis["regime"] = "NORMAL";
  if (atrPercent > 0.03) regime = "HIGH";
  else if (atrPercent < 0.005) regime = "LOW";

  return {
    atr,
    atrPercent,
    bollingerUpper: bollinger.upper,
    bollingerLower: bollinger.lower,
    bollingerWidth: bollinger.width,
    bollingerPercentB: bollinger.percentB,
    regime,
  };
}

function analyzeVolume(ratio: number): VolumeAnalysis {
  let condition: VolumeAnalysis["condition"] = "NORMAL";
  if (ratio > 1.5) condition = "HIGH";
  else if (ratio < 0.5) condition = "LOW";

  return { current: 0, average: 0, ratio, condition };
}

function calculateSupportResistance(
  highs: number[],
  lows: number[],
  currentPrice: number,
): SupportResistance {
  const lookback = Math.min(50, highs.length);
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);

  // Simple pivot-based S/R
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);

  const distanceToSupport = support > 0
    ? ((currentPrice - support) / currentPrice) * 100
    : 0;
  const distanceToResistance = resistance > 0
    ? ((resistance - currentPrice) / currentPrice) * 100
    : 0;

  return { support, resistance, distanceToSupport, distanceToResistance };
}

function calculateRiskReward(
  snapshot: MarketSnapshot,
  sr: SupportResistance,
): { longRiskReward: number; shortRiskReward: number } {
  // Risk = distance to support, Reward = distance to resistance
  const longRisk = sr.distanceToSupport > 0 ? sr.distanceToSupport : 1;
  const longReward = sr.distanceToResistance > 0 ? sr.distanceToResistance : 1;
  const longRR = longReward / longRisk;

  const shortRisk = sr.distanceToResistance > 0 ? sr.distanceToResistance : 1;
  const shortReward = sr.distanceToSupport > 0 ? sr.distanceToSupport : 1;
  const shortRR = shortReward / shortRisk;

  return { longRiskReward: longRR, shortRiskReward: shortRR };
}

function calculateResearchScore(
  trend: TrendAnalysis,
  momentum: MomentumAnalysis,
  volatility: VolatilityAnalysis,
  volume: VolumeAnalysis,
  riskReward: { longRiskReward: number; shortRiskReward: number },
): number {
  let score = 0;

  // Trend clarity (0-25)
  score += trend.strength * 0.25;

  // Momentum alignment (0-25)
  if (trend.direction === "UP" && momentum.macdTrend === "BULLISH") score += 15;
  if (trend.direction === "DOWN" && momentum.macdTrend === "BEARISH") score += 15;
  if (momentum.rsiState === "NEUTRAL") score += 5;
  if (momentum.rsiState !== "OVERBOUGHT" && momentum.rsiState !== "OVERSOLD") score += 5;

  // Volatility (0-25) — prefer normal
  if (volatility.regime === "NORMAL") score += 20;
  else if (volatility.regime === "LOW") score += 10;
  // HIGH volatility doesn't add score

  // Volume (0-25)
  if (volume.condition === "HIGH") score += 20;
  else if (volume.condition === "NORMAL") score += 15;
  else score += 5;

  // Risk/reward bonus
  const bestRR = Math.max(riskReward.longRiskReward, riskReward.shortRiskReward);
  if (bestRR >= 2) score += 10;
  else if (bestRR >= 1.5) score += 5;

  return Math.min(100, Math.max(0, score));
}

function determineDirection(
  trend: TrendAnalysis,
  momentum: MomentumAnalysis,
  volatility: VolatilityAnalysis,
  volume: VolumeAnalysis,
  score: number,
): "LONG" | "SHORT" | "NO_TRADE" {
  // Minimum score to trade
  if (score < 40) return "NO_TRADE";

  // Need trend + momentum alignment
  if (trend.direction === "UP" && momentum.macdTrend === "BULLISH" && score >= 50) {
    return "LONG";
  }
  if (trend.direction === "DOWN" && momentum.macdTrend === "BEARISH" && score >= 50) {
    return "SHORT";
  }

  // Weak signals → NO_TRADE
  return "NO_TRADE";
}

function invalidResearch(symbol: string, reason: string): ResearchResult {
  return {
    symbol,
    timestamp: Date.now(),
    dataQuality: "INVALID",
    trend: { direction: "FLAT", strength: 0, emaShort: 0, emaLong: 0, emaCross: "NEUTRAL" },
    momentum: { rsi: 50, rsiState: "NEUTRAL", macd: 0, macdSignal: 0, macdHistogram: 0, macdTrend: "NEUTRAL" },
    volatility: { atr: 0, atrPercent: 0, bollingerUpper: 0, bollingerLower: 0, bollingerWidth: 0, bollingerPercentB: 0, regime: "NORMAL" },
    volume: { current: 0, average: 0, ratio: 0, condition: "LOW" },
    supportResistance: { support: 0, resistance: 0, distanceToSupport: 0, distanceToResistance: 0 },
    riskReward: { longRiskReward: 0, shortRiskReward: 0 },
    score: 0,
    tradeableDirection: "NO_TRADE",
    evidence: [`Research INVALID: ${reason}`],
    warnings: [reason],
  };
}

/**
 * Runtime Intelligence Types — BINANCE AI FUTURES AGENT v0.1
 *
 * Defines the MarketState and related structures that the
 * Runtime Intelligence Engine produces.
 *
 * This is NOT a trading decision. It answers:
 * "What is happening in the market right now?"
 */

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "BREAKOUT"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "UNCERTAIN";

export type FeedStatus = "ONLINE" | "DEGRADED" | "STALE" | "OFFLINE";

export type TrendDirection = "UP" | "DOWN" | "FLAT";

export type MomentumState = "STRONG" | "MODERATE" | "WEAK" | "REVERSAL";

export type MarketStructure = "HIGHER_HIGHS" | "LOWER_LOWS" | "CONSOLIDATION" | "MIXED";

export type DataQuality = "GOOD" | "DEGRADED" | "STALE" | "INVALID";

export type MarketState = {
  symbol: string;
  timestamp: number;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;

  // Trend
  trend: TrendDirection;
  trendStrength: number; // 0-100

  // Momentum
  momentum: MomentumState;
  momentumScore: number; // 0-100

  // Volatility
  volatility: number; // ATR-based
  volatilityPercent: number; // Normalized 0-100

  // Volume
  volume24h: number;
  volumeChange: number; // vs average

  // Market Structure
  marketStructure: MarketStructure;

  // Regime Classification
  marketRegime: MarketRegime;
  regimeConfidence: number; // 0-100

  // Liquidity
  liquidity: number; // 0-100 score

  // Data Quality
  dataQuality: DataQuality;
  feedStatus: FeedStatus;

  // Metadata
  lastUpdate: number;
  dataAge: number; // ms since last data point
};

export type TechnicalIndicators = {
  symbol: string;
  timestamp: number;

  // Trend
  ema20: number;
  ema50: number;
  ema200: number;
  emaCross: "BULLISH" | "BEARISH" | "NEUTRAL";

  // Momentum
  rsi: number; // 0-100
  rsiState: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";

  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdTrend: "BULLISH" | "BEARISH" | "NEUTRAL";

  // Volatility
  atr: number;
  atrPercent: number;

  // Volume
  vwap: number;
  volumeProfile: "ABOVE_VWAP" | "BELOW_VWAP" | "AT_VWAP";

  // Bollinger
  bollingerUpper: number;
  bollingerLower: number;
  bollingerPercent: number; // %B
};

export type RuntimeSnapshot = {
  marketState: MarketState;
  indicators: TechnicalIndicators;
  timestamp: number;
  processingTimeMs: number;
};

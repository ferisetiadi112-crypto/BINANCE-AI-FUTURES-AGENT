/**
 * Runtime Intelligence Engine — BINANCE AI FUTURES AGENT v0.1
 */

import type { MarketState, FeedStatus, DataQuality, TrendDirection, MomentumState, MarketStructure, RuntimeSnapshot } from "./types";
import { calculateAllIndicators, type Candle } from "./indicators";
import { classifyRegime } from "./regime";
import { logger } from "../logger";

let currentState: RuntimeSnapshot | null = null;
let feedStatus: FeedStatus = "OFFLINE";
let lastDataTime = 0;

const STALE_THRESHOLD_MS = 60_000;
const DEGRADED_THRESHOLD_MS = 30_000;

export function getFeedStatus(): FeedStatus {
  if (lastDataTime === 0) return "OFFLINE";
  const age = Date.now() - lastDataTime;
  if (age > STALE_THRESHOLD_MS) return "STALE";
  if (age > DEGRADED_THRESHOLD_MS) return "DEGRADED";
  return "ONLINE";
}

export function updateFeedStatus(status: FeedStatus): void {
  feedStatus = status;
  logger.info("runtime", `Feed status: ${status}`);
}

export function onDataReceived(): void {
  lastDataTime = Date.now();
  feedStatus = "ONLINE";
}

export function generateMarketState(params: {
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volume24h: number;
  klines: Array<{ open: number; high: number; low: number; close: number; volume: number }>;
}): MarketState {
  const { symbol, price, priceChange24h, priceChangePercent24h, volume24h, klines } = params;

  const closes = klines.map(k => k.close);
  const candles: Candle[] = klines.map(k => ({ high: k.high, low: k.low, close: k.close }));
  const indicators = calculateAllIndicators(closes, candles, klines.map(k => k.volume));

  const trend = calculateTrend(closes, indicators.ema20, indicators.ema50);
  const trendStrength = calculateTrendStrength(closes, indicators.ema20, indicators.ema50, indicators.ema200);
  const momentum = calculateMomentum(indicators.rsi, indicators.macdHistogram, indicators.macdTrend);
  const momentumScore = calculateMomentumScore(indicators.rsi, indicators.macdHistogram);
  const volatility = indicators.atr;
  const volatilityPercent = indicators.atrPercent;
  const volumeChange = calculateVolumeChange(volume24h, klines);
  const marketStructure = calculateMarketStructure(closes);
  const liquidity = calculateLiquidity(volume24h, klines);

  const regime = classifyRegime({
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

  const dataQuality = determineDataQuality(klines, lastDataTime);

  return {
    symbol,
    timestamp: Date.now(),
    price,
    priceChange24h,
    priceChangePercent24h,
    trend,
    trendStrength,
    momentum,
    momentumScore,
    volatility,
    volatilityPercent,
    volume24h,
    volumeChange,
    marketStructure,
    marketRegime: regime.regime,
    regimeConfidence: regime.confidence,
    liquidity,
    dataQuality,
    feedStatus: getFeedStatus(),
    lastUpdate: Date.now(),
    dataAge: lastDataTime > 0 ? Date.now() - lastDataTime : Infinity,
  };
}

function calculateTrend(closes: number[], ema20: number, _ema50: number): TrendDirection {
  if (closes.length < 2) return "FLAT";
  const lastPrice = closes[closes.length - 1]!;
  const prevPrice = closes[closes.length - 2]!;
  const priceChange = lastPrice - prevPrice;
  if (priceChange > 0 && lastPrice > ema20) return "UP";
  if (priceChange < 0 && lastPrice < ema20) return "DOWN";
  return "FLAT";
}

function calculateTrendStrength(closes: number[], ema20: number, ema50: number, ema200: number): number {
  if (closes.length < 20) return 50;
  let strength = 50;
  if (ema20 > ema50 && ema50 > ema200) strength += 20;
  else if (ema20 < ema50 && ema50 < ema200) strength += 20;
  else strength -= 10;
  const lastPrice = closes[closes.length - 1]!;
  if (lastPrice > ema20) strength += 10;
  else strength -= 10;
  const idx = Math.max(0, closes.length - 10);
  const prevPrice = closes[idx]!;
  const recentChange = prevPrice > 0 ? (lastPrice - prevPrice) / prevPrice : 0;
  strength += Math.min(20, Math.abs(recentChange) * 1000);
  return Math.max(0, Math.min(100, strength));
}

function calculateMomentum(rsi: number, macdHistogram: number, macdTrend: string): MomentumState {
  if (rsi > 70 && macdTrend === "BULLISH") return "STRONG";
  if (rsi < 30 && macdTrend === "BEARISH") return "STRONG";
  if (rsi > 60 || rsi < 40) return "MODERATE";
  if (Math.abs(macdHistogram) > 0) return "WEAK";
  return "REVERSAL";
}

function calculateMomentumScore(rsi: number, macdHistogram: number): number {
  let score = 50;
  score += (rsi - 50) * 0.3;
  score += Math.min(20, Math.abs(macdHistogram) * 10) * Math.sign(macdHistogram);
  return Math.max(0, Math.min(100, score));
}

function calculateVolumeChange(_volume24h: number, klines: Array<{ volume: number }>): number {
  if (klines.length < 2) return 0;
  const avgVolume = klines.slice(0, -1).reduce((a, k) => a + k.volume, 0) / (klines.length - 1);
  const lastVolume = klines[klines.length - 1]!.volume;
  return avgVolume > 0 ? ((lastVolume - avgVolume) / avgVolume) * 100 : 0;
}

function calculateMarketStructure(closes: number[]): MarketStructure {
  if (closes.length < 10) return "CONSOLIDATION";
  const recent = closes.slice(-10);
  let highs = 0;
  let lows = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]! > recent[i - 1]!) highs++;
    if (recent[i]! < recent[i - 1]!) lows++;
  }
  if (highs > lows && highs > 5) return "HIGHER_HIGHS";
  if (lows > highs && lows > 5) return "LOWER_LOWS";
  return "CONSOLIDATION";
}

function calculateLiquidity(_volume24h: number, klines: Array<{ volume: number }>): number {
  if (klines.length === 0) return 50;
  const avgVolume = klines.reduce((a, k) => a + k.volume, 0) / klines.length;
  const volumeScore = Math.min(100, (avgVolume / 1000) * 100);
  return Math.max(0, Math.min(100, volumeScore));
}

function determineDataQuality(klines: Array<{ open: number; high: number; low: number; close: number }>, lastDataTime: number): DataQuality {
  if (klines.length === 0) return "INVALID";
  const hasInvalidPrices = klines.some(k => k.open <= 0 || k.high <= 0 || k.low <= 0 || k.close <= 0);
  if (hasInvalidPrices) return "INVALID";
  const age = Date.now() - lastDataTime;
  if (age > STALE_THRESHOLD_MS) return "STALE";
  if (age > DEGRADED_THRESHOLD_MS) return "DEGRADED";
  return "GOOD";
}

export function updateSnapshot(snapshot: RuntimeSnapshot): void {
  currentState = snapshot;
  logger.debug("runtime", `Snapshot updated for ${snapshot.marketState.symbol}`);
}

export function getSnapshot(): RuntimeSnapshot | null {
  return currentState;
}

export function getMarketState(): MarketState | null {
  return currentState?.marketState || null;
}

export function resetEngine(): void {
  currentState = null;
  feedStatus = "OFFLINE";
  lastDataTime = 0;
  logger.info("runtime", "Engine reset");
}

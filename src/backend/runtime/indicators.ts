/**
 * Technical Indicators — BINANCE AI FUTURES AGENT v0.1
 */

import type { TechnicalIndicators } from "./types";

export function calculateEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  if (data.length < period) return data.slice();
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i]!;
  }
  ema.push(sum / period);
  for (let i = period; i < data.length; i++) {
    const value = data[i]! * k + ema[ema.length - 1]! * (1 - k);
    ema.push(value);
  }
  return ema;
}

export function getLatestEMA(data: number[], period: number): number {
  const ema = calculateEMA(data, period);
  return ema[ema.length - 1] ?? 0;
}

export function calculateRSI(data: number[], period = 14): number {
  if (data.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const change = data[i]! - data[i - 1]!;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function calculateMACD(
  data: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number } {
  if (data.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  const macdLine: number[] = [];
  const offset = slowPeriod - fastPeriod;
  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset]! - slowEMA[i]!);
  }
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const macd = macdLine[macdLine.length - 1] ?? 0;
  const signal = signalLine[signalLine.length - 1] ?? 0;
  return { macd, signal, histogram: macd - signal };
}

export type Candle = { high: number; low: number; close: number };

export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i]!;
  }
  atr /= period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }
  return atr;
}

export type VwapCandle = { high: number; low: number; close: number; volume: number };

export function calculateVWAP(candles: VwapCandle[]): number {
  if (candles.length === 0) return 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

export function calculateBollinger(
  data: number[],
  period = 20,
  stdDevMultiplier = 2,
): { upper: number; lower: number; percent: number } {
  if (data.length < period) {
    const last = data[data.length - 1] ?? 0;
    return { upper: last, lower: last, percent: 0.5 };
  }
  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdDevMultiplier * stdDev;
  const lower = mean - stdDevMultiplier * stdDev;
  const last = data[data.length - 1] ?? 0;
  const percent = upper !== lower ? (last - lower) / (upper - lower) : 0.5;
  return { upper, lower, percent };
}

export function calculateAllIndicators(
  closes: number[],
  candles: Candle[],
  _volumes: number[],
): TechnicalIndicators {
  const ema20 = getLatestEMA(closes, 20);
  const ema50 = getLatestEMA(closes, 50);
  const ema200 = getLatestEMA(closes, 200);
  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles);
  const lastPrice = closes[closes.length - 1] ?? 0;
  const vwapCandles: VwapCandle[] = candles.map(c => ({ high: c.high, low: c.low, close: c.close, volume: 0 }));
  const vwap = calculateVWAP(vwapCandles);
  const bollinger = calculateBollinger(closes);

  return {
    symbol: "",
    timestamp: Date.now(),
    ema20,
    ema50,
    ema200,
    emaCross: ema20 > ema50 ? "BULLISH" : ema20 < ema50 ? "BEARISH" : "NEUTRAL",
    rsi,
    rsiState: rsi > 70 ? "OVERBOUGHT" : rsi < 30 ? "OVERSOLD" : "NEUTRAL",
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    macdTrend: macd.histogram > 0 ? "BULLISH" : macd.histogram < 0 ? "BEARISH" : "NEUTRAL",
    atr,
    atrPercent: lastPrice > 0 ? (atr / lastPrice) * 100 : 0,
    vwap,
    volumeProfile: lastPrice > vwap ? "ABOVE_VWAP" : lastPrice < vwap ? "BELOW_VWAP" : "AT_VWAP",
    bollingerUpper: bollinger.upper,
    bollingerLower: bollinger.lower,
    bollingerPercent: bollinger.percent,
  };
}

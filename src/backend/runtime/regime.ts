/**
 * Market Regime Classifier — BINANCE AI FUTURES AGENT v0.1
 *
 * Classifies market conditions into regimes based on technical indicators.
 * This is a simple heuristic-based classifier (Phase 3 foundation).
 * Future phases can add ML-based classification.
 *
 * Regimes:
 * - TRENDING_UP: Strong upward trend with momentum
 * - TRENDING_DOWN: Strong downward trend with momentum
 * - RANGING: No clear trend, oscillating
 * - BREAKOUT: Price breaking out of range
 * - HIGH_VOLATILITY: Large price swings
 * - LOW_VOLATILITY: Compressed price action
 * - UNCERTAIN: Not enough data or conflicting signals
 */

import type { MarketRegime } from "./types";

export type RegimeResult = {
  regime: MarketRegime;
  confidence: number; // 0-100
  factors: string[];
};

type RegimeInput = {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  atrPercent: number;
  macdHistogram: number;
  bollingerPercent: number;
  trendStrength: number; // 0-100
  momentumScore: number; // 0-100
};

export function classifyRegime(input: RegimeInput): RegimeResult {
  const factors: string[] = [];
  let regime: MarketRegime = "UNCERTAIN";
  let confidence = 50;

  // Check for strong trend
  const emaAlignment = input.ema20 > input.ema50 && input.ema50 > input.ema200;
  const emaAlignmentDown = input.ema20 < input.ema50 && input.ema50 < input.ema200;
  const strongMomentum = Math.abs(input.macdHistogram) > 0;
  const highTrendStrength = input.trendStrength > 60;

  // TRENDING_UP
  if (emaAlignment && input.rsi > 50 && input.rsi < 75 && highTrendStrength) {
    regime = "TRENDING_UP";
    confidence = Math.min(90, 50 + input.trendStrength * 0.4);
    factors.push("EMA alignment bullish");
    factors.push(`RSI ${input.rsi.toFixed(1)} in bullish zone`);
    factors.push(`Trend strength ${input.trendStrength}`);
    return { regime, confidence, factors };
  }

  // TRENDING_DOWN
  if (emaAlignmentDown && input.rsi < 50 && input.rsi > 25 && highTrendStrength) {
    regime = "TRENDING_DOWN";
    confidence = Math.min(90, 50 + input.trendStrength * 0.4);
    factors.push("EMA alignment bearish");
    factors.push(`RSI ${input.rsi.toFixed(1)} in bearish zone`);
    factors.push(`Trend strength ${input.trendStrength}`);
    return { regime, confidence, factors };
  }

  // HIGH_VOLATILITY
  if (input.atrPercent > 3) {
    regime = "HIGH_VOLATILITY";
    confidence = Math.min(85, 50 + input.atrPercent * 5);
    factors.push(`ATR ${input.atrPercent.toFixed(1)}% indicates high volatility`);
    factors.push(`Bollinger %B ${input.bollingerPercent.toFixed(2)}`);
    return { regime, confidence, factors };
  }

  // LOW_VOLATILITY
  if (input.atrPercent < 0.5 && input.trendStrength < 30) {
    regime = "LOW_VOLATILITY";
    confidence = Math.min(80, 50 + (1 - input.atrPercent) * 30);
    factors.push(`ATR ${input.atrPercent.toFixed(1)}% indicates low volatility`);
    factors.push(`Trend strength ${input.trendStrength} — compressed`);
    return { regime, confidence, factors };
  }

  // RANGING
  if (input.trendStrength < 40 && Math.abs(input.rsi - 50) < 15) {
    regime = "RANGING";
    confidence = Math.min(75, 50 + (40 - input.trendStrength) * 0.5);
    factors.push(`Trend strength ${input.trendStrength} — no clear trend`);
    factors.push(`RSI ${input.rsi.toFixed(1)} near neutral`);
    return { regime, confidence, factors };
  }

  // BREAKOUT
  if (input.bollingerPercent > 0.9 || input.bollingerPercent < 0.1) {
    regime = "BREAKOUT";
    confidence = Math.min(70, 50 + Math.abs(input.bollingerPercent - 0.5) * 40);
    factors.push(`Bollinger %B ${input.bollingerPercent.toFixed(2)} — near band edge`);
    factors.push(`Momentum score ${input.momentumScore}`);
    return { regime, confidence, factors };
  }

  // Default: UNCERTAIN
  factors.push("Insufficient signals for clear classification");
  factors.push(`RSI ${input.rsi.toFixed(1)}, Trend ${input.trendStrength}`);
  return { regime: "UNCERTAIN", confidence: 30, factors };
}

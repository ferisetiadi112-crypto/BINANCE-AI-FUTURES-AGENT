/**
 * AI Decision Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Transforms MarketState into structured trading decisions.
 * This is NOT autonomous trading. It produces recommendations
 * that the Risk Engine must approve before paper execution.
 *
 * Architecture:
 *   MarketState
 *     → Strategy Evaluation
 *       → Signal Aggregation
 *         → AI Decision
 *           → Risk Engine (highest authority)
 *             → Paper Execution
 */

import type { MarketState } from "../runtime/types";
import type { AiDecision, DecisionDirection, DecisionEvidence, StrategyName, ConfidenceLevel } from "./types";
import { getConfidenceLevel } from "./types";
import { evaluateAllStrategies, getBestSignal } from "./strategies";
import { logger } from "../logger";

const DECISION_VERSION = "1.0.0";
const MODEL_VERSION = "rule-based-v1";

// ─── Decision Generation ──────────────────────────────────────────────

let decisionCounter = 0;

export function generateDecision(state: MarketState): AiDecision {
  const startTime = Date.now();
  decisionCounter++;

  // Evaluate all strategies
  const evaluations = evaluateAllStrategies(state);

  // Find best signal
  const bestSignal = getBestSignal(state);

  // Determine direction
  let direction: DecisionDirection = "NO_TRADE";
  let strategy: StrategyName = "TREND_FOLLOWING";
  let confidence = 0;

  if (bestSignal && bestSignal.signal.strength > 0.3) {
    direction = bestSignal.signal.direction;
    strategy = bestSignal.signal.strategy;
    confidence = calculateConfidence(state, bestSignal.signal.strength);
  }

  // Build evidence
  const evidence = buildEvidence(state);

  // Create decision
  const decision: AiDecision = {
    id: `DEC-${Date.now()}-${decisionCounter}`,
    timestamp: Date.now(),
    symbol: state.symbol,

    direction,
    confidence,
    confidenceLevel: getConfidenceLevel(confidence),
    strategy,

    marketRegime: state.marketRegime,
    regimeConfidence: state.regimeConfidence,
    evidence,

    decisionVersion: DECISION_VERSION,
    modelVersion: MODEL_VERSION,
  };

  const elapsed = Date.now() - startTime;
  logger.info("ai-decision", `Decision: ${direction} ${state.symbol} (${(confidence * 100).toFixed(1)}%) via ${strategy} [${elapsed}ms]`);

  return decision;
}

// ─── Confidence Calculation ───────────────────────────────────────────

function calculateConfidence(state: MarketState, signalStrength: number): number {
  let confidence = 0;

  // Base confidence from signal strength
  confidence += signalStrength * 0.4;

  // Regime confidence contribution
  confidence += (state.regimeConfidence / 100) * 0.25;

  // Data quality contribution
  if (state.dataQuality === "GOOD") confidence += 0.15;
  else if (state.dataQuality === "DEGRADED") confidence += 0.05;
  // STALE or INVALID reduces confidence

  // Feed status contribution
  if (state.feedStatus === "ONLINE") confidence += 0.1;
  else if (state.feedStatus === "DEGRADED") confidence += 0.05;

  // Trend strength contribution
  confidence += (state.trendStrength / 100) * 0.1;

  return Math.min(1, Math.max(0, confidence));
}

// ─── Evidence Building ────────────────────────────────────────────────

function buildEvidence(state: MarketState): DecisionEvidence {
  return {
    trend: `${state.trend} (strength: ${state.trendStrength.toFixed(1)})`,
    momentum: `${state.momentum} (score: ${state.momentumScore.toFixed(1)})`,
    volume: `24h: ${state.volume24h.toFixed(0)} (change: ${state.volumeChange.toFixed(1)}%)`,
    volatility: `ATR: ${state.volatility.toFixed(2)} (${state.volatilityPercent.toFixed(2)}%)`,
    structure: state.marketStructure,
    regime: state.marketRegime,
    regimeConfidence: state.regimeConfidence,
    indicators: {
      rsi: 0, // Will be filled from indicators if available
      ema20: 0,
      ema50: 0,
      macd: 0,
      atr: state.volatility,
    },
  };
}

// ─── Decision Validation ──────────────────────────────────────────────

export function validateDecision(decision: AiDecision): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!decision.id) errors.push("Missing decision ID");
  if (!decision.symbol) errors.push("Missing symbol");
  if (!decision.timestamp) errors.push("Missing timestamp");
  if (!["LONG", "SHORT", "NO_TRADE"].includes(decision.direction)) {
    errors.push(`Invalid direction: ${decision.direction}`);
  }
  if (decision.confidence < 0 || decision.confidence > 1) {
    errors.push(`Invalid confidence: ${decision.confidence}`);
  }
  if (!decision.strategy) errors.push("Missing strategy");

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Decision Summary ─────────────────────────────────────────────────

export function formatDecisionSummary(decision: AiDecision): string {
  const conf = (decision.confidence * 100).toFixed(1);
  return `[${decision.direction}] ${decision.symbol} | ${conf}% confidence | ${decision.strategy} | regime: ${decision.marketRegime}`;
}

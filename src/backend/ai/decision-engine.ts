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
import { AIRouter, type RouterResult } from "./llm/router";
import type { ExchangeContextForPrompt } from "./llm/prompt";
import type { AIDecisionOutput, AITradePlan } from "./llm/types";
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

// ─── LLM Decision Generation ───────────────────────────────────────

let llmRouter: AIRouter | null = null;

/**
 * Get or create the singleton AIRouter instance.
 * The router dynamically discovers available providers from env vars.
 */
function getLLMRouter(): AIRouter {
  if (!llmRouter) {
    llmRouter = new AIRouter();
  }
  return llmRouter;
}

/**
 * Override the router instance (useful for testing with mocked providers).
 */
export function setLLMRouterForTesting(router: AIRouter): void {
  llmRouter = router;
}

/**
 * Reset the router singleton (for testing).
 */
export function resetLLMRouter(): void {
  llmRouter = null;
}

/**
 * Generate an AI decision using the LLM provider chain.
 * Falls back to the safe NO_TRADE decision if all providers fail.
 *
 * Returns a RouterResult containing:
 *   - decision: the AIDecisionOutput from the LLM (or safe fallback)
 *   - provider: which provider answered (or "safe_fallback")
 *   - elapsedMs: total latency
 */
export async function generateLLMDecision(
  marketState: MarketState,
  exchangeContext?: ExchangeContextForPrompt | null,
  marketContext?: import("./llm/prompt").MarketContextForPrompt | null,
  memoryContext?: import("./memory-context").MemoryContextForPrompt | null,
  research?: import("../research/research-engine").ResearchResult | null,
  positionHint?: import("./llm/prompt").PositionHint | null,
): Promise<RouterResult> {
  const router = getLLMRouter();
  return router.route(marketState, exchangeContext, marketContext, memoryContext, research, positionHint);
}

// ─── Phase 2: Action & Trade Plan Validation ─────────────────────────

export type PositionInfo = {
  hasPosition: boolean;
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  size: number;
};

/**
 * Phase 2: Validate an AI action against the REAL current position state.
 * - No position: only RESEARCH_MORE / WAIT / OPEN allowed.
 * - Position open: only RESEARCH_MORE / WAIT / HOLD / CLOSE allowed (no duplicate OPEN).
 * Returns an error message when the action is impermissible; null when valid.
 */
export function validateAIAction(
  action: string,
  position: PositionInfo | null,
): string | null {
  const hasPosition = !!position?.hasPosition;
  if (action === "OPEN" && hasPosition) {
    return `OPEN rejected: a ${position!.side} position is already open on ${position!.symbol} — duplicate position not allowed`;
  }
  if ((action === "HOLD" || action === "CLOSE") && !hasPosition) {
    return `${action} rejected: no position is open — nothing to ${action.toLowerCase()}`;
  }
  return null;
}

/**
 * Phase 2: Validate the AI-proposed trade plan for OPEN decisions.
 * Structural sanity only (prices, direction coherence, leverage bounds).
 * Risk Engine remains the final authority via validateTradeProposal.
 * Returns an error message when invalid; null when structurally valid.
 */
export function validateAITradePlan(
  plan: AITradePlan | undefined,
  currentPrice: number,
): string | null {
  if (!plan) return "OPEN decision is missing a trade plan";
  if (!(plan.entry > 0) || !(plan.stopLoss > 0) || !(plan.takeProfit > 0)) {
    return "Trade plan has non-positive prices";
  }
  if (!(plan.margin > 0)) return "Trade plan margin must be positive";
  if (plan.leverage < 1 || plan.leverage > 20) return "Trade plan leverage must be 1-20";

  // Impossible price / direction coherence — do not invent corrections, reject.
  if (plan.direction === "LONG") {
    if (plan.stopLoss >= plan.entry) return "LONG plan: stop-loss must be below entry";
    if (plan.takeProfit <= plan.entry) return "LONG plan: take-profit must be above entry";
  } else {
    if (plan.stopLoss <= plan.entry) return "SHORT plan: stop-loss must be above entry";
    if (plan.takeProfit >= plan.entry) return "SHORT plan: take-profit must be below entry";
  }

  // Entry wildly detached from the real market price (impossible price) — reject.
  const deviation = Math.abs(plan.entry - currentPrice) / currentPrice;
  if (deviation > 0.1) {
    return `Trade plan entry $${plan.entry.toFixed(2)} deviates ${ (deviation * 100).toFixed(1) }% from market price $${currentPrice.toFixed(2)} (>10%) — rejected`;
  }

  return null;
}

/**
 * Phase 2: Convert an AIDecisionOutput into a full AiDecision object.
 * Merges LLM output with market state context to produce the
 * standard AiDecision format used by the risk engine and paper trading.
 */
export function mergeLLMDecisionIntoAiDecision(
  llmOutput: AIDecisionOutput,
  marketState: MarketState,
  routerResult: RouterResult,
): AiDecision {
  decisionCounter++;

  // Build evidence from market state
  const evidence = buildEvidence(marketState);

  // Map LLM strategy to our StrategyName type
  const strategy: StrategyName = llmOutput.strategy;

  const decision: AiDecision = {
    id: `DEC-LLM-${Date.now()}-${decisionCounter}`,
    timestamp: Date.now(),
    symbol: marketState.symbol,

    direction: llmOutput.direction,
    confidence: llmOutput.confidence,
    confidenceLevel: getConfidenceLevel(llmOutput.confidence),
    strategy,
    action: llmOutput.action,
    tradePlan: llmOutput.tradePlan,

    marketRegime: marketState.marketRegime,
    regimeConfidence: marketState.regimeConfidence,
    evidence,

    decisionVersion: DECISION_VERSION,
    modelVersion: `llm-${routerResult.provider}`,
  };

  logger.info(
    "ai-decision",
    `LLM Decision: ${llmOutput.action ?? "WAIT"} ${llmOutput.direction} ${marketState.symbol} (${(llmOutput.confidence * 100).toFixed(1)}%) via ${routerResult.provider} [${routerResult.elapsedMs}ms]`,
  );

  return decision;
}

// ─── Decision Summary ─────────────────────────────────────────────────

export function formatDecisionSummary(decision: AiDecision): string {
  const conf = (decision.confidence * 100).toFixed(1);
  return `[${decision.direction}] ${decision.symbol} | ${conf}% confidence | ${decision.strategy} | regime: ${decision.marketRegime}`;
}

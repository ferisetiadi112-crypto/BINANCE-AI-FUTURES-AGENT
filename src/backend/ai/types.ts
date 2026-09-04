/**
 * AI Decision Engine Types — BINANCE AI FUTURES AGENT v0.1
 *
 * Defines the structured decision output from the AI.
 * Every decision is auditable and stored in the database.
 */

import type { MarketState, MarketRegime } from "../runtime/types";

// ─── Decision Direction ───────────────────────────────────────────────

export type DecisionDirection = "LONG" | "SHORT" | "NO_TRADE";

// ─── Confidence Levels ────────────────────────────────────────────────

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.80) return "VERY_HIGH";
  if (confidence >= 0.60) return "HIGH";
  if (confidence >= 0.40) return "MEDIUM";
  return "LOW";
}

/**
 * Confidence meaning:
 * - LOW (0.00-0.39): Insufficient evidence, high uncertainty
 * - MEDIUM (0.40-0.59): Some evidence, moderate uncertainty
 * - HIGH (0.60-0.79): Strong evidence, lower uncertainty
 * - VERY_HIGH (0.80-1.00): Very strong evidence, high conviction
 *
 * NOTE: Confidence is NOT a probability of winning.
 * It represents conviction level based on available evidence.
 */

// ─── Strategy ─────────────────────────────────────────────────────────

export type StrategyName =
  | "TREND_FOLLOWING"
  | "MOMENTUM"
  | "BREAKOUT"
  | "PULLBACK"
  | "MEAN_REVERSION";

export type StrategySignal = {
  strategy: StrategyName;
  direction: DecisionDirection;
  strength: number; // 0-1
  reasoning: string;
};

// ─── Evidence ─────────────────────────────────────────────────────────

export type DecisionEvidence = {
  trend: string;
  momentum: string;
  volume: string;
  volatility: string;
  structure: string;
  regime: MarketRegime;
  regimeConfidence: number;
  indicators: {
    rsi: number;
    ema20: number;
    ema50: number;
    macd: number;
    atr: number;
  };
};

// ─── AI Decision ──────────────────────────────────────────────────────

export type AiDecision = {
  id: string;
  timestamp: number;
  symbol: string;

  // Decision
  direction: DecisionDirection;
  confidence: number; // 0-1
  confidenceLevel: ConfidenceLevel;
  strategy: StrategyName;

  /** Phase 2: What the AI wants to DO next. */
  action?: "RESEARCH_MORE" | "WAIT" | "OPEN" | "HOLD" | "CLOSE";
  /** Phase 2: AI-proposed trade plan (action = OPEN only). Proposal only — Risk Engine is final authority. */
  tradePlan?: {
    direction: "LONG" | "SHORT";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    margin: number;
    leverage: number;
  } | undefined;

  // Context
  marketRegime: MarketRegime;
  regimeConfidence: number;
  evidence: DecisionEvidence;

  // Metadata
  decisionVersion: string;
  modelVersion: string;

  // Risk context (filled by risk engine)
  riskResult?: "APPROVED" | "REJECTED";
  riskReason?: string;

  // Execution result (filled by paper engine)
  executionResult?: "EXECUTED" | "SKIPPED" | "REJECTED";
  executionDetails?: string;
};

// ─── Strategy Engine Output ───────────────────────────────────────────

export type StrategyEvaluation = {
  strategy: StrategyName;
  signal: StrategySignal;
  marketState: MarketState;
  timestamp: number;
};

// ─── Risk Check Input ─────────────────────────────────────────────────

export type RiskCheckInput = {
  decision: AiDecision;
  marketState: MarketState;
  currentPosition: {
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    size: number;
  };
  dailyStats: {
    pnl: number;
    trades: number;
    profitCap: number;
    lossLimit: number;
  };
  systemHealth: {
    feedStatus: string;
    databaseStatus: string;
  };
};

// ─── Risk Check Result ────────────────────────────────────────────────

export type RiskCheckResult = {
  approved: boolean;
  reason: string;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
};

// ─── Paper Execution ──────────────────────────────────────────────────

export type PaperOrder = {
  id: string;
  timestamp: number;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price: number;
  simulatedFee: number;
  simulatedSlippage: number;
  fillPrice: number;
  status: "FILLED" | "PENDING" | "CANCELED";
  decisionId: string;
};

export type PaperPosition = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  margin: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  updatedAt: number;
};

export type PaperTrade = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  fees: number;
  slippage: number;
  duration: number; // ms
  strategy: StrategyName;
  decisionId: string;
  openedAt: number;
  closedAt: number;
};

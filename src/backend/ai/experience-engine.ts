/**
 * AI Experience Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Records every paper trade and no-trade decision as a structured experience.
 * Experiences are the foundation for learning and lesson derivation.
 *
 * Architecture:
 *   Trading Orchestrator
 *     → Experience Engine
 *       → Database (trade_experiences)
 *         → Lesson Engine
 *           → Dashboard
 *
 * Key Principle:
 *   AI must learn from evidence, not just from trade count.
 *   Every experience includes full market context for analysis.
 */

import type { AiDecision, PaperTrade, StrategyName } from "./types";
import type { MarketState } from "../runtime/types";
import { getDatabase } from "../database";
import { logger } from "../logger";

// ─── Experience Types ───────────────────────────────────────────────

export type TradeOutcome =
  | "WIN"
  | "LOSS"
  | "BREAKEVEN"
  | "CANCELLED"
  | "INVALID"
  | "NO_TRADE_SKIPPED"
  | "NO_TRADE_RISK_REJECTED";

export type MarketContext = {
  symbol: string;
  price: number;
  trend: string;
  trendStrength: number;
  momentum: string;
  momentumScore: number;
  volatility: number;
  volume24h: number;
  marketRegime: string;
  regimeConfidence: number;
  dataQuality: string;
  feedStatus: string;
};

export type TradeExperience = {
  id: string;
  decisionId: string;
  tradeId: string | null;
  symbol: string;
  timestamp: number;
  marketRegime: string;
  strategy: string;
  direction: "LONG" | "SHORT" | "NO_TRADE";
  confidence: number;
  entryPrice: number | null;
  exitPrice: number | null;
  duration: number | null;
  fees: number | null;
  slippage: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  drawdown: number | null;
  outcome: TradeOutcome;
  marketContext: MarketContext;
  decisionVersion: string;
  modelVersion: string;
};

// ─── Experience Engine ──────────────────────────────────────────────

let experienceCounter = 0;

export function recordTradeExperience(
  decision: AiDecision,
  marketState: MarketState,
  trade: PaperTrade | null,
  riskResult: { approved: boolean; reason: string },
): TradeExperience {
  experienceCounter++;

  // Build market context snapshot
  const marketContext: MarketContext = {
    symbol: marketState.symbol,
    price: marketState.price,
    trend: marketState.trend,
    trendStrength: marketState.trendStrength,
    momentum: marketState.momentum,
    momentumScore: marketState.momentumScore,
    volatility: marketState.volatility,
    volume24h: marketState.volume24h,
    marketRegime: marketState.marketRegime,
    regimeConfidence: marketState.regimeConfidence,
    dataQuality: marketState.dataQuality,
    feedStatus: marketState.feedStatus,
  };

  // Determine outcome
  const outcome = determineOutcome(decision, trade, riskResult);

  // Build experience
  const experience: TradeExperience = {
    id: `EXP-${Date.now()}-${experienceCounter}`,
    decisionId: decision.id,
    tradeId: trade?.id || null,
    symbol: decision.symbol,
    timestamp: Date.now(),
    marketRegime: decision.marketRegime,
    strategy: decision.strategy,
    direction: decision.direction,
    confidence: decision.confidence,
    entryPrice: trade?.entryPrice || null,
    exitPrice: trade?.exitPrice || null,
    duration: trade?.duration || null,
    fees: trade?.fees || null,
    slippage: trade?.slippage || null,
    grossPnl: trade ? trade.pnl + (trade.fees || 0) : null,
    netPnl: trade?.pnl ?? null,
    drawdown: null, // Calculated if needed
    outcome,
    marketContext,
    decisionVersion: decision.decisionVersion,
    modelVersion: decision.modelVersion,
  };

  // Persist to database
  persistExperience(experience);

  // Log
  const outcomeStr = outcome.padEnd(20);
  logger.info(
    "experience-engine",
    `Recorded: ${decision.direction} ${decision.symbol} | ${decision.strategy} | ${outcomeStr} | conf: ${(decision.confidence * 100).toFixed(1)}%`
  );

  return experience;
}

export function recordNoTradeExperience(
  decision: AiDecision,
  marketState: MarketState,
  riskResult: { approved: boolean; reason: string },
): TradeExperience {
  experienceCounter++;

  // Build market context snapshot
  const marketContext: MarketContext = {
    symbol: marketState.symbol,
    price: marketState.price,
    trend: marketState.trend,
    trendStrength: marketState.trendStrength,
    momentum: marketState.momentum,
    momentumScore: marketState.momentumScore,
    volatility: marketState.volatility,
    volume24h: marketState.volume24h,
    marketRegime: marketState.marketRegime,
    regimeConfidence: marketState.regimeConfidence,
    dataQuality: marketState.dataQuality,
    feedStatus: marketState.feedStatus,
  };

  // Determine outcome for no-trade
  const outcome = determineNoTradeOutcome(riskResult);

  // Build experience
  const experience: TradeExperience = {
    id: `EXP-${Date.now()}-${experienceCounter}`,
    decisionId: decision.id,
    tradeId: null,
    symbol: decision.symbol,
    timestamp: Date.now(),
    marketRegime: decision.marketRegime,
    strategy: decision.strategy,
    direction: "NO_TRADE",
    confidence: decision.confidence,
    entryPrice: null,
    exitPrice: null,
    duration: null,
    fees: null,
    slippage: null,
    grossPnl: null,
    netPnl: null,
    drawdown: null,
    outcome,
    marketContext,
    decisionVersion: decision.decisionVersion,
    modelVersion: decision.modelVersion,
  };

  // Persist to database
  persistExperience(experience);

  // Log
  logger.info(
    "experience-engine",
    `Recorded: NO_TRADE ${decision.symbol} | ${decision.strategy} | ${outcome} | conf: ${(decision.confidence * 100).toFixed(1)}%`
  );

  return experience;
}

// ─── Outcome Determination ──────────────────────────────────────────

function determineOutcome(
  decision: AiDecision,
  trade: PaperTrade | null,
  riskResult: { approved: boolean; reason: string },
): TradeOutcome {
  // Invalid decision
  if (!decision.id || !decision.symbol) {
    return "INVALID";
  }

  // Risk rejected
  if (!riskResult.approved) {
    return "CANCELLED";
  }

  // No trade executed
  if (!trade) {
    return "NO_TRADE_SKIPPED";
  }

  // Trade executed - determine win/loss/breakeven
  if (trade.pnl > 0.0001) {
    return "WIN";
  } else if (trade.pnl < -0.0001) {
    return "LOSS";
  } else {
    return "BREAKEVEN";
  }
}

function determineNoTradeOutcome(
  riskResult: { approved: boolean; reason: string },
): TradeOutcome {
  // Risk rejected the no-trade (shouldn't happen, but handle it)
  if (!riskResult.approved) {
    return "NO_TRADE_RISK_REJECTED";
  }

  // No-trade was skipped (decision was NO_TRADE, risk approved)
  return "NO_TRADE_SKIPPED";
}

// ─── Database Persistence ───────────────────────────────────────────

function persistExperience(experience: TradeExperience): void {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO trade_experiences (
        id, decision_id, trade_id, symbol, timestamp, market_regime,
        strategy, direction, confidence, entry_price, exit_price,
        duration, fees, slippage, gross_pnl, net_pnl, drawdown,
        outcome, market_context, decision_version, model_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      experience.id,
      experience.decisionId,
      experience.tradeId,
      experience.symbol,
      experience.timestamp,
      experience.marketRegime,
      experience.strategy,
      experience.direction,
      experience.confidence,
      experience.entryPrice,
      experience.exitPrice,
      experience.duration,
      experience.fees,
      experience.slippage,
      experience.grossPnl,
      experience.netPnl,
      experience.drawdown,
      experience.outcome,
      JSON.stringify(experience.marketContext),
      experience.decisionVersion,
      experience.modelVersion,
    );
  } catch (error) {
    logger.error("experience-engine", `Failed to persist experience: ${error}`);
  }
}

// ─── Query Functions ────────────────────────────────────────────────

export function getRecentExperiences(limit: number = 50): TradeExperience[] {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM trade_experiences ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row['id'] as string,
      decisionId: row['decision_id'] as string,
      tradeId: row['trade_id'] as string | null,
      symbol: row['symbol'] as string,
      timestamp: row['timestamp'] as number,
      marketRegime: row['market_regime'] as string,
      strategy: row['strategy'] as string,
      direction: row['direction'] as "LONG" | "SHORT" | "NO_TRADE",
      confidence: row['confidence'] as number,
      entryPrice: row['entry_price'] as number | null,
      exitPrice: row['exit_price'] as number | null,
      duration: row['duration'] as number | null,
      fees: row['fees'] as number | null,
      slippage: row['slippage'] as number | null,
      grossPnl: row['gross_pnl'] as number | null,
      netPnl: row['net_pnl'] as number | null,
      drawdown: row['drawdown'] as number | null,
      outcome: row['outcome'] as TradeOutcome,
      marketContext: JSON.parse(row['market_context'] as string || "{}"),
      decisionVersion: row['decision_version'] as string,
      modelVersion: row['model_version'] as string,
    }));
  } catch (error) {
    logger.error("experience-engine", `Failed to get experiences: ${error}`);
    return [];
  }
}

export function getExperiencesByOutcome(outcome: TradeOutcome): TradeExperience[] {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM trade_experiences WHERE outcome = ? ORDER BY timestamp DESC
    `).all(outcome) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row['id'] as string,
      decisionId: row['decision_id'] as string,
      tradeId: row['trade_id'] as string | null,
      symbol: row['symbol'] as string,
      timestamp: row['timestamp'] as number,
      marketRegime: row['market_regime'] as string,
      strategy: row['strategy'] as string,
      direction: row['direction'] as "LONG" | "SHORT" | "NO_TRADE",
      confidence: row['confidence'] as number,
      entryPrice: row['entry_price'] as number | null,
      exitPrice: row['exit_price'] as number | null,
      duration: row['duration'] as number | null,
      fees: row['fees'] as number | null,
      slippage: row['slippage'] as number | null,
      grossPnl: row['gross_pnl'] as number | null,
      netPnl: row['net_pnl'] as number | null,
      drawdown: row['drawdown'] as number | null,
      outcome: row['outcome'] as TradeOutcome,
      marketContext: JSON.parse(row['market_context'] as string || "{}"),
      decisionVersion: row['decision_version'] as string,
      modelVersion: row['model_version'] as string,
    }));
  } catch (error) {
    logger.error("experience-engine", `Failed to get experiences by outcome: ${error}`);
    return [];
  }
}

export function getExperienceStats(): {
  totalExperiences: number;
  totalTrades: number;
  totalNoTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  averageConfidence: number;
  byStrategy: Record<string, { count: number; winRate: number; pnl: number }>;
  byRegime: Record<string, { count: number; winRate: number; pnl: number }>;
} {
  try {
    const db = getDatabase();
    const total = db.prepare("SELECT COUNT(*) as count FROM trade_experiences").get() as { count: number };
    const trades = db.prepare("SELECT COUNT(*) as count FROM trade_experiences WHERE direction != 'NO_TRADE'").get() as { count: number };
    const noTrades = db.prepare("SELECT COUNT(*) as count FROM trade_experiences WHERE direction = 'NO_TRADE'").get() as { count: number };

    const wins = db.prepare("SELECT COUNT(*) as count FROM trade_experiences WHERE outcome = 'WIN'").get() as { count: number };
    const totalPnlResult = db.prepare("SELECT SUM(net_pnl) as total FROM trade_experiences WHERE net_pnl IS NOT NULL").get() as { total: number };
    const avgConfidence = db.prepare("SELECT AVG(confidence) as avg FROM trade_experiences").get() as { avg: number };

    // By strategy
    const strategyRows = db.prepare(`
      SELECT strategy, COUNT(*) as count,
             SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
             SUM(COALESCE(net_pnl, 0)) as pnl
      FROM trade_experiences
      GROUP BY strategy
    `).all() as Array<{ strategy: string; count: number; wins: number; pnl: number }>;

    const byStrategy: Record<string, { count: number; winRate: number; pnl: number }> = {};
    for (const row of strategyRows) {
      byStrategy[row.strategy] = {
        count: row.count,
        winRate: row.count > 0 ? (row.wins / row.count) * 100 : 0,
        pnl: row.pnl,
      };
    }

    // By regime
    const regimeRows = db.prepare(`
      SELECT market_regime, COUNT(*) as count,
             SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
             SUM(COALESCE(net_pnl, 0)) as pnl
      FROM trade_experiences
      GROUP BY market_regime
    `).all() as Array<{ market_regime: string; count: number; wins: number; pnl: number }>;

    const byRegime: Record<string, { count: number; winRate: number; pnl: number }> = {};
    for (const row of regimeRows) {
      byRegime[row.market_regime] = {
        count: row.count,
        winRate: row.count > 0 ? (row.wins / row.count) * 100 : 0,
        pnl: row.pnl,
      };
    }

    return {
      totalExperiences: total.count,
      totalTrades: trades.count,
      totalNoTrades: noTrades.count,
      winRate: trades.count > 0 ? (wins.count / trades.count) * 100 : 0,
      profitFactor: 0, // Calculate if needed
      totalPnl: totalPnlResult.total || 0,
      averageConfidence: avgConfidence.avg || 0,
      byStrategy,
      byRegime,
    };
  } catch (error) {
    logger.error("experience-engine", `Failed to get stats: ${error}`);
    return {
      totalExperiences: 0,
      totalTrades: 0,
      totalNoTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnl: 0,
      averageConfidence: 0,
      byStrategy: {},
      byRegime: {},
    };
  }
}

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
 *
 * Database: Async via PostgreSQL adapter (dbQuery/dbExecute).
 */

import type { AiDecision, PaperTrade, StrategyName } from "./types";
import type { MarketState } from "../runtime/types";
import { dbQuery, dbQueryOne, dbExecute } from "../database";
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

export async function recordTradeExperience(
  decision: AiDecision,
  marketState: MarketState,
  trade: PaperTrade | null,
  riskResult: { approved: boolean; reason: string },
): Promise<TradeExperience> {
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
    drawdown: null,
    outcome,
    marketContext,
    decisionVersion: decision.decisionVersion,
    modelVersion: decision.modelVersion,
  };

  // Persist to database
  await persistExperience(experience);

  // Log
  const outcomeStr = outcome.padEnd(20);
  logger.info(
    "experience-engine",
    `Recorded: ${decision.direction} ${decision.symbol} | ${decision.strategy} | ${outcomeStr} | conf: ${(decision.confidence * 100).toFixed(1)}%`
  );

  return experience;
}

export async function recordNoTradeExperience(
  decision: AiDecision,
  marketState: MarketState,
  riskResult: { approved: boolean; reason: string },
): Promise<TradeExperience> {
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
  await persistExperience(experience);

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
  if (!decision.id || !decision.symbol) {
    return "INVALID";
  }

  if (!riskResult.approved) {
    return "CANCELLED";
  }

  if (!trade) {
    return "NO_TRADE_SKIPPED";
  }

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
  if (!riskResult.approved) {
    return "NO_TRADE_RISK_REJECTED";
  }
  return "NO_TRADE_SKIPPED";
}

// ─── Database Persistence ───────────────────────────────────────────

async function persistExperience(experience: TradeExperience): Promise<void> {
  try {
    await dbExecute(
      `INSERT INTO trade_experiences (
        id, decision_id, trade_id, symbol, timestamp, market_regime,
        strategy, direction, confidence, entry_price, exit_price,
        duration, fees, slippage, gross_pnl, net_pnl, drawdown,
        outcome, market_context, decision_version, model_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
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
      ],
    );
  } catch (error) {
    logger.error("experience-engine", `Failed to persist experience: ${error}`);
  }
}

// ─── Query Functions ────────────────────────────────────────────────

export async function getRecentExperiences(limit: number = 50): Promise<TradeExperience[]> {
  try {
    const rows = await dbQuery(
      `SELECT * FROM trade_experiences ORDER BY timestamp DESC LIMIT $1`,
      [limit],
    );

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

export async function getExperiencesByOutcome(outcome: TradeOutcome): Promise<TradeExperience[]> {
  try {
    const rows = await dbQuery(
      `SELECT * FROM trade_experiences WHERE outcome = $1 ORDER BY timestamp DESC`,
      [outcome],
    );

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

export async function getExperienceStats(): Promise<{
  totalExperiences: number;
  totalTrades: number;
  totalNoTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  averageConfidence: number;
  byStrategy: Record<string, { count: number; winRate: number; pnl: number }>;
  byRegime: Record<string, { count: number; winRate: number; pnl: number }>;
}> {
  try {
    const total = await dbQueryOne("SELECT COUNT(*) as count FROM trade_experiences");
    const trades = await dbQueryOne("SELECT COUNT(*) as count FROM trade_experiences WHERE direction != 'NO_TRADE'");
    const noTrades = await dbQueryOne("SELECT COUNT(*) as count FROM trade_experiences WHERE direction = 'NO_TRADE'");

    const wins = await dbQueryOne("SELECT COUNT(*) as count FROM trade_experiences WHERE outcome = 'WIN'");
    const totalPnlResult = await dbQueryOne("SELECT SUM(net_pnl) as total FROM trade_experiences WHERE net_pnl IS NOT NULL");
    const avgConfidence = await dbQueryOne("SELECT AVG(confidence) as avg FROM trade_experiences");

    // By strategy
    const strategyRows = await dbQuery(`
      SELECT strategy, COUNT(*) as count,
             SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
             SUM(COALESCE(net_pnl, 0)) as pnl
      FROM trade_experiences
      GROUP BY strategy
    `);

    const byStrategy: Record<string, { count: number; winRate: number; pnl: number }> = {};
    for (const row of strategyRows) {
      byStrategy[row['strategy'] as string] = {
        count: row['count'] as number,
        winRate: (row['count'] as number) > 0 ? ((row['wins'] as number) / (row['count'] as number)) * 100 : 0,
        pnl: row['pnl'] as number,
      };
    }

    // By regime
    const regimeRows = await dbQuery(`
      SELECT market_regime, COUNT(*) as count,
             SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
             SUM(COALESCE(net_pnl, 0)) as pnl
      FROM trade_experiences
      GROUP BY market_regime
    `);

    const byRegime: Record<string, { count: number; winRate: number; pnl: number }> = {};
    for (const row of regimeRows) {
      byRegime[row['market_regime'] as string] = {
        count: row['count'] as number,
        winRate: (row['count'] as number) > 0 ? ((row['wins'] as number) / (row['count'] as number)) * 100 : 0,
        pnl: row['pnl'] as number,
      };
    }

    return {
      totalExperiences: (total?.['count'] as number) || 0,
      totalTrades: (trades?.['count'] as number) || 0,
      totalNoTrades: (noTrades?.['count'] as number) || 0,
      winRate: ((trades?.['count'] as number) || 0) > 0 ? (((wins?.['count'] as number) || 0) / ((trades?.['count'] as number) || 0)) * 100 : 0,
      profitFactor: 0,
      totalPnl: (totalPnlResult?.['total'] as number) || 0,
      averageConfidence: (avgConfidence?.['avg'] as number) || 0,
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

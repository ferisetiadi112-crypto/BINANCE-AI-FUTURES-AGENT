/**
 * Trading Prompt Builder — BINANCE AI FUTURES AGENT v0.1
 *
 * Converts real-time MarketState into a concise, risk-averse prompt
 * for LLM providers. Emphasizes the $5 capital constraint and
 * ±$0.50 daily guardrail.
 *
 * Design principles:
 * - Concise: minimize token usage across providers
 * - Structured: request JSON output format
 * - Safe: hard-code risk constraints in every prompt
 * - Clear: explicit output schema to reduce invalid responses
 */

import type { MarketState } from "../../runtime/types";

const CAPITAL = "$5.00";
const DAILY_GUARDRAIL = "±$0.50";
const SYSTEM_CONTEXT = `You are a conservative crypto futures trading AI for a $5 paper trading account.

CRITICAL RULES:
1. Capital is only ${CAPITAL}. You CANNOT risk more than 20% ($1.00) per trade.
2. Daily guardrail: ${DAILY_GUARDRAIL}. If daily PnL hits either limit, all trading stops.
3. When uncertain, ALWAYS choose NO_TRADE. Capital preservation > profit.
4. Only trade when signal confidence is genuinely high (>0.6) and risk/reward is favorable.
5. This is a paper trading simulation — no real money at risk.`;

const OUTPUT_SCHEMA = `Respond with ONLY valid JSON matching this schema:
{
  "direction": "LONG" | "SHORT" | "NO_TRADE",
  "confidence": number (0.0 to 1.0),
  "strategy": "TREND_FOLLOWING" | "MOMENTUM" | "BREAKOUT" | "PULLBACK" | "MEAN_REVERSION",
  "reasoning": "Concise 1-2 sentence explanation of your decision"
}`;

/**
 * Format a numeric value with fixed precision for the prompt.
 */
function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/**
 * Build a concise trading prompt from real-time market state.
 *
 * Returns a system + user prompt pair suitable for chat completion APIs.
 * The system prompt sets the persona and constraints.
 * The user prompt provides market data and requests JSON output.
 */
export function buildTradingPrompt(
  market: MarketState,
): { system: string; user: string } {
  const user = `MARKET DATA — ${market.symbol} at ${new Date(market.timestamp).toISOString()}

Price: $${fmt(market.price, 2)} (24h change: ${fmt(market.priceChangePercent24h, 2)}%)

TREND: ${market.trend} (strength: ${fmt(market.trendStrength, 1)}/100)
MOMENTUM: ${market.momentum} (score: ${fmt(market.momentumScore, 1)}/100)
VOLATILITY: ATR ${fmt(market.volatility, 4)} (${fmt(market.volatilityPercent, 2)}%)
VOLUME: ${fmt(market.volume24h, 0)} (change vs avg: ${fmt(market.volumeChange, 1)}%)
STRUCTURE: ${market.marketStructure}
REGIME: ${market.marketRegime} (confidence: ${fmt(market.regimeConfidence, 1)}%)
LIQUIDITY: ${fmt(market.liquidity, 1)}/100
DATA QUALITY: ${market.dataQuality} | FEED: ${market.feedStatus}

Analyze the data and provide your trading recommendation.
${OUTPUT_SCHEMA}`;

  return { system: SYSTEM_CONTEXT, user };
}

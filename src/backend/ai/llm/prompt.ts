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
const SYSTEM_CONTEXT = `You are a conservative crypto futures trading AI for a $5 paper trading account on Binance Futures Testnet.

CRITICAL RULES:
1. Capital is only ${CAPITAL}. You CANNOT risk more than 20% ($1.00) per trade.
2. Daily guardrail: ${DAILY_GUARDRAIL}. If daily PnL hits either limit, all trading stops.
3. When uncertain, ALWAYS choose NO_TRADE. Capital preservation > profit.
4. Only trade when signal confidence is genuinely high (>0.6) and risk/reward is favorable.
5. This is Binance Futures Testnet — real testnet orders, not simulated.
6. Exchange state below shows your ACTUAL account. Use it for context but the Risk Engine has final authority.`;

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

export type ExchangeContextForPrompt = {
  source: string;
  available: boolean;
  connection: { status: string; isStale: boolean };
  account: { balance: number; availableBalance: number; margin: number; unrealizedPnl: number } | null;
  positions: Array<{ symbol: string; side: string; size: number; entryPrice: number; markPrice: number; leverage: number; margin: number; unrealizedPnl: number }>;
  positionCount: number;
  hasOpenPosition: boolean;
  dataFreshness: string;
};

/** P7D-5.3: Market context type for LLM prompt */
export type MarketContextForPrompt = {
  source: string;
  available: boolean;
  connection: { status: string; lastUpdateAt: string | null; subscribedSymbols: number };
  dataFreshness: string;
  symbols: Array<{ symbol: string; lastPrice: number; bid: number; ask: number; spread: number; volume24h: number; priceChange24h: number; priceChangePercent24h: number; high24h: number; low24h: number; updatedAt: string }>;
  symbolCount: number;
  primarySymbol: string | null;
};

/**
 * Build a concise trading prompt from real-time market state.
 *
 * Returns a system + user prompt pair suitable for chat completion APIs.
 * The system prompt sets the persona and constraints.
 * The user prompt provides market data and requests JSON output.
 *
 * @param market - Market state from runtime intelligence
 * @param exchangeContext - Optional exchange context from unified state (P7D-5.2)
 * @param marketContext - Optional realtime market context from Binance Testnet (P7D-5.3)
 */
export function buildTradingPrompt(
  market: MarketState,
  exchangeContext?: ExchangeContextForPrompt | null,
  marketContext?: MarketContextForPrompt | null,
): { system: string; user: string } {
  let user = `MARKET DATA — ${market.symbol} at ${new Date(market.timestamp).toISOString()}

Price: $${fmt(market.price, 2)} (24h change: ${fmt(market.priceChangePercent24h, 2)}%)

TREND: ${market.trend} (strength: ${fmt(market.trendStrength, 1)}/100)
MOMENTUM: ${market.momentum} (score: ${fmt(market.momentumScore, 1)}/100)
VOLATILITY: ATR ${fmt(market.volatility, 4)} (${fmt(market.volatilityPercent, 2)}%)
VOLUME: ${fmt(market.volume24h, 0)} (change vs avg: ${fmt(market.volumeChange, 1)}%)
STRUCTURE: ${market.marketStructure}
REGIME: ${market.marketRegime} (confidence: ${fmt(market.regimeConfidence, 1)}%)
LIQUIDITY: ${fmt(market.liquidity, 1)}/100
DATA QUALITY: ${market.dataQuality} | FEED: ${market.feedStatus}`;

  // P7D-5.2: Append exchange context if available
  if (exchangeContext && exchangeContext.available) {
    user += `

${formatExchangeContextSection(exchangeContext)}`;
  } else if (exchangeContext && !exchangeContext.available) {
    user += `

EXCHANGE: ${exchangeContext.connection.status} — Exchange data unavailable. Focus on market analysis only.`;
  }

  // P7D-5.3: Append realtime market context if available
  if (marketContext && marketContext.available) {
    user += `

${formatMarketContextSection(marketContext)}`;
  } else if (marketContext && !marketContext.available) {
    user += `

MARKET DATA: ${marketContext.connection.status} — Realtime market data unavailable.`;
  }

  user += `

Analyze the data and provide your trading recommendation.
${OUTPUT_SCHEMA}`;

  return { system: SYSTEM_CONTEXT, user };
}

/**
 * Format exchange context as a structured section for the prompt.
 */
function formatExchangeContextSection(ctx: ExchangeContextForPrompt): string {
  const lines: string[] = [];

  lines.push(`EXCHANGE STATE — ${ctx.source}`);
  lines.push(`Connection: ${ctx.connection.status} | Data: ${ctx.dataFreshness}`);

  if (ctx.account) {
    lines.push(`Balance: $${ctx.account.balance.toFixed(2)} | Available: $${ctx.account.availableBalance.toFixed(2)} | Margin: $${ctx.account.margin.toFixed(2)} | PnL: $${ctx.account.unrealizedPnl.toFixed(4)}`);
  }

  if (ctx.hasOpenPosition) {
    lines.push(`Positions (${ctx.positionCount}):`);
    for (const pos of ctx.positions) {
      lines.push(`  ${pos.side} ${pos.symbol} | Size: ${pos.size} | Entry: $${pos.entryPrice.toFixed(2)} | Mark: $${pos.markPrice.toFixed(2)} | ${pos.leverage}x | PnL: $${pos.unrealizedPnl.toFixed(4)}`);
    }
  } else {
    lines.push(`Positions: None`);
  }

  return lines.join("\n");
}

/**
 * P7D-5.3: Format realtime market context as a structured section for the prompt.
 */
function formatMarketContextSection(ctx: MarketContextForPrompt): string {
  const lines: string[] = [];

  lines.push(`REALTIME MARKET — ${ctx.source}`);
  lines.push(`Connection: ${ctx.connection.status} | Data: ${ctx.dataFreshness}`);

  if (ctx.symbols.length > 0) {
    lines.push(`Live Prices (${ctx.symbolCount} markets):`);
    for (const sym of ctx.symbols) {
      const change = sym.priceChangePercent24h >= 0
        ? `+${sym.priceChangePercent24h.toFixed(2)}%`
        : `${sym.priceChangePercent24h.toFixed(2)}%`;
      lines.push(
        `  ${sym.symbol}: $${sym.lastPrice.toFixed(2)} (${change}) | Bid: $${sym.bid.toFixed(2)} | Ask: $${sym.ask.toFixed(2)} | Spread: $${sym.spread.toFixed(4)}`,
      );
    }
  }

  if (ctx.dataFreshness === "STALE") {
    lines.push(`⚠ WARNING: Market data is stale (>30s).`);
  }

  return lines.join("\n");
}

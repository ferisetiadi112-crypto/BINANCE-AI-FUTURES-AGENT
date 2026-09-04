/**
 * AI Market Context — P7D-5.3
 *
 * READ-ONLY bridge between MarketDataState and the AI decision engine.
 * Provides structured market data for AI analysis without any write capability.
 *
 * Architecture:
 *   MarketDataState (P7D-5.3)
 *     → getMarketSnapshot()
 *       → buildMarketContext()
 *         → AI Decision Engine (READ-ONLY)
 *
 * SAFETY:
 * - This module is PURELY READ-ONLY
 * - It never places orders, cancels orders, or modifies exchange/market state
 * - It never imports TestnetExecutor or BinanceTestnetClient
 * - AI signal/analysis never modifies market state
 * - Only sanitized, structured data is exposed to the AI
 *
 * DATA SOURCES:
 * - Market prices, volume, freshness → from getMarketSnapshot()
 * - No additional REST calls to Binance
 * - No additional WebSocket connections
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

/** Sanitized per-symbol market tick for AI context */
export type AiMarketSymbolTick = {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  updatedAt: string; // ISO string
};

/** Market connection info for AI context */
export type AiMarketConnection = {
  status: string;
  lastUpdateAt: string | null;
  subscribedSymbols: number;
};

/** Complete market context for AI analysis */
export type AiMarketContext = {
  source: "BINANCE_FUTURES_TESTNET_MARKET";
  available: boolean;
  connection: AiMarketConnection;
  dataFreshness: "FRESH" | "STALE" | "UNAVAILABLE";
  symbols: AiMarketSymbolTick[];
  symbolCount: number;
  primarySymbol: string | null; // first subscribed symbol for convenience
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Build an AI market context from the market data state.
 *
 * This is a PURE READ operation — it calls getMarketSnapshot()
 * which returns cached data. No network requests are made.
 *
 * @returns AiMarketContext — structured, sanitized market data for AI
 */
export async function buildMarketContext(): Promise<AiMarketContext> {
  // Dynamic import to avoid circular dependency at module load time
  const { getMarketSnapshot } = await import("../exchange/market-data-state");
  const snapshot = getMarketSnapshot();

  // Sanitize connection status
  const connection: AiMarketConnection = {
    status: snapshot.connectionStatus,
    lastUpdateAt: snapshot.lastUpdateAt > 0
      ? new Date(snapshot.lastUpdateAt).toISOString()
      : null,
    subscribedSymbols: snapshot.subscribedSymbols.length,
  };

  // Sanitize per-symbol ticks
  const symbols: AiMarketSymbolTick[] = [];
  for (const [sym, tick] of Object.entries(snapshot.symbols)) {
    if (!Number.isFinite(tick.lastPrice) || tick.lastPrice <= 0) continue;

    symbols.push({
      symbol: sym,
      lastPrice: sanitizeNumber(tick.lastPrice),
      bid: sanitizeNumber(tick.bid),
      ask: sanitizeNumber(tick.ask),
      spread: sanitizeNumber(tick.spread),
      volume24h: sanitizeNumber(tick.volume24h),
      priceChange24h: sanitizeNumber(tick.priceChange24h),
      priceChangePercent24h: sanitizeNumber(tick.priceChangePercent24h),
      high24h: sanitizeNumber(tick.high24h),
      low24h: sanitizeNumber(tick.low24h),
      updatedAt: new Date(tick.updatedAt).toISOString(),
    });
  }

  const context: AiMarketContext = {
    source: "BINANCE_FUTURES_TESTNET_MARKET",
    available: snapshot.connectionStatus !== "OFFLINE" &&
      snapshot.connectionStatus !== "ERROR" &&
      symbols.length > 0 &&
      snapshot.dataFreshness !== "UNAVAILABLE",
    connection,
    dataFreshness: snapshot.dataFreshness,
    symbols,
    symbolCount: symbols.length,
    primarySymbol: snapshot.subscribedSymbols[0] ?? null,
  };

  logger.debug(
    "ai-market-context",
    `Built context: available=${context.available}, symbols=${context.symbolCount}, freshness=${context.dataFreshness}`,
  );

  return context;
}

/**
 * Format market context as a human-readable string for LLM prompts.
 *
 * @param context - The AI market context
 * @returns Formatted string for prompt inclusion
 */
export function formatMarketContextForPrompt(context: AiMarketContext): string {
  if (!context.available) {
    return `MARKET DATA: ${context.connection.status} — Market data unavailable. Use market analysis based on general knowledge only.`;
  }

  const lines: string[] = [];

  lines.push(`MARKET DATA — ${context.source}`);
  lines.push(`Connection: ${context.connection.status} | Data: ${context.dataFreshness}`);
  if (context.connection.lastUpdateAt) {
    lines.push(`Last update: ${context.connection.lastUpdateAt}`);
  }

  if (context.symbols.length > 0) {
    lines.push(`\nSUBSCRIBED MARKETS (${context.symbolCount}):`);
    for (const sym of context.symbols) {
      const change = sym.priceChangePercent24h >= 0
        ? `+${sym.priceChangePercent24h.toFixed(2)}%`
        : `${sym.priceChangePercent24h.toFixed(2)}%`;

      lines.push(
        `  ${sym.symbol}: $${sym.lastPrice.toFixed(2)} (${change}) | Bid: $${sym.bid.toFixed(2)} | Ask: $${sym.ask.toFixed(2)} | Spread: $${sym.spread.toFixed(4)} | Vol: ${formatVolume(sym.volume24h)}`,
      );
    }
  } else {
    lines.push(`\nNo market data available`);
  }

  if (context.dataFreshness === "STALE") {
    lines.push(`\n⚠ WARNING: Market data is stale (>30s). Use with caution.`);
  }

  return lines.join("\n");
}

/**
 * Build a combined AI context with both exchange (P7D-5.2) and market (P7D-5.3) data.
 * This is the unified context passed to the LLM.
 */
export async function buildCombinedAiContext(): Promise<{
  exchange: import("./exchange-context").AiExchangeContext | null;
  market: AiMarketContext;
}> {
  let exchange: import("./exchange-context").AiExchangeContext | null = null;
  let market: AiMarketContext;

  try {
    const { buildExchangeContext } = await import("./exchange-context");
    exchange = await buildExchangeContext();
  } catch (err) {
    logger.warn("ai-context", `Failed to build exchange context: ${err}`);
  }

  try {
    market = await buildMarketContext();
  } catch (err) {
    logger.error("ai-context", `Failed to build market context: ${err}`);
    // Provide a minimal unavailable context
    market = {
      source: "BINANCE_FUTURES_TESTNET_MARKET",
      available: false,
      connection: { status: "ERROR", lastUpdateAt: null, subscribedSymbols: 0 },
      dataFreshness: "UNAVAILABLE",
      symbols: [],
      symbolCount: 0,
      primarySymbol: null,
    };
  }

  return { exchange, market };
}

// ─── Helpers ────────────────────────────────────────────────────────

function sanitizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(0);
}

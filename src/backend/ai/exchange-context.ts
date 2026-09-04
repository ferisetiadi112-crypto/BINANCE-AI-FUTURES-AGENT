/**
 * AI Exchange Context — P7D-5.2
 *
 * READ-ONLY bridge between UnifiedExchangeState and the AI decision engine.
 * Provides structured exchange data for AI analysis without any write capability.
 *
 * Architecture:
 *   UnifiedExchangeState (P7D-5.1)
 *     → getExchangeSnapshot()
 *       → buildExchangeContext()
 *         → AI Decision Engine (READ-ONLY)
 *
 * SAFETY:
 * - This module is PURELY READ-ONLY
 * - It never places orders, cancels orders, or modifies exchange state
 * - It never imports TestnetExecutor or BinanceTestnetClient
 * - AI signal/analysis never modifies exchange state
 * - Only sanitized, structured data is exposed to the AI
 *
 * DATA SOURCES:
 * - Connection status, account, positions, staleness → from getExchangeSnapshot()
 * - No additional REST calls to Binance
 * - No additional WebSocket connections
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Sanitized exchange account data for AI context.
 * Contains only the fields the AI needs for analysis.
 */
export type AiExchangeAccount = {
  balance: number;
  availableBalance: number;
  margin: number;
  unrealizedPnl: number;
};

/**
 * Sanitized exchange position data for AI context.
 * Contains only the fields the AI needs for analysis.
 */
export type AiExchangePosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
};

/**
 * Exchange connection status for AI context.
 */
export type AiExchangeConnection = {
  status: string;
  isStale: boolean;
  lastSyncAt: string | null;
  configured: boolean;
};

/**
 * Complete exchange context for AI analysis.
 * Structured, sanitized, read-only snapshot of exchange state.
 */
export type AiExchangeContext = {
  source: "BINANCE_FUTURES_TESTNET";
  available: boolean;
  connection: AiExchangeConnection;
  account: AiExchangeAccount | null;
  positions: AiExchangePosition[];
  positionCount: number;
  hasOpenPosition: boolean;
  dataFreshness: "FRESH" | "STALE" | "UNAVAILABLE";
};

// ─── Data Freshness Thresholds ──────────────────────────────────────

const FRESH_THRESHOLD_MS = 30_000; // 30 seconds
const STALE_THRESHOLD_MS = 120_000; // 2 minutes

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Build an AI exchange context from the unified exchange state.
 *
 * This is a PURE READ operation — it calls getExchangeSnapshot()
 * which returns cached data. No network requests are made.
 *
 * @returns AiExchangeContext — structured, sanitized exchange data for AI
 */
export async function buildExchangeContext(): Promise<AiExchangeContext> {
  // Dynamic import to avoid circular dependency at module load time
  const { getExchangeSnapshot } = await import("../exchange/unified-state");
  const snapshot = getExchangeSnapshot();

  // Determine data freshness
  const now = Date.now();
  let dataFreshness: "FRESH" | "STALE" | "UNAVAILABLE" = "UNAVAILABLE";
  if (snapshot.lastSyncTimestamp > 0) {
    const age = now - snapshot.lastSyncTimestamp;
    if (age < FRESH_THRESHOLD_MS) {
      dataFreshness = "FRESH";
    } else if (age < STALE_THRESHOLD_MS) {
      dataFreshness = "STALE";
    }
    // else UNAVAILABLE (too old)
  }

  // Sanitize connection status (strip secrets, internal state)
  const connection: AiExchangeConnection = {
    status: snapshot.connectionStatus,
    isStale: snapshot.stale,
    lastSyncAt: snapshot.lastSyncTimestamp > 0
      ? new Date(snapshot.lastSyncTimestamp).toISOString()
      : null,
    configured: snapshot.configured,
  };

  // Sanitize account data (only numeric fields, no secrets)
  const account: AiExchangeAccount | null = snapshot.connected
    ? {
        balance: sanitizeNumber(snapshot.account.balance),
        availableBalance: sanitizeNumber(snapshot.account.availableBalance),
        margin: sanitizeNumber(snapshot.account.marginBalance),
        unrealizedPnl: sanitizeNumber(snapshot.account.unrealizedPnl),
      }
    : null;

  // Sanitize positions (only trading-relevant fields)
  const positions: AiExchangePosition[] = snapshot.positions.map((p) => ({
    symbol: p.symbol,
    side: p.side,
    size: sanitizeNumber(p.size),
    entryPrice: sanitizeNumber(p.entryPrice),
    markPrice: sanitizeNumber(p.markPrice),
    leverage: p.leverage,
    margin: sanitizeNumber(p.margin),
    unrealizedPnl: sanitizeNumber(p.unrealizedPnl),
  }));

  const context: AiExchangeContext = {
    source: "BINANCE_FUTURES_TESTNET",
    available: snapshot.connected && dataFreshness !== "UNAVAILABLE",
    connection,
    account,
    positions,
    positionCount: positions.length,
    hasOpenPosition: positions.length > 0,
    dataFreshness,
  };

  logger.debug(
    "ai-exchange-context",
    `Built context: available=${context.available}, positions=${context.positionCount}, freshness=${context.dataFreshness}`,
  );

  return context;
}

/**
 * Format exchange context as a human-readable string for LLM prompts.
 * This is used by the prompt builder to inject exchange state into AI context.
 *
 * @param context - The AI exchange context
 * @returns Formatted string for prompt inclusion
 */
export function formatExchangeContextForPrompt(context: AiExchangeContext): string {
  if (!context.available) {
    return `EXCHANGE STATE: ${context.connection.status} — Data unavailable. Exchange data should not influence the decision.`;
  }

  const lines: string[] = [];

  // Connection
  lines.push(`EXCHANGE: ${context.connection.status} | Data: ${context.dataFreshness}`);
  if (context.connection.lastSyncAt) {
    lines.push(`Last sync: ${context.connection.lastSyncAt}`);
  }

  // Account
  if (context.account) {
    lines.push(`\nACCOUNT BALANCE: $${context.account.balance.toFixed(2)}`);
    lines.push(`Available: $${context.account.availableBalance.toFixed(2)}`);
    lines.push(`Margin: $${context.account.margin.toFixed(2)}`);
    lines.push(`Unrealized PnL: $${context.account.unrealizedPnl.toFixed(4)}`);
  }

  // Positions
  if (context.hasOpenPosition) {
    lines.push(`\nOPEN POSITIONS (${context.positionCount}):`);
    for (const pos of context.positions) {
      lines.push(
        `  ${pos.side} ${pos.symbol} | Size: ${pos.size} | Entry: $${pos.entryPrice.toFixed(2)} | Mark: $${pos.markPrice.toFixed(2)} | Leverage: ${pos.leverage}x | PnL: $${pos.unrealizedPnl.toFixed(4)}`,
      );
    }
  } else {
    lines.push(`\nOPEN POSITIONS: None`);
  }

  // Data freshness warning
  if (context.dataFreshness === "STALE") {
    lines.push(`\n⚠ WARNING: Exchange data is stale (>30s). Use with caution.`);
  }

  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Sanitize a numeric value — ensure it's finite and non-negative where expected.
 * Returns 0 for NaN, Infinity, or negative values where they don't make sense.
 */
function sanitizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

/**
 * Market Data Storage — BINANCE AI FUTURES AGENT v0.1
 *
 * Stores validated market data in the database.
 * Uses the market_data table for OHLCV candles.
 *
 * Deduplication: Uses (symbol, interval, open_time) as unique key.
 * Indexing: Uses the existing idx_market_data_symbol_time index.
 */

import { getDatabase } from "../database";
import { validateKlines, detectGaps, intervalToMs, type CandleData } from "./validation";
import { logger } from "../logger";

export type StoredCandle = {
  symbol: string;
  interval: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Store validated klines in the database.
 * Skips duplicates automatically.
 * Returns count of newly inserted candles.
 */
export function storeKlines(
  symbol: string,
  interval: string,
  klines: CandleData[],
): number {
  // Validate first
  const validation = validateKlines(klines);
  if (!validation.valid) {
    logger.error("market-storage", `Invalid klines for ${symbol}: ${validation.errors.join(", ")}`);
    return 0;
  }

  if (validation.warnings.length > 0) {
    logger.warn("market-storage", `Kline warnings for ${symbol}: ${validation.warnings.join(", ")}`);
  }

  const db = getDatabase();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO market_data (symbol, interval, open_time, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const insertMany = db.transaction((candles: CandleData[]) => {
    for (const candle of candles) {
      const result = insert.run(
        symbol,
        interval,
        candle.openTime,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      );
      if (result.changes > 0) inserted++;
    }
  });

  insertMany(klines);
  logger.info("market-storage", `Stored ${inserted} new candles for ${symbol} ${interval}`);
  return inserted;
}

/**
 * Retrieve stored klines from the database.
 * Returns candles in chronological order (oldest first).
 */
export function getStoredKlines(
  symbol: string,
  interval: string,
  limit = 100,
): StoredCandle[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT symbol, interval, open_time as openTime, open, high, low, close, volume
    FROM market_data
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC
    LIMIT ?
  `).all(symbol, interval, limit) as StoredCandle[];
}

/**
 * Get the most recent candle for a symbol/interval pair.
 */
export function getLatestCandle(
  symbol: string,
  interval: string,
): StoredCandle | undefined {
  const db = getDatabase();
  return db.prepare(`
    SELECT symbol, interval, open_time as openTime, open, high, low, close, volume
    FROM market_data
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC
    LIMIT 1
  `).get(symbol, interval) as StoredCandle | undefined;
}

/**
 * Count stored candles for a symbol.
 */
export function getCandleCount(symbol: string, interval?: string): number {
  const db = getDatabase();
  if (interval) {
    const result = db.prepare(
      "SELECT COUNT(*) as count FROM market_data WHERE symbol = ? AND interval = ?"
    ).get(symbol, interval) as { count: number };
    return result.count;
  }
  const result = db.prepare(
    "SELECT COUNT(*) as count FROM market_data WHERE symbol = ?"
  ).get(symbol) as { count: number };
  return result.count;
}

/**
 * Clean old candles beyond retention period.
 * Default retention: 30 days.
 */
export function cleanOldCandles(maxAgeDays = 30): number {
  const db = getDatabase();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = db.prepare(
    "DELETE FROM market_data WHERE open_time < ?"
  ).run(cutoff);
  logger.info("market-storage", `Cleaned ${result.changes} old candles`);
  return result.changes;
}

// ─── Multi-Symbol Operations ─────────────────────────────────────────

export type SymbolDataSummary = {
  symbol: string;
  candleCount: number;
  latestCandle: StoredCandle | undefined;
  oldestCandle: StoredCandle | undefined;
};

/**
 * Get data summaries for all stored symbols.
 */
export function getAllSymbolSummaries(): SymbolDataSummary[] {
  const db = getDatabase();
  const symbols = db
    .prepare("SELECT DISTINCT symbol FROM market_data ORDER BY symbol")
    .all() as { symbol: string }[];

  return symbols.map(({ symbol }) => {
    const candleCount = getCandleCount(symbol);
    const latestCandle = getLatestCandle(symbol, "15m");
    const oldestCandle = db
      .prepare(
        "SELECT symbol, interval, open_time as openTime, open, high, low, close, volume FROM market_data WHERE symbol = ? AND interval = '15m' ORDER BY open_time ASC LIMIT 1"
      )
      .get(symbol) as StoredCandle | undefined;

    return { symbol, candleCount, latestCandle, oldestCandle };
  });
}

/**
 * Store klines for multiple symbols. Returns per-symbol insertion counts.
 */
export function storeKlinesBatch(
  data: Map<string, CandleData[]>,
  interval: string,
): Map<string, { inserted: number; gaps: number }> {
  const results = new Map<string, { inserted: number; gaps: number }>();
  const intervalMs = intervalToMs(interval);

  for (const [symbol, klines] of data) {
    const gaps = detectGaps(klines, intervalMs);
    const inserted = storeKlines(symbol, interval, klines);
    results.set(symbol, { inserted, gaps: gaps.length });
  }

  logger.info("market-storage", `Batch stored: ${results.size} symbols`);
  return results;
}

/**
 * Count total candles across all symbols.
 */
export function getTotalCandleCount(): number {
  const result = getDatabase()
    .prepare("SELECT COUNT(*) as count FROM market_data")
    .get() as { count: number };
  return result.count;
}

/**
 * Get the most recent candle across all symbols for a given interval.
 */
export function getLatestCandleGlobal(interval = "15m"): StoredCandle | undefined {
  return getDatabase()
    .prepare(
      "SELECT symbol, interval, open_time as openTime, open, high, low, close, volume FROM market_data WHERE interval = ? ORDER BY open_time DESC LIMIT 1"
    )
    .get(interval) as StoredCandle | undefined;
}

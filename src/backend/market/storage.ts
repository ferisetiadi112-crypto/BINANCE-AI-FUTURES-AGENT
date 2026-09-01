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
import { validateKlines, type CandleData } from "./validation";
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

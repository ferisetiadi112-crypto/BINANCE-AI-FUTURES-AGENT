/**
 * Market Data Storage — BINANCE AI FUTURES AGENT v0.1
 *
 * Stores validated market data in the database.
 * Uses the market_data table for OHLCV candles.
 *
 * Deduplication: Uses (symbol, interval, open_time) as unique key.
 * Indexing: Uses the existing idx_market_data_symbol_time index.
 *
 * Migrated to async PostgreSQL adapter for Neon compatibility.
 */

import { dbQuery, dbExecute, dbQueryOne, dbExecuteAndCount } from "../database";
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
export async function storeKlines(
  symbol: string,
  interval: string,
  klines: CandleData[],
): Promise<number> {
  // Validate first
  const validation = validateKlines(klines);
  if (!validation.valid) {
    logger.error("market-storage", `Invalid klines for ${symbol}: ${validation.errors.join(", ")}`);
    return 0;
  }

  if (validation.warnings.length > 0) {
    logger.warn("market-storage", `Kline warnings for ${symbol}: ${validation.warnings.join(", ")}`);
  }

  let inserted = 0;
  
  for (const candle of klines) {
    try {
      // Use INSERT OR IGNORE equivalent for PostgreSQL (ON CONFLICT DO NOTHING)
      const sql = `INSERT INTO market_data (symbol, interval, open_time, open, high, low, close, volume)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   ON CONFLICT (symbol, interval, open_time) DO NOTHING`;
      
      await dbExecute(sql, [symbol, interval, candle.openTime, candle.open, candle.high, candle.low, candle.close, candle.volume]);
      inserted++;
    } catch (error) {
      // Skip duplicates
      logger.debug("market-storage", `Skipping duplicate candle for ${symbol}`);
    }
  }

  logger.info("market-storage", `Stored ${inserted} new candles for ${symbol} ${interval}`);
  return inserted;
}

/**
 * Retrieve stored klines from the database.
 * Returns candles in chronological order (oldest first).
 */
export async function getStoredKlines(
  symbol: string,
  interval: string,
  limit = 100,
): Promise<StoredCandle[]> {
  const sql = `SELECT symbol, interval, open_time as "openTime", open, high, low, close, volume
               FROM market_data
               WHERE symbol = $1 AND interval = $2
               ORDER BY open_time DESC
               LIMIT $3`;
  
  const result = await dbQuery(sql, [symbol, interval, limit]);
  return result.map((row: Record<string, unknown>) => ({
    symbol: String(row['symbol']),
    interval: String(row['interval']),
    openTime: Number(row['openTime']),
    open: Number(row['open']),
    high: Number(row['high']),
    low: Number(row['low']),
    close: Number(row['close']),
    volume: Number(row['volume']),
  }));
}

/**
 * Get the most recent candle for a symbol/interval pair.
 */
export async function getLatestCandle(
  symbol: string,
  interval: string,
): Promise<StoredCandle | undefined> {
  const sql = `SELECT symbol, interval, open_time as "openTime", open, high, low, close, volume
               FROM market_data
               WHERE symbol = $1 AND interval = $2
               ORDER BY open_time DESC
               LIMIT 1`;
  
  const result = await dbQueryOne(sql, [symbol, interval]);
  if (!result) return undefined;
  
  return {
    symbol: String(result['symbol']),
    interval: String(result['interval']),
    openTime: Number(result['openTime']),
    open: Number(result['open']),
    high: Number(result['high']),
    low: Number(result['low']),
    close: Number(result['close']),
    volume: Number(result['volume']),
  };
}

/**
 * Count stored candles for a symbol.
 */
export async function getCandleCount(symbol: string, interval?: string): Promise<number> {
  let sql: string;
  let params: unknown[];
  
  if (interval) {
    sql = "SELECT COUNT(*) as count FROM market_data WHERE symbol = $1 AND interval = $2";
    params = [symbol, interval];
  } else {
    sql = "SELECT COUNT(*) as count FROM market_data WHERE symbol = $1";
    params = [symbol];
  }
  
  const result = await dbQueryOne(sql, params);
  return Number(result?.['count'] ?? 0);
}

/**
 * Clean old candles beyond retention period.
 * Default retention: 30 days.
 */
export async function cleanOldCandles(maxAgeDays = 30): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const deleted = await dbExecuteAndCount("DELETE FROM market_data WHERE open_time < $1", [cutoff]);
  logger.info("market-storage", `Cleaned ${deleted} old candles`);
  return deleted;
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
export async function getAllSymbolSummaries(): Promise<SymbolDataSummary[]> {
  const symbolsResult = await dbQuery("SELECT DISTINCT symbol FROM market_data ORDER BY symbol");

  const summaries: SymbolDataSummary[] = [];
  for (const row of symbolsResult) {
    const symbol = String(row['symbol']);
    const candleCount = await getCandleCount(symbol);
    const latestCandle = await getLatestCandle(symbol, "15m");
    
  const oldestResult = await dbQueryOne(
    `SELECT symbol, interval, open_time as "openTime", open, high, low, close, volume 
     FROM market_data WHERE symbol = $1 AND interval = '15m' ORDER BY open_time ASC LIMIT 1`,
    [symbol]
  );
  
  const oldestCandle: StoredCandle | undefined = oldestResult ? {
    symbol: String(oldestResult['symbol']),
    interval: String(oldestResult['interval']),
    openTime: Number(oldestResult['openTime']),
    open: Number(oldestResult['open']),
    high: Number(oldestResult['high']),
    low: Number(oldestResult['low']),
    close: Number(oldestResult['close']),
    volume: Number(oldestResult['volume']),
  } : undefined;

    summaries.push({ symbol, candleCount, latestCandle, oldestCandle });
  }

  return summaries;
}

/**
 * Store klines for multiple symbols. Returns per-symbol insertion counts.
 */
export async function storeKlinesBatch(
  data: Map<string, CandleData[]>,
  interval: string,
): Promise<Map<string, { inserted: number; gaps: number }>> {
  const results = new Map<string, { inserted: number; gaps: number }>();
  const intervalMs = intervalToMs(interval);

  for (const [symbol, klines] of data) {
    const gaps = detectGaps(klines, intervalMs);
    const inserted = await storeKlines(symbol, interval, klines);
    results.set(symbol, { inserted, gaps: gaps.length });
  }

  logger.info("market-storage", `Batch stored: ${results.size} symbols`);
  return results;
}

/**
 * Count total candles across all symbols.
 */
export async function getTotalCandleCount(): Promise<number> {
  const result = await dbQueryOne("SELECT COUNT(*) as count FROM market_data");
  return Number(result?.['count'] ?? 0);
}

/**
 * Get the most recent candle across all symbols for a given interval.
 */
export async function getLatestCandleGlobal(interval = "15m"): Promise<StoredCandle | undefined> {
  const result = await dbQueryOne(
    `SELECT symbol, interval, open_time as "openTime", open, high, low, close, volume 
     FROM market_data WHERE interval = $1 ORDER BY open_time DESC LIMIT 1`,
    [interval]
  );
  
  if (!result) return undefined;
  
  return {
    symbol: String(result['symbol']),
    interval: String(result['interval']),
    openTime: Number(result['openTime']),
    open: Number(result['open']),
    high: Number(result['high']),
    low: Number(result['low']),
    close: Number(result['close']),
    volume: Number(result['volume']),
  };
}

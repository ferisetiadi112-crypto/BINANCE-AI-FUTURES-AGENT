/**
 * Historical Market Data Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Manages historical Binance Futures market data for backtesting.
 * Uses public market data endpoints (no API key required).
 *
 * Data Flow:
 *   Binance Public API
 *     → Historical Data Engine
 *       → Validation
 *         → Database Storage
 *           → Backtest Engine
 */

import type { Candle } from "../../types/api";
import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type HistoricalCandle = {
  symbol: string;
  interval: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  source: string;
  ingestionTimestamp: number;
};

export type DatasetInfo = {
  id: string;
  symbol: string;
  interval: Timeframe;
  startTime: number;
  endTime: number;
  candleCount: number;
  qualityStatus: "GOOD" | "DEGRADED" | "INVALID";
  qualityIssues: string[];
  createdAt: string;
};

export type DataQualityCheck = {
  hasGaps: boolean;
  gapCount: number;
  gapDetails: Array<{ expected: number; actual: number }>;
  hasDuplicates: boolean;
  duplicateCount: number;
  invalidCandles: number;
  invalidOHLC: number;
  invalidVolume: number;
  timestampOrdering: boolean;
  overallStatus: "GOOD" | "DEGRADED" | "INVALID";
  issues: string[];
};

// ─── Configuration ──────────────────────────────────────────────────

const BINANCE_FUTURES_BASE = "https://fapi.binance.com";
const MAX_CANDLES_PER_REQUEST = 1500;
const DEFAULT_INTERVAL_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

// ─── Historical Data Engine ─────────────────────────────────────────

let datasetCounter = 0;

export async function fetchHistoricalCandles(
  symbol: string,
  interval: Timeframe,
  startTime: number,
  endTime: number,
): Promise<HistoricalCandle[]> {
  const candles: HistoricalCandle[] = [];
  let currentStart = startTime;
  const intervalMs = DEFAULT_INTERVAL_MS[interval];

  logger.info(
    "historical-data",
    `Fetching ${symbol} ${interval} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
  );

  while (currentStart < endTime) {
    try {
      const url = `${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endTime}&limit=${MAX_CANDLES_PER_REQUEST}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as Array<Array<number | string>>;

      if (data.length === 0) break;

      for (const kline of data) {
        const candle: HistoricalCandle = {
          symbol,
          interval,
          openTime: kline[0] as number,
          closeTime: kline[6] as number,
          open: parseFloat(kline[1] as string),
          high: parseFloat(kline[2] as string),
          low: parseFloat(kline[3] as string),
          close: parseFloat(kline[4] as string),
          volume: parseFloat(kline[5] as string),
          quoteVolume: parseFloat(kline[7] as string),
          source: "binance-futures",
          ingestionTimestamp: Date.now(),
        };

        candles.push(candle);
      }

      // Move to next batch
      const lastCandle = data[data.length - 1];
      if (lastCandle) {
        currentStart = (lastCandle[0] as number) + intervalMs;
      } else {
        break;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      logger.error("historical-data", `Fetch error: ${error}`);
      break;
    }
  }

  logger.info("historical-data", `Fetched ${candles.length} candles for ${symbol} ${interval}`);
  return candles;
}

export function validateCandles(candles: HistoricalCandle[]): DataQualityCheck {
  const issues: string[] = [];
  let invalidCandles = 0;
  let invalidOHLC = 0;
  let invalidVolume = 0;
  let hasDuplicates = false;
  let duplicateCount = 0;
  let hasGaps = false;
  let gapCount = 0;
  const gapDetails: Array<{ expected: number; actual: number }> = [];
  let timestampOrdering = true;

  // Check timestamp ordering
  for (let i = 1; i < candles.length; i++) {
    const currentCandle = candles[i];
    const prevCandle = candles[i - 1];
    if (currentCandle && prevCandle && currentCandle.openTime <= prevCandle.openTime) {
      timestampOrdering = false;
      issues.push(`Timestamp ordering violation at index ${i}`);
    }
  }

  // Check duplicates
  const timestamps = new Set<number>();
  for (const candle of candles) {
    if (timestamps.has(candle.openTime)) {
      hasDuplicates = true;
      duplicateCount++;
    }
    timestamps.add(candle.openTime);
  }

  // Check OHLC validity
  for (const candle of candles) {
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
      invalidOHLC++;
      invalidCandles++;
    }
    if (candle.high < candle.low) {
      invalidOHLC++;
      invalidCandles++;
    }
    if (candle.volume < 0) {
      invalidVolume++;
      invalidCandles++;
    }
  }

  // Check for gaps
  if (candles.length > 1 && candles[0]) {
    const intervalMs = DEFAULT_INTERVAL_MS[candles[0].interval];
    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];
      if (prevCandle && currentCandle) {
        const expectedTime = prevCandle.openTime + intervalMs;
        if (currentCandle.openTime > expectedTime + intervalMs * 0.1) {
          hasGaps = true;
          gapCount++;
          gapDetails.push({
            expected: expectedTime,
            actual: currentCandle.openTime,
          });
        }
      }
    }
  }

  // Determine overall status
  let overallStatus: DataQualityCheck["overallStatus"];
  if (invalidCandles > candles.length * 0.1 || !timestampOrdering) {
    overallStatus = "INVALID";
  } else if (hasGaps || hasDuplicates || invalidCandles > 0) {
    overallStatus = "DEGRADED";
  } else {
    overallStatus = "GOOD";
  }

  if (hasGaps) issues.push(`${gapCount} gaps detected`);
  if (hasDuplicates) issues.push(`${duplicateCount} duplicates detected`);
  if (invalidOHLC > 0) issues.push(`${invalidOHLC} invalid OHLC candles`);
  if (invalidVolume > 0) issues.push(`${invalidVolume} invalid volume candles`);

  return {
    hasGaps,
    gapCount,
    gapDetails,
    hasDuplicates,
    duplicateCount,
    invalidCandles,
    invalidOHLC,
    invalidVolume,
    timestampOrdering,
    overallStatus,
    issues,
  };
}

export function deduplicateCandles(candles: HistoricalCandle[]): HistoricalCandle[] {
  const seen = new Set<number>();
  return candles.filter(candle => {
    if (seen.has(candle.openTime)) return false;
    seen.add(candle.openTime);
    return true;
  });
}

export function createDataset(
  symbol: string,
  interval: Timeframe,
  candles: HistoricalCandle[],
): DatasetInfo {
  datasetCounter++;

  const quality = validateCandles(candles);

  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const startTime = firstCandle ? firstCandle.openTime : 0;
  const endTime = lastCandle ? lastCandle.openTime : 0;

  return {
    id: `DATASET-${Date.now()}-${datasetCounter}`,
    symbol,
    interval,
    startTime,
    endTime,
    candleCount: candles.length,
    qualityStatus: quality.overallStatus,
    qualityIssues: quality.issues,
    createdAt: new Date().toISOString(),
  };
}

// ─── Query Functions ────────────────────────────────────────────────

export function getCandlesInTimeRange(
  candles: HistoricalCandle[],
  startTime: number,
  endTime: number,
): HistoricalCandle[] {
  return candles.filter(c => c.openTime >= startTime && c.openTime <= endTime);
}

export function getCandlesForSymbol(
  candles: HistoricalCandle[],
  symbol: string,
): HistoricalCandle[] {
  return candles.filter(c => c.symbol === symbol);
}

export function convertToCandle(c: HistoricalCandle): Candle {
  return {
    t: new Date(c.openTime).toISOString(),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  };
}

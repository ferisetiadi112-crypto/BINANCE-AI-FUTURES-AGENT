/**
 * Market Data Validation — BINANCE AI FUTURES AGENT v0.1
 *
 * Validates market data before it enters the runtime system.
 * Invalid data is rejected and logged as a risk/system event.
 *
 * Validation rules:
 * - Timestamp must be valid and not in the future
 * - OHLC must be positive
 * - High >= Low, High >= Open, High >= Close
 * - Low <= Open, Low <= Close
 * - Volume must be non-negative
 * - No duplicate candles (same timestamp)
 * - Data not stale (configurable max age)
 */

import { logger } from "../logger";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type CandleData = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

const MAX_STALENESS_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FUTURE_OFFSET_MS = 60 * 1000; // 1 minute (clock skew tolerance)

export function validateCandle(candle: CandleData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Timestamp validation
  if (!candle.openTime || candle.openTime <= 0) {
    errors.push("Invalid openTime: must be positive");
  }

  if (candle.openTime > Date.now() + MAX_FUTURE_OFFSET_MS) {
    errors.push(`openTime is in the future: ${new Date(candle.openTime).toISOString()}`);
  }

  // Price validation
  if (candle.open <= 0) errors.push("Open price must be positive");
  if (candle.high <= 0) errors.push("High price must be positive");
  if (candle.low <= 0) errors.push("Low price must be positive");
  if (candle.close <= 0) errors.push("Close price must be positive");

  // OHLC relationship validation
  if (candle.high < candle.low) {
    errors.push(`High (${candle.high}) < Low (${candle.low})`);
  }
  if (candle.high < candle.open) {
    errors.push(`High (${candle.high}) < Open (${candle.open})`);
  }
  if (candle.high < candle.close) {
    errors.push(`High (${candle.high}) < Close (${candle.close})`);
  }
  if (candle.low > candle.open) {
    errors.push(`Low (${candle.low}) > Open (${candle.open})`);
  }
  if (candle.low > candle.close) {
    errors.push(`Low (${candle.low}) > Close (${candle.close})`);
  }

  // Volume validation
  if (candle.volume < 0) {
    errors.push("Volume must be non-negative");
  }

  // Staleness warning
  const age = Date.now() - candle.openTime;
  if (age > MAX_STALENESS_MS) {
    warnings.push(`Candle is stale: ${(age / 1000).toFixed(0)}s old`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateKlines(klines: CandleData[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (klines.length === 0) {
    errors.push("No klines provided");
    return { valid: false, errors, warnings };
  }

  const seenTimestamps = new Set<number>();

  for (let i = 0; i < klines.length; i++) {
    const candle = klines[i]!;
    const result = validateCandle(candle);

    // Check for duplicates
    if (seenTimestamps.has(candle.openTime)) {
      errors.push(`Duplicate candle at index ${i}: timestamp ${candle.openTime}`);
    }
    seenTimestamps.add(candle.openTime);

    // Check chronological order
    if (i > 0 && klines[i - 1]!.openTime >= candle.openTime) {
      errors.push(`Out of order at index ${i}: ${klines[i - 1]!.openTime} >= ${candle.openTime}`);
    }

    // Collect errors with index
    for (const err of result.errors) {
      errors.push(`Candle[${i}]: ${err}`);
    }
    warnings.push(...result.warnings.map(w => `Candle[${i}]: ${w}`));
  }

  if (errors.length > 0) {
    logger.warn("validation", `Klines validation failed: ${errors.length} errors`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateTicker(ticker: {
  symbol: string;
  lastPrice: number;
  volume: number;
  highPrice: number;
  lowPrice: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!ticker.symbol) errors.push("Symbol is required");
  if (ticker.lastPrice <= 0) errors.push("Price must be positive");
  if (ticker.volume < 0) errors.push("Volume must be non-negative");
  if (ticker.highPrice < ticker.lowPrice) {
    errors.push(`High (${ticker.highPrice}) < Low (${ticker.lowPrice})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

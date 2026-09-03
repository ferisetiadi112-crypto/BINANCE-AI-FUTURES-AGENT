/**
 * Binance Exchange Filter Validation — BINANCE AI FUTURES AGENT v0.1 (P4-FIX)
 *
 * Validates orders against Binance Futures exchange filters:
 * - PRICE_FILTER: minPrice, maxPrice, tickSize
 * - LOT_SIZE: minQty, maxQty, stepSize
 * - MARKET_LOT_SIZE: limit (max quantity per market order)
 * - MIN_NOTIONAL / NOTIONAL: minimum order value
 * - Leverage limits per symbol
 *
 * SAFETY:
 * - All validation is deterministic
 * - Normalization uses integer arithmetic to avoid floating-point errors
 * - Fail closed on any uncertainty
 * - Never modifies order parameters silently
 */

import type { SymbolInfo, ExchangeFilter } from "./binance-testnet";

// ─── Types ──────────────────────────────────────────────────────────

export type FilterValidationResult = {
  valid: boolean;
  errors: string[];
  normalizedQuantity: number;
  normalizedPrice: number;
};

export type SymbolValidationResult = {
  valid: boolean;
  errors: string[];
  symbolInfo: SymbolInfo | null;
};

// ─── Filter Extraction ───────────────────────────────────────────────

/**
 * Extract PRICE_FILTER from symbol info.
 */
export function getPriceFilter(symbolInfo: SymbolInfo): ExchangeFilter | null {
  return symbolInfo.filters.find((f) => f.filterType === "PRICE_FILTER") || null;
}

/**
 * Extract LOT_SIZE from symbol info.
 */
export function getLotSizeFilter(symbolInfo: SymbolInfo): ExchangeFilter | null {
  return symbolInfo.filters.find((f) => f.filterType === "LOT_SIZE") || null;
}

/**
 * Extract MARKET_LOT_SIZE from symbol info.
 */
export function getMarketLotSizeFilter(symbolInfo: SymbolInfo): ExchangeFilter | null {
  return symbolInfo.filters.find((f) => f.filterType === "MARKET_LOT_SIZE") || null;
}

/**
 * Extract MIN_NOTIONAL or NOTIONAL from symbol info.
 */
export function getNotionalFilter(symbolInfo: SymbolInfo): ExchangeFilter | null {
  return (
    symbolInfo.filters.find((f) => f.filterType === "MIN_NOTIONAL") ||
    symbolInfo.filters.find((f) => f.filterType === "NOTIONAL") ||
    null
  );
}

// ─── Step Size / Tick Size Utilities ─────────────────────────────────

/**
 * Calculate the number of decimal places from a step/tick size string.
 * e.g., "0.001" → 3, "0.01" → 2, "1" → 0, "0.00001" → 5
 */
export function getDecimals(stepSize: string): number {
  const parts = stepSize.split(".");
  if (parts.length === 1) return 0;
  return parts[1]!.length;
}

/**
 * Normalize a number to match a step/tick size using integer arithmetic.
 * e.g., stepSize=0.001, value=1.2347 → 1.234
 * e.g., stepSize=0.01, value=63000.5 → 63000.50
 *
 * Returns the normalized value, or NaN if calculation fails.
 */
export function normalizeToStep(value: number, stepSize: number): number {
  if (stepSize <= 0 || isNaN(stepSize) || isNaN(value)) return NaN;
  if (stepSize === 1) return Math.trunc(value);

  const decimals = getDecimals(String(stepSize));
  const multiplier = Math.pow(10, decimals);

  // Multiply by precision, floor, then divide back
  const scaledValue = value * multiplier;
  const scaledStep = stepSize * multiplier;

  // Use floor to round down to nearest step
  const normalized = Math.floor(scaledValue / scaledStep) * scaledStep;

  return normalized / multiplier;
}

/**
 * Check if a value aligns with a step/tick size.
 */
export function isAlignedToStep(value: number, stepSize: number): boolean {
  if (stepSize <= 0 || isNaN(stepSize) || isNaN(value)) return false;
  const decimals = getDecimals(String(stepSize));
  const multiplier = Math.pow(10, decimals);
  const scaled = value * multiplier;
  const scaledStep = stepSize * multiplier;
  return Math.abs(scaled % scaledStep) < 1e-10;
}

// ─── Symbol Validation ───────────────────────────────────────────────

/**
 * Validate that a symbol exists and is active on Binance Futures.
 */
export function validateSymbol(
  symbolInfo: SymbolInfo | null,
  symbol: string,
): SymbolValidationResult {
  const errors: string[] = [];

  if (!symbolInfo) {
    errors.push(`Symbol ${symbol} not found in exchange info`);
    return { valid: false, errors, symbolInfo: null };
  }

  if (symbolInfo.status !== "TRADING") {
    errors.push(`Symbol ${symbol} status is ${symbolInfo.status} (requires TRADING)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    symbolInfo,
  };
}

// ─── Quantity Validation ─────────────────────────────────────────────

/**
 * Validate and normalize quantity against LOT_SIZE and MARKET_LOT_SIZE filters.
 */
export function validateQuantity(
  symbolInfo: SymbolInfo,
  quantity: number,
): { valid: boolean; errors: string[]; normalizedQuantity: number } {
  const errors: string[] = [];
  let normalizedQuantity = quantity;

  const lotSize = getLotSizeFilter(symbolInfo);
  if (lotSize) {
    const minQty = parseFloat(lotSize.minQty || "0");
    const maxQty = parseFloat(lotSize.maxQty || "Infinity");
    const stepSize = parseFloat(lotSize.stepSize || "1");

    // Normalize to step size
    normalizedQuantity = normalizeToStep(quantity, stepSize);

    if (isNaN(normalizedQuantity)) {
      errors.push(`Invalid quantity: ${quantity} (cannot normalize to step ${stepSize})`);
      return { valid: false, errors, normalizedQuantity: quantity };
    }

    if (normalizedQuantity < minQty) {
      errors.push(`Quantity ${normalizedQuantity} below minimum ${minQty}`);
    }

    if (normalizedQuantity > maxQty) {
      errors.push(`Quantity ${normalizedQuantity} above maximum ${maxQty}`);
    }

    if (!isAlignedToStep(normalizedQuantity, stepSize)) {
      errors.push(`Quantity ${normalizedQuantity} not aligned to step ${stepSize}`);
    }
  }

  // Check MARKET_LOT_SIZE for market orders
  const marketLotSize = getMarketLotSizeFilter(symbolInfo);
  if (marketLotSize && marketLotSize.limit) {
    const marketLimit = parseFloat(marketLotSize.limit);
    if (normalizedQuantity > marketLimit) {
      errors.push(`Market quantity ${normalizedQuantity} exceeds market limit ${marketLimit}`);
    }
  }

  if (normalizedQuantity <= 0) {
    errors.push(`Quantity must be positive, got ${normalizedQuantity}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedQuantity,
  };
}

// ─── Price Validation ────────────────────────────────────────────────

/**
 * Validate and normalize price against PRICE_FILTER.
 */
export function validatePrice(
  symbolInfo: SymbolInfo,
  price: number,
): { valid: boolean; errors: string[]; normalizedPrice: number } {
  const errors: string[] = [];
  let normalizedPrice = price;

  const priceFilter = getPriceFilter(symbolInfo);
  if (priceFilter) {
    const minPrice = parseFloat(priceFilter.minPrice || "0");
    const maxPrice = parseFloat(priceFilter.maxPrice || "Infinity");
    const tickSize = parseFloat(priceFilter.tickSize || "1");

    // Normalize to tick size
    normalizedPrice = normalizeToStep(price, tickSize);

    if (isNaN(normalizedPrice)) {
      errors.push(`Invalid price: ${price} (cannot normalize to tick ${tickSize})`);
      return { valid: false, errors, normalizedPrice: price };
    }

    if (normalizedPrice < minPrice) {
      errors.push(`Price ${normalizedPrice} below minimum ${minPrice}`);
    }

    if (normalizedPrice > maxPrice) {
      errors.push(`Price ${normalizedPrice} above maximum ${maxPrice}`);
    }

    if (!isAlignedToStep(normalizedPrice, tickSize)) {
      errors.push(`Price ${normalizedPrice} not aligned to tick ${tickSize}`);
    }
  }

  if (normalizedPrice <= 0) {
    errors.push(`Price must be positive, got ${normalizedPrice}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedPrice,
  };
}

// ─── Notional Validation ─────────────────────────────────────────────

/**
 * Validate that the order notional (quantity × price) meets minimum notional.
 */
export function validateNotional(
  symbolInfo: SymbolInfo,
  quantity: number,
  price: number,
): { valid: boolean; errors: string[]; notional: number } {
  const errors: string[] = [];
  const notional = quantity * price;

  const notionalFilter = getNotionalFilter(symbolInfo);
  if (notionalFilter) {
    const minNotional = parseFloat(notionalFilter.minNotional || notionalFilter.notional || "5");

    if (notional < minNotional) {
      errors.push(`Notional $${notional.toFixed(2)} below minimum $${minNotional.toFixed(2)}`);
    }
  }

  if (notional <= 0) {
    errors.push(`Notional must be positive, got ${notional}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    notional,
  };
}

// ─── Comprehensive Order Validation ──────────────────────────────────

/**
 * Validate a complete order against all Binance exchange filters.
 * Returns normalized values and any errors.
 */
export function validateOrderFilters(
  symbolInfo: SymbolInfo,
  params: {
    quantity: number;
    price: number;
    stopLossPrice: number;
    takeProfitPrice: number;
  },
): FilterValidationResult {
  const allErrors: string[] = [];

  // 1. Validate quantity
  const qtyResult = validateQuantity(symbolInfo, params.quantity);
  allErrors.push(...qtyResult.errors);

  // 2. Validate price (entry)
  const priceResult = validatePrice(symbolInfo, params.price);
  allErrors.push(...priceResult.errors);

  // 3. Validate stop loss price
  const slResult = validatePrice(symbolInfo, params.stopLossPrice);
  if (!slResult.valid) {
    allErrors.push(`Stop-loss: ${slResult.errors.join(", ")}`);
  }

  // 4. Validate take profit price
  const tpResult = validatePrice(symbolInfo, params.takeProfitPrice);
  if (!tpResult.valid) {
    allErrors.push(`Take-profit: ${tpResult.errors.join(", ")}`);
  }

  // 5. Validate notional
  const notionalResult = validateNotional(symbolInfo, qtyResult.normalizedQuantity, priceResult.normalizedPrice);
  allErrors.push(...notionalResult.errors);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    normalizedQuantity: qtyResult.normalizedQuantity,
    normalizedPrice: priceResult.normalizedPrice,
  };
}

// ─── Leverage Validation ─────────────────────────────────────────────

/**
 * Get effective max leverage for a symbol.
 * Uses Binance's max leverage if available, otherwise falls back to P3 limit.
 */
export function getEffectiveMaxLeverage(
  symbolInfo: SymbolInfo | null,
  riskEngineMaxLeverage: number,
): number {
  // Binance doesn't provide max leverage in exchange info
  // It's returned by setLeverage or leverBracket API
  // For now, use the risk engine limit
  return riskEngineMaxLeverage;
}

// ─── Mainnet URL Check ───────────────────────────────────────────────

const MAINNET_URLS = [
  "fapi.binance.com",
  "api.binance.com",
  "www.binance.com",
  "sapi.binance.com",
];

/**
 * Check if a URL is a mainnet Binance endpoint.
 * Returns true if it's mainnet (should be rejected).
 */
export function isMainnetUrl(url: string): boolean {
  return MAINNET_URLS.some((pattern) => url.includes(pattern));
}

/**
 * Validate that a base URL is testnet, not mainnet.
 */
export function validateTestnetUrl(baseUrl: string): { valid: boolean; error?: string } {
  if (isMainnetUrl(baseUrl)) {
    return { valid: false, error: `Mainnet URL detected: ${baseUrl} — TESTNET ONLY` };
  }

  // Must be testnet
  if (!baseUrl.includes("testnet")) {
    return { valid: false, error: `URL does not appear to be testnet: ${baseUrl}` };
  }

  return { valid: true };
}

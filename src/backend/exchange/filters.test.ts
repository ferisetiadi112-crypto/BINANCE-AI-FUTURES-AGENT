/**
 * Exchange Filter Validation Tests — BINANCE AI FUTURES AGENT v0.1 (P4-FIX)
 *
 * Tests for:
 * - PRICE_FILTER validation
 * - LOT_SIZE validation
 * - MARKET_LOT_SIZE validation
 * - MIN_NOTIONAL / NOTIONAL validation
 * - Quantity normalization
 * - Price normalization
 * - Symbol validation
 * - Comprehensive order filter validation
 * - Leverage validation
 * - Mainnet URL rejection
 * - Step size / tick size utilities
 */

import { describe, it, expect } from "vitest";
import {
  validateSymbol,
  validateQuantity,
  validatePrice,
  validateNotional,
  validateOrderFilters,
  getEffectiveMaxLeverage,
  validateTestnetUrl,
  isMainnetUrl,
  normalizeToStep,
  isAlignedToStep,
  getDecimals,
  getPriceFilter,
  getLotSizeFilter,
  getMarketLotSizeFilter,
  getNotionalFilter,
} from "./filters";
import type { SymbolInfo, ExchangeFilter } from "./binance-testnet";

// ─── Mock Symbol Info ───────────────────────────────────────────────

function createMockSymbolInfo(overrides?: Partial<SymbolInfo>): SymbolInfo {
  return {
    symbol: "BTCUSDT",
    status: "TRADING",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    pricePrecision: 2,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quoteAssetPrecision: 8,
    filters: [
      {
        filterType: "PRICE_FILTER",
        minPrice: "0.10",
        maxPrice: "100000.00",
        tickSize: "0.10",
      },
      {
        filterType: "LOT_SIZE",
        minQty: "0.001",
        maxQty: "1000.000",
        stepSize: "0.001",
      },
      {
        filterType: "MARKET_LOT_SIZE",
        limit: "100.000",
      },
      {
        filterType: "MIN_NOTIONAL",
        minNotional: "5.00",
      },
    ],
    orderTypes: ["LIMIT", "MARKET", "STOP_MARKET", "TAKE_PROFIT_MARKET"],
    timeInForce: ["GTC", "IOC", "FOK"],
    ...overrides,
  };
}

// ─── Step Size / Tick Size Utilities ─────────────────────────────────

describe("getDecimals", () => {
  it("returns 0 for integer step sizes", () => {
    expect(getDecimals("1")).toBe(0);
    expect(getDecimals("10")).toBe(0);
  });

  it("returns correct decimal count", () => {
    expect(getDecimals("0.001")).toBe(3);
    expect(getDecimals("0.01")).toBe(2);
    expect(getDecimals("0.10")).toBe(2);
    expect(getDecimals("0.00001")).toBe(5);
  });

  it("handles step sizes without decimals", () => {
    expect(getDecimals("5")).toBe(0);
  });
});

describe("normalizeToStep", () => {
  it("floors to nearest step", () => {
    expect(normalizeToStep(1.2347, 0.001)).toBeCloseTo(1.234, 3);
    expect(normalizeToStep(1.2347, 0.01)).toBeCloseTo(1.23, 2);
    expect(normalizeToStep(1.2347, 0.1)).toBeCloseTo(1.2, 1);
  });

  it("returns the value if already aligned", () => {
    expect(normalizeToStep(1.234, 0.001)).toBeCloseTo(1.234, 3);
    expect(normalizeToStep(1.23, 0.01)).toBeCloseTo(1.23, 2);
  });

  it("handles integer step sizes", () => {
    expect(normalizeToStep(7, 1)).toBe(7);
    expect(normalizeToStep(7.9, 1)).toBe(7);
    expect(normalizeToStep(7, 5)).toBe(5);
  });

  it("returns NaN for invalid inputs", () => {
    expect(normalizeToStep(NaN, 0.001)).toBeNaN();
    expect(normalizeToStep(1.0, NaN)).toBeNaN();
    expect(normalizeToStep(1.0, -1)).toBeNaN();
    expect(normalizeToStep(1.0, 0)).toBeNaN();
  });

  it("handles edge case with very small step size", () => {
    const result = normalizeToStep(0.000123, 0.00001);
    expect(result).toBeCloseTo(0.00012, 5);
  });
});

describe("isAlignedToStep", () => {
  it("returns true for aligned values", () => {
    expect(isAlignedToStep(1.0, 0.1)).toBe(true);
    expect(isAlignedToStep(1.23, 0.01)).toBe(true);
    expect(isAlignedToStep(1.234, 0.001)).toBe(true);
    expect(isAlignedToStep(5, 1)).toBe(true);
  });

  it("returns false for non-aligned values", () => {
    expect(isAlignedToStep(1.235, 0.01)).toBe(false);
    expect(isAlignedToStep(1.2345, 0.001)).toBe(false);
    expect(isAlignedToStep(7, 5)).toBe(false);
  });

  it("returns false for invalid inputs", () => {
    expect(isAlignedToStep(NaN, 0.01)).toBe(false);
    expect(isAlignedToStep(1.0, NaN)).toBe(false);
    expect(isAlignedToStep(1.0, 0)).toBe(false);
    expect(isAlignedToStep(1.0, -1)).toBe(false);
  });
});

// ─── Filter Extraction ──────────────────────────────────────────────

describe("Filter Extraction", () => {
  const symbolInfo = createMockSymbolInfo();

  it("extracts PRICE_FILTER", () => {
    const filter = getPriceFilter(symbolInfo);
    expect(filter).not.toBeNull();
    expect(filter!.filterType).toBe("PRICE_FILTER");
    expect(filter!.tickSize).toBe("0.10");
  });

  it("extracts LOT_SIZE", () => {
    const filter = getLotSizeFilter(symbolInfo);
    expect(filter).not.toBeNull();
    expect(filter!.filterType).toBe("LOT_SIZE");
    expect(filter!.stepSize).toBe("0.001");
  });

  it("extracts MARKET_LOT_SIZE", () => {
    const filter = getMarketLotSizeFilter(symbolInfo);
    expect(filter).not.toBeNull();
    expect(filter!.filterType).toBe("MARKET_LOT_SIZE");
  });

  it("extracts MIN_NOTIONAL", () => {
    const filter = getNotionalFilter(symbolInfo);
    expect(filter).not.toBeNull();
    expect(filter!.filterType).toBe("MIN_NOTIONAL");
  });

  it("returns null for missing filters", () => {
    const emptySymbol = createMockSymbolInfo({ filters: [] });
    expect(getPriceFilter(emptySymbol)).toBeNull();
    expect(getLotSizeFilter(emptySymbol)).toBeNull();
    expect(getMarketLotSizeFilter(emptySymbol)).toBeNull();
    expect(getNotionalFilter(emptySymbol)).toBeNull();
  });

  it("prefers MIN_NOTIONAL over NOTIONAL", () => {
    const symbolWithBoth = createMockSymbolInfo({
      filters: [
        { filterType: "MIN_NOTIONAL", minNotional: "5.00" },
        { filterType: "NOTIONAL", notional: "10.00" },
      ],
    });
    const filter = getNotionalFilter(symbolWithBoth);
    expect(filter!.filterType).toBe("MIN_NOTIONAL");
  });
});

// ─── Symbol Validation ──────────────────────────────────────────────

describe("Symbol Validation", () => {
  it("passes for active symbol", () => {
    const result = validateSymbol(createMockSymbolInfo(), "BTCUSDT");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null symbol info", () => {
    const result = validateSymbol(null, "INVALIDUSDT");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not found");
  });

  it("rejects non-TRADING status", () => {
    const symbolInfo = createMockSymbolInfo({ status: "BREAK" });
    const result = validateSymbol(symbolInfo, "BTCUSDT");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("BREAK");
  });
});

// ─── Quantity Validation ─────────────────────────────────────────────

describe("Quantity Validation", () => {
  const symbolInfo = createMockSymbolInfo();

  it("passes for valid quantity", () => {
    const result = validateQuantity(symbolInfo, 0.001);
    expect(result.valid).toBe(true);
    expect(result.normalizedQuantity).toBeCloseTo(0.001, 3);
  });

  it("normalizes quantity to step size", () => {
    const result = validateQuantity(symbolInfo, 0.0015);
    expect(result.valid).toBe(true);
    expect(result.normalizedQuantity).toBeCloseTo(0.001, 3);
  });

  it("rejects quantity below minimum", () => {
    const result = validateQuantity(symbolInfo, 0.0001);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("below minimum"))).toBe(true);
  });

  it("rejects quantity above maximum", () => {
    const result = validateQuantity(symbolInfo, 2000);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("above maximum"))).toBe(true);
  });

  it("rejects zero quantity", () => {
    const result = validateQuantity(symbolInfo, 0);
    expect(result.valid).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = validateQuantity(symbolInfo, -1);
    expect(result.valid).toBe(false);
  });

  it("handles MARKET_LOT_SIZE limit", () => {
    const result = validateQuantity(symbolInfo, 150); // Above market limit of 100
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("market limit"))).toBe(true);
  });
});

// ─── Price Validation ────────────────────────────────────────────────

describe("Price Validation", () => {
  const symbolInfo = createMockSymbolInfo();

  it("passes for valid price", () => {
    const result = validatePrice(symbolInfo, 63000.50);
    expect(result.valid).toBe(true);
    expect(result.normalizedPrice).toBeCloseTo(63000.50, 2);
  });

  it("normalizes price to tick size", () => {
    const result = validatePrice(symbolInfo, 63000.55);
    // tickSize is 0.10, so 63000.55 → 63000.50
    expect(result.valid).toBe(true);
    expect(result.normalizedPrice).toBeCloseTo(63000.50, 2);
  });

  it("rejects price below minimum", () => {
    const result = validatePrice(symbolInfo, 0.05);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("below minimum"))).toBe(true);
  });

  it("rejects price above maximum", () => {
    const result = validatePrice(symbolInfo, 200000);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("above maximum"))).toBe(true);
  });

  it("rejects zero price", () => {
    const result = validatePrice(symbolInfo, 0);
    expect(result.valid).toBe(false);
  });

  it("rejects negative price", () => {
    const result = validatePrice(symbolInfo, -100);
    expect(result.valid).toBe(false);
  });
});

// ─── Notional Validation ─────────────────────────────────────────────

describe("Notional Validation", () => {
  const symbolInfo = createMockSymbolInfo();

  it("passes for notional above minimum", () => {
    // 0.001 * 63000 = $63.00 (above $5.00 minimum)
    const result = validateNotional(symbolInfo, 0.001, 63000);
    expect(result.valid).toBe(true);
    expect(result.notional).toBe(63);
  });

  it("rejects notional below minimum", () => {
    // 0.0001 * 63000 = $6.30 but quantity fails LOT_SIZE first
    const result = validateNotional(symbolInfo, 0.00001, 100);
    // 0.001 is min qty, so 0.00001 * 100 = $0.0001
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("below minimum"))).toBe(true);
  });

  it("rejects zero notional", () => {
    const result = validateNotional(symbolInfo, 0, 63000);
    expect(result.valid).toBe(false);
  });

  it("rejects negative notional", () => {
    const result = validateNotional(symbolInfo, -1, 63000);
    expect(result.valid).toBe(false);
  });
});

// ─── Comprehensive Order Filter Validation ──────────────────────────

describe("validateOrderFilters", () => {
  const symbolInfo = createMockSymbolInfo();

  it("passes for valid complete order", () => {
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.001,
      price: 63000.00,
      stopLossPrice: 61740.00,
      takeProfitPrice: 65520.00,
    });
    expect(result.valid).toBe(true);
    expect(result.normalizedQuantity).toBeCloseTo(0.001, 3);
    expect(result.normalizedPrice).toBeCloseTo(63000.00, 2);
  });

  it("normalizes values to Binance filters", () => {
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.0015,
      price: 63000.55,
      stopLossPrice: 61740.05,
      takeProfitPrice: 65520.08,
    });
    expect(result.valid).toBe(true);
    expect(result.normalizedQuantity).toBeCloseTo(0.001, 3);
    expect(result.normalizedPrice).toBeCloseTo(63000.50, 2);
  });

  it("fails on invalid quantity", () => {
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.0001, // Below minQty of 0.001
      price: 63000,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
    });
    expect(result.valid).toBe(false);
  });

  it("fails on invalid price", () => {
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.001,
      price: 0,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
    });
    expect(result.valid).toBe(false);
  });

  it("fails on invalid stop loss price", () => {
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.001,
      price: 63000,
      stopLossPrice: 0,
      takeProfitPrice: 65520,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Stop-loss"))).toBe(true);
  });

  it("fails on invalid take profit price", () => {
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.001,
      price: 63000,
      stopLossPrice: 61740,
      takeProfitPrice: -100,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Take-profit"))).toBe(true);
  });

  it("fails when notional below minimum", () => {
    // 0.001 * 1 = $0.001 — well below $5 minimum
    const result = validateOrderFilters(symbolInfo, {
      quantity: 0.001,
      price: 1,
      stopLossPrice: 0.9,
      takeProfitPrice: 1.1,
    });
    expect(result.valid).toBe(false);
  });
});

// ─── Leverage Validation ─────────────────────────────────────────────

describe("Leverage Validation", () => {
  it("returns risk engine limit as effective max", () => {
    const symbolInfo = createMockSymbolInfo();
    const result = getEffectiveMaxLeverage(symbolInfo, 20);
    expect(result).toBe(20);
  });

  it("returns risk engine limit when symbol info is null", () => {
    const result = getEffectiveMaxLeverage(null, 10);
    expect(result).toBe(10);
  });
});

// ─── Mainnet URL Rejection ──────────────────────────────────────────

describe("Mainnet URL Rejection", () => {
  it("identifies mainnet URLs", () => {
    expect(isMainnetUrl("https://fapi.binance.com")).toBe(true);
    expect(isMainnetUrl("https://api.binance.com")).toBe(true);
    expect(isMainnetUrl("https://www.binance.com")).toBe(true);
    expect(isMainnetUrl("https://sapi.binance.com")).toBe(true);
  });

  it("does not flag testnet URLs", () => {
    expect(isMainnetUrl("https://testnet.binancefuture.com")).toBe(false);
    expect(isMainnetUrl("https://custom.testnet.example.com")).toBe(false);
  });

  it("validates testnet URL", () => {
    const result = validateTestnetUrl("https://testnet.binancefuture.com");
    expect(result.valid).toBe(true);
  });

  it("rejects mainnet URL", () => {
    const result = validateTestnetUrl("https://fapi.binance.com");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Mainnet");
  });

  it("rejects URL without testnet indicator", () => {
    const result = validateTestnetUrl("https://custom.example.com");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("does not appear to be testnet");
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("handles symbol with no filters", () => {
    const emptySymbol = createMockSymbolInfo({ filters: [] });
    const result = validateOrderFilters(emptySymbol, {
      quantity: 1,
      price: 63000,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
    });
    // No filters means no constraints to fail
    expect(result.valid).toBe(true);
  });

  it("handles very small quantities", () => {
    const symbolInfo = createMockSymbolInfo({
      filters: [
        { filterType: "LOT_SIZE", minQty: "0.0001", maxQty: "1000", stepSize: "0.0001" },
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "100000", tickSize: "0.01" },
        { filterType: "MIN_NOTIONAL", minNotional: "5.00" },
      ],
    });
    const result = validateQuantity(symbolInfo, 0.0001);
    expect(result.valid).toBe(true);
    expect(result.normalizedQuantity).toBeCloseTo(0.0001, 4);
  });

  it("handles ETH-like step sizes", () => {
    const ethSymbol = createMockSymbolInfo({
      symbol: "ETHUSDT",
      filters: [
        { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "10000", stepSize: "0.001" },
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "100000", tickSize: "0.01" },
        { filterType: "MIN_NOTIONAL", minNotional: "5.00" },
      ],
    });
    const result = validateOrderFilters(ethSymbol, {
      quantity: 0.1234,
      price: 3200.567,
      stopLossPrice: 3136.55,
      takeProfitPrice: 3328.58,
    });
    expect(result.valid).toBe(true);
    expect(result.normalizedQuantity).toBeCloseTo(0.123, 3);
    expect(result.normalizedPrice).toBeCloseTo(3200.56, 2);
  });
});

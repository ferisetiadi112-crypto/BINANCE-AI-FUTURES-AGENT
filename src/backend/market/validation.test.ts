import { describe, it, expect } from "vitest";
import { validateCandle, validateKlines, validateTicker, detectGaps, intervalToMs } from "./validation";

describe("Market Data Validation", () => {
  describe("validateCandle", () => {
    it("validates correct candle", () => {
      const result = validateCandle({
        openTime: Date.now() - 1000,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1000,
        closeTime: Date.now(),
      });
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("rejects negative price", () => {
      const result = validateCandle({
        openTime: Date.now() - 1000,
        open: -100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1000,
        closeTime: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Open price"))).toBe(true);
    });

    it("rejects high < low", () => {
      const result = validateCandle({
        openTime: Date.now() - 1000,
        open: 100,
        high: 90,
        low: 95,
        close: 102,
        volume: 1000,
        closeTime: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("High") && e.includes("Low"))).toBe(true);
    });

    it("rejects negative volume", () => {
      const result = validateCandle({
        openTime: Date.now() - 1000,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: -100,
        closeTime: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Volume"))).toBe(true);
    });

    it("rejects future timestamp", () => {
      const result = validateCandle({
        openTime: Date.now() + 10 * 60 * 1000, // 10 minutes in future
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 1000,
        closeTime: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("future"))).toBe(true);
    });
  });

  describe("validateKlines", () => {
    it("validates correct klines", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 2000, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
      ];
      const result = validateKlines(klines);
      expect(result.valid).toBe(true);
    });

    it("rejects empty klines", () => {
      const result = validateKlines([]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("No klines"))).toBe(true);
    });

    it("rejects duplicate timestamps", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 1000, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
      ];
      const result = validateKlines(klines);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
    });

    it("rejects out of order klines", () => {
      const klines = [
        { openTime: 2000, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
      ];
      const result = validateKlines(klines);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Out of order"))).toBe(true);
    });
  });

  describe("validateTicker", () => {
    it("validates correct ticker", () => {
      const result = validateTicker({
        symbol: "BTCUSDT",
        lastPrice: 63000,
        volume: 28000,
        highPrice: 64000,
        lowPrice: 62000,
      });
      expect(result.valid).toBe(true);
    });

    it("rejects zero price", () => {
      const result = validateTicker({
        symbol: "BTCUSDT",
        lastPrice: 0,
        volume: 28000,
        highPrice: 64000,
        lowPrice: 62000,
      });
      expect(result.valid).toBe(false);
    });

    it("rejects high < low", () => {
      const result = validateTicker({
        symbol: "BTCUSDT",
        lastPrice: 63000,
        volume: 28000,
        highPrice: 62000,
        lowPrice: 64000,
      });
      expect(result.valid).toBe(false);
    });

    it("rejects empty symbol", () => {
      const result = validateTicker({
        symbol: "",
        lastPrice: 63000,
        volume: 28000,
        highPrice: 64000,
        lowPrice: 62000,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("detectGaps", () => {
    const INTERVAL_15M = 15 * 60 * 1000;

    it("returns empty for continuous klines", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 1000 + INTERVAL_15M, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
        { openTime: 1000 + INTERVAL_15M * 2, open: 104, high: 109, low: 99, close: 106, volume: 1200, closeTime: 4000 },
      ];
      const gaps = detectGaps(klines, INTERVAL_15M);
      expect(gaps.length).toBe(0);
    });

    it("detects single gap of 1 candle", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 1000 + INTERVAL_15M * 2, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
      ];
      const gaps = detectGaps(klines, INTERVAL_15M);
      expect(gaps.length).toBe(1);
      expect(gaps[0]!.gapSize).toBe(1);
    });

    it("detects gap of multiple missing candles", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 1000 + INTERVAL_15M * 4, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
      ];
      const gaps = detectGaps(klines, INTERVAL_15M);
      expect(gaps.length).toBe(1);
      expect(gaps[0]!.gapSize).toBe(3);
    });

    it("tolerates small differences within tolerance", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 1000 + INTERVAL_15M + 100, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
      ];
      const gaps = detectGaps(klines, INTERVAL_15M);
      expect(gaps.length).toBe(0);
    });

    it("detects multiple gaps", () => {
      const klines = [
        { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 2000 },
        { openTime: 1000 + INTERVAL_15M * 3, open: 102, high: 107, low: 97, close: 104, volume: 1100, closeTime: 3000 },
        { openTime: 1000 + INTERVAL_15M * 6, open: 104, high: 109, low: 99, close: 106, volume: 1200, closeTime: 4000 },
      ];
      const gaps = detectGaps(klines, INTERVAL_15M);
      expect(gaps.length).toBe(2);
      expect(gaps[0]!.gapSize).toBe(2);
      expect(gaps[1]!.gapSize).toBe(2);
    });
  });

  describe("intervalToMs", () => {
    it("converts minutes", () => {
      expect(intervalToMs("15m")).toBe(15 * 60 * 1000);
      expect(intervalToMs("1m")).toBe(60 * 1000);
      expect(intervalToMs("60m")).toBe(60 * 60 * 1000);
    });

    it("converts hours", () => {
      expect(intervalToMs("1h")).toBe(60 * 60 * 1000);
      expect(intervalToMs("4h")).toBe(4 * 60 * 60 * 1000);
    });

    it("converts days", () => {
      expect(intervalToMs("1d")).toBe(24 * 60 * 60 * 1000);
    });

    it("defaults to 15m for unknown interval", () => {
      expect(intervalToMs("5x")).toBe(15 * 60 * 1000);
    });
  });
});

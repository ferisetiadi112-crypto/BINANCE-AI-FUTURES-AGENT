import { describe, it, expect } from "vitest";
import { validateCandle, validateKlines, validateTicker } from "./validation";

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
});

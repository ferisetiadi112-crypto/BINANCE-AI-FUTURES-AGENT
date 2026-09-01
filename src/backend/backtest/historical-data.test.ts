import { describe, it, expect } from "vitest";
import { validateCandles, deduplicateCandles, createDataset } from "./historical-data";
import type { HistoricalCandle } from "./historical-data";

const createMockCandle = (overrides: Partial<HistoricalCandle> = {}): HistoricalCandle => ({
  symbol: "BTCUSDT",
  interval: "1h",
  openTime: Date.now(),
  closeTime: Date.now() + 3600000,
  open: 63000,
  high: 63500,
  low: 62500,
  close: 63200,
  volume: 1000,
  quoteVolume: 63200000,
  source: "binance-futures",
  ingestionTimestamp: Date.now(),
  ...overrides,
});

describe("Historical Data Engine", () => {
  describe("validateCandles", () => {
    it("returns GOOD status for valid candles", () => {
      const candles = Array.from({ length: 100 }, (_, i) =>
        createMockCandle({
          openTime: Date.now() + i * 3600000,
          open: 63000 + i * 10,
          high: 63500 + i * 10,
          low: 62500 + i * 10,
          close: 63200 + i * 10,
        })
      );

      const result = validateCandles(candles);
      expect(result.overallStatus).toBe("GOOD");
      expect(result.hasGaps).toBe(false);
      expect(result.hasDuplicates).toBe(false);
      expect(result.invalidCandles).toBe(0);
    });

    it("detects duplicates", () => {
      const candles = [
        createMockCandle({ openTime: 1000 }),
        createMockCandle({ openTime: 1000 }), // duplicate
        createMockCandle({ openTime: 2000 }),
      ];

      const result = validateCandles(candles);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateCount).toBe(1);
    });

    it("detects invalid OHLC", () => {
      const candles = [
        createMockCandle({ open: -100 }),
        createMockCandle({ high: 100, low: 200 }), // high < low
      ];

      const result = validateCandles(candles);
      expect(result.invalidOHLC).toBe(2);
    });

    it("detects high < low", () => {
      const candles = [
        createMockCandle({ high: 62000, low: 63000 }),
      ];

      const result = validateCandles(candles);
      expect(result.invalidOHLC).toBe(1);
    });

    it("detects timestamp ordering issues", () => {
      const candles = [
        createMockCandle({ openTime: 2000 }),
        createMockCandle({ openTime: 1000 }), // out of order
      ];

      const result = validateCandles(candles);
      expect(result.timestampOrdering).toBe(false);
    });
  });

  describe("deduplicateCandles", () => {
    it("removes duplicate candles", () => {
      const candles = [
        createMockCandle({ openTime: 1000 }),
        createMockCandle({ openTime: 1000 }),
        createMockCandle({ openTime: 2000 }),
      ];

      const result = deduplicateCandles(candles);
      expect(result.length).toBe(2);
    });
  });

  describe("createDataset", () => {
    it("creates dataset with correct metadata", () => {
      const candles = Array.from({ length: 50 }, (_, i) =>
        createMockCandle({ openTime: Date.now() + i * 3600000 })
      );

      const dataset = createDataset("BTCUSDT", "1h", candles);
      expect(dataset.id).toContain("DATASET-");
      expect(dataset.symbol).toBe("BTCUSDT");
      expect(dataset.interval).toBe("1h");
      expect(dataset.candleCount).toBe(50);
      expect(dataset.qualityStatus).toBe("GOOD");
    });
  });
});

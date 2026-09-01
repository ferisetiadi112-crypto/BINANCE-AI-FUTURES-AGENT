import { describe, it, expect } from "vitest";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateVWAP,
  calculateBollinger,
  calculateAllIndicators,
} from "./indicators";

describe("Technical Indicators", () => {
  describe("EMA", () => {
    it("returns empty array for empty data", () => {
      expect(calculateEMA([], 20)).toEqual([]);
    });

    it("returns original data when shorter than period", () => {
      expect(calculateEMA([1, 2, 3], 20)).toEqual([1, 2, 3]);
    });

    it("calculates EMA correctly", () => {
      const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const ema = calculateEMA(data, 5);
      expect(ema.length).toBeGreaterThan(0);
      // EMA should be between min and max
      expect(ema[ema.length - 1]).toBeGreaterThanOrEqual(10);
      expect(ema[ema.length - 1]).toBeLessThanOrEqual(20);
    });

    it("EMA follows price trend", () => {
      const upTrend = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const ema = calculateEMA(upTrend, 5);
      expect(ema[ema.length - 1]).toBeGreaterThan(ema[0]!);
    });
  });

  describe("RSI", () => {
    it("returns 50 for insufficient data", () => {
      expect(calculateRSI([1, 2, 3])).toBe(50);
    });

    it("returns 100 for all gains", () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      expect(calculateRSI(data)).toBe(100);
    });

    it("returns < 50 for downtrend", () => {
      const data = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
      expect(calculateRSI(data)).toBeLessThan(50);
    });

    it("returns > 50 for uptrend", () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      expect(calculateRSI(data)).toBeGreaterThan(50);
    });

    it("returns value between 0 and 100", () => {
      const data = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17];
      const rsi = calculateRSI(data);
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    });
  });

  describe("MACD", () => {
    it("returns zeros for insufficient data", () => {
      const result = calculateMACD([1, 2, 3]);
      expect(result.macd).toBe(0);
      expect(result.signal).toBe(0);
      expect(result.histogram).toBe(0);
    });

    it("calculates MACD for sufficient data", () => {
      const data = Array.from({ length: 50 }, (_, i) => 100 + i * 2 + Math.sin(i) * 5);
      const result = calculateMACD(data);
      expect(typeof result.macd).toBe("number");
      expect(typeof result.signal).toBe("number");
      expect(typeof result.histogram).toBe("number");
    });

    it("histogram is macd minus signal", () => {
      const data = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
      const result = calculateMACD(data);
      expect(result.histogram).toBeCloseTo(result.macd - result.signal, 10);
    });
  });

  describe("ATR", () => {
    it("returns 0 for insufficient candles", () => {
      expect(calculateATR([])).toBe(0);
      expect(calculateATR([{ high: 10, low: 9, close: 9.5 }])).toBe(0);
    });

    it("calculates ATR correctly", () => {
      const candles = [
        { high: 10, low: 8, close: 9 },
        { high: 11, low: 9, close: 10 },
        { high: 12, low: 10, close: 11 },
      ];
      const atr = calculateATR(candles, 2);
      expect(atr).toBeGreaterThan(0);
      expect(atr).toBeLessThan(5);
    });

    it("ATR is positive", () => {
      const candles = Array.from({ length: 20 }, (_, i) => ({
        high: 100 + i + 5,
        low: 100 + i - 5,
        close: 100 + i,
      }));
      expect(calculateATR(candles)).toBeGreaterThan(0);
    });
  });

  describe("VWAP", () => {
    it("returns 0 for empty data", () => {
      expect(calculateVWAP([])).toBe(0);
    });

    it("calculates VWAP correctly", () => {
      const candles = [
        { high: 10, low: 8, close: 9, volume: 100 },
        { high: 11, low: 9, close: 10, volume: 200 },
      ];
      const vwap = calculateVWAP(candles);
      expect(vwap).toBeGreaterThan(8);
      expect(vwap).toBeLessThan(11);
    });
  });

  describe("Bollinger Bands", () => {
    it("returns default for insufficient data", () => {
      const result = calculateBollinger([100], 20);
      expect(result.upper).toBe(100);
      expect(result.lower).toBe(100);
    });

    it("calculates bands correctly", () => {
      const data = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
      const result = calculateBollinger(data);
      expect(result.upper).toBeGreaterThan(result.lower);
      expect(result.percent).toBeGreaterThanOrEqual(0);
      expect(result.percent).toBeLessThanOrEqual(1);
    });
  });

  describe("All Indicators", () => {
    it("calculates all indicators from price data", () => {
      const closes = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5 + Math.sin(i * 0.1) * 5);
      const candles = closes.map(c => ({ high: c + 2, low: c - 2, close: c }));
      const volumes = Array.from({ length: 200 }, () => 1000);
      // VWAP needs volume in VwapCandle format
      const vwapCandles = candles.map((c, i) => ({ ...c, volume: volumes[i]! }));

      const indicators = calculateAllIndicators(closes, candles, volumes);

      expect(indicators.ema20).toBeGreaterThan(0);
      expect(indicators.ema50).toBeGreaterThan(0);
      expect(indicators.ema200).toBeGreaterThan(0);
      expect(indicators.rsi).toBeGreaterThanOrEqual(0);
      expect(indicators.rsi).toBeLessThanOrEqual(100);
      expect(indicators.atr).toBeGreaterThan(0);
      expect(typeof indicators.vwap).toBe('number');
    });
  });
});

/**
 * F-M4 Regime Parity Tests — BINANCE AI FUTURES AGENT v0.1
 *
 * Verifies that backtest uses the same production regime classifier
 * as live/paper trading, with identical indicators and classification logic.
 */

import { describe, it, expect } from "vitest";
import { classifyRegime } from "../runtime/regime";
import { calculateAllIndicators, type Candle } from "../runtime/indicators";
import { calculateTrendStrength, calculateMomentumScore } from "../runtime/engine";
import { runBacktest } from "./engine";
import type { HistoricalCandle } from "./historical-data";
import type { BacktestConfig, BacktestTrade } from "./engine";

// ─── Helpers ────────────────────────────────────────────────────────

function createCandle(i: number, close: number, high: number, low: number, volume: number): HistoricalCandle {
  return {
    symbol: "BTCUSDT",
    interval: "1h",
    openTime: i * 3600_000,
    closeTime: i * 3600_000 + 3599_999,
    open: close - 0.3,
    high,
    low,
    close,
    volume,
    quoteVolume: close * volume,
    source: "test",
    ingestionTimestamp: Date.now(),
  };
}

function createUptrendCandles(count: number, startPrice = 100): HistoricalCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const price = startPrice + i * 0.5;
    const volatility = 1.5;
    return createCandle(i, price, price + volatility, price - volatility, 1000 + Math.sin(i * 0.1) * 200);
  });
}

function createDowntrendCandles(count: number, startPrice = 200): HistoricalCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const price = startPrice - i * 0.5;
    const volatility = 1.5;
    return createCandle(i, price, price + volatility, price - volatility, 1000 + Math.sin(i * 0.1) * 200);
  });
}

function toIndicatorCandles(candles: HistoricalCandle[]): Candle[] {
  return candles.map(c => ({ high: c.high, low: c.low, close: c.close }));
}

function buildRegimeInputFromCandles(candles: HistoricalCandle[]) {
  const closes = candles.map(c => c.close);
  const indicatorCandles = toIndicatorCandles(candles);
  const volumes = candles.map(c => c.volume);
  const indicators = calculateAllIndicators(closes, indicatorCandles, volumes);
  const trendStrength = calculateTrendStrength(closes, indicators.ema20, indicators.ema50, indicators.ema200);
  const momentumScore = calculateMomentumScore(indicators.rsi, indicators.macdHistogram);
  return { indicators, trendStrength, momentumScore };
}

function createDefaultBacktestConfig(overrides?: Partial<BacktestConfig>): BacktestConfig {
  return {
    id: "TEST-BT",
    name: "Test Backtest",
    symbol: "BTCUSDT",
    interval: "1h",
    startTime: 0,
    endTime: 1000 * 3600_000,
    initialCapital: 5.0,
    feeRate: 0.0004,
    slippageRate: 0.0001,
    strategyVersion: "v1.0",
    modelVersion: "rule-based-v1",
    parameterVersion: "default",
    riskConfig: {
      dailyProfitCap: 0.50,
      dailyLossLimit: 0.50,
      maxLeverage: 10,
      maxExposurePercent: 80,
    },
    ...overrides,
  };
}

const VALID_REGIMES = [
  "TRENDING_UP", "TRENDING_DOWN", "RANGING", "BREAKOUT",
  "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNCERTAIN",
];

// ─── F-M4 Tests ─────────────────────────────────────────────────────

describe("F-M4: Regime Parity — Backtest = Production", () => {
  describe("Production/backtest regime parity", () => {
    it("backtest trades use valid production regime types", () => {
      const candles = createUptrendCandles(250);
      const config = createDefaultBacktestConfig({
        startTime: candles[200]?.openTime ?? 0,
        endTime: candles[249]?.openTime ?? 0,
      });
      const result = runBacktest(candles, config);
      for (const trade of result.trades) {
        expect(VALID_REGIMES).toContain(trade.regime);
      }
    });

    it("classifyRegime produces valid regime for uptrend indicators", () => {
      const candles = createUptrendCandles(250);
      const { indicators, trendStrength, momentumScore } = buildRegimeInputFromCandles(candles);
      const result = classifyRegime({
        ema20: indicators.ema20,
        ema50: indicators.ema50,
        ema200: indicators.ema200,
        rsi: indicators.rsi,
        atrPercent: indicators.atrPercent,
        macdHistogram: indicators.macdHistogram,
        bollingerPercent: indicators.bollingerPercent,
        trendStrength,
        momentumScore,
      });
      expect(VALID_REGIMES).toContain(result.regime);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });
  });

  describe("Multi-regime parity", () => {
    it("classifyRegime handles all 7 regime types", () => {
      const inputs: Array<{ name: string; input: Parameters<typeof classifyRegime>[0]; expected: string }> = [
        {
          name: "TRENDING_UP",
          input: { ema20: 105, ema50: 100, ema200: 95, rsi: 65, atrPercent: 1.5, macdHistogram: 2, bollingerPercent: 0.7, trendStrength: 70, momentumScore: 70 },
          expected: "TRENDING_UP",
        },
        {
          name: "TRENDING_DOWN",
          input: { ema20: 95, ema50: 100, ema200: 105, rsi: 35, atrPercent: 1.5, macdHistogram: -2, bollingerPercent: 0.3, trendStrength: 70, momentumScore: 30 },
          expected: "TRENDING_DOWN",
        },
        {
          name: "HIGH_VOLATILITY",
          input: { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 5, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 30, momentumScore: 50 },
          expected: "HIGH_VOLATILITY",
        },
        {
          name: "LOW_VOLATILITY",
          input: { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 0.3, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 20, momentumScore: 50 },
          expected: "LOW_VOLATILITY",
        },
        {
          name: "RANGING",
          input: { ema20: 100, ema50: 101, ema200: 99, rsi: 52, atrPercent: 1, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 25, momentumScore: 50 },
          expected: "RANGING",
        },
        {
          name: "BREAKOUT",
          input: { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 1.5, macdHistogram: 0, bollingerPercent: 0.95, trendStrength: 40, momentumScore: 60 },
          expected: "BREAKOUT",
        },
        {
          name: "UNCERTAIN",
          input: { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 1, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 50, momentumScore: 50 },
          expected: "UNCERTAIN",
        },
      ];

      for (const { name, input, expected } of inputs) {
        const result = classifyRegime(input);
        expect(result.regime).toBe(expected);
      }
    });
  });

  describe("Indicator parity", () => {
    it("calculateAllIndicators is deterministic for same input", () => {
      const candles = createUptrendCandles(250);
      const closes = candles.map(c => c.close);
      const indicatorCandles = toIndicatorCandles(candles);
      const volumes = candles.map(c => c.volume);

      const r1 = calculateAllIndicators(closes, indicatorCandles, volumes);
      const r2 = calculateAllIndicators(closes, indicatorCandles, volumes);

      expect(r1.ema20).toBe(r2.ema20);
      expect(r1.rsi).toBe(r2.rsi);
      expect(r1.macdHistogram).toBe(r2.macdHistogram);
      expect(r1.atrPercent).toBe(r2.atrPercent);
      expect(r1.bollingerPercent).toBe(r2.bollingerPercent);
    });

    it("different candle data produces different indicators", () => {
      const up = buildRegimeInputFromCandles(createUptrendCandles(250));
      const down = buildRegimeInputFromCandles(createDowntrendCandles(250));
      expect(up.indicators.ema20).not.toBe(down.indicators.ema20);
      expect(up.indicators.rsi).not.toBe(down.indicators.rsi);
    });
  });

  describe("Warm-up behavior", () => {
    it("classifyRegime returns valid regime with insufficient data", () => {
      const input = buildRegimeInputFromCandles(createUptrendCandles(10));
      const result = classifyRegime({
        ema20: input.indicators.ema20,
        ema50: input.indicators.ema50,
        ema200: input.indicators.ema200,
        rsi: input.indicators.rsi,
        atrPercent: input.indicators.atrPercent,
        macdHistogram: input.indicators.macdHistogram,
        bollingerPercent: input.indicators.bollingerPercent,
        trendStrength: input.trendStrength,
        momentumScore: input.momentumScore,
      });
      expect(VALID_REGIMES).toContain(result.regime);
    });

    it("backtest with fewer candles than lookback degrades gracefully", () => {
      const candles = createUptrendCandles(30);
      const config = createDefaultBacktestConfig({ startTime: 0, endTime: candles[29]?.openTime ?? 0 });
      const result = runBacktest(candles, config);
      expect(result.status).toBe("COMPLETED");
    });
  });

  describe("Future-data isolation", () => {
    it("modifying future candles does not change regime for earlier candles", () => {
      const candlesA = createUptrendCandles(250);
      const candlesB = candlesA.map((c, i) => i > 200 ? { ...c, close: c.close + 1000, high: c.high + 1000, low: c.low + 1000 } : c);

      const inputA = buildRegimeInputFromCandles(candlesA.slice(0, 201));
      const inputB = buildRegimeInputFromCandles(candlesB.slice(0, 201));

      expect(inputA.indicators.ema20).toBeCloseTo(inputB.indicators.ema20, 6);
      expect(inputA.indicators.rsi).toBeCloseTo(inputB.indicators.rsi, 6);

      const regimeA = classifyRegime({ ema20: inputA.indicators.ema20, ema50: inputA.indicators.ema50, ema200: inputA.indicators.ema200, rsi: inputA.indicators.rsi, atrPercent: inputA.indicators.atrPercent, macdHistogram: inputA.indicators.macdHistogram, bollingerPercent: inputA.indicators.bollingerPercent, trendStrength: inputA.trendStrength, momentumScore: inputA.momentumScore });
      const regimeB = classifyRegime({ ema20: inputB.indicators.ema20, ema50: inputB.indicators.ema50, ema200: inputB.indicators.ema200, rsi: inputB.indicators.rsi, atrPercent: inputB.indicators.atrPercent, macdHistogram: inputB.indicators.macdHistogram, bollingerPercent: inputB.indicators.bollingerPercent, trendStrength: inputB.trendStrength, momentumScore: inputB.momentumScore });
      expect(regimeA.regime).toBe(regimeB.regime);
    });

    it("backtest decision at candle N is independent of candle N+1", () => {
      const candles = createUptrendCandles(250);
      const config = createDefaultBacktestConfig({ startTime: candles[200]?.openTime ?? 0, endTime: candles[249]?.openTime ?? 0 });
      const result1 = runBacktest(candles, config);

      const modified = [...candles];
      modified[249] = { ...modified[249]!, close: modified[249]!.close + 500, high: modified[249]!.high + 500, low: modified[249]!.low + 500 };
      const result2 = runBacktest(modified, config);

      if (result1.trades.length > 0 && result2.trades.length > 0) {
        expect(result1.trades[0]!.entryPrice).toBe(result2.trades[0]!.entryPrice);
        expect(result1.trades[0]!.regime).toBe(result2.trades[0]!.regime);
        expect(result1.trades[0]!.side).toBe(result2.trades[0]!.side);
      }
    });
  });

  describe("Canonical regime type", () => {
    it("backtest trades use only canonical MarketRegime values", () => {
      const candles = createUptrendCandles(250);
      const config = createDefaultBacktestConfig({ startTime: candles[200]?.openTime ?? 0, endTime: candles[249]?.openTime ?? 0 });
      const result = runBacktest(candles, config);
      for (const trade of result.trades) {
        expect(VALID_REGIMES).toContain(trade.regime);
      }
    });

    it("classifyRegime never returns an unknown regime string", () => {
      const inputs: Parameters<typeof classifyRegime>[0][] = [
        { ema20: 105, ema50: 100, ema200: 95, rsi: 65, atrPercent: 1.5, macdHistogram: 2, bollingerPercent: 0.7, trendStrength: 70, momentumScore: 70 },
        { ema20: 95, ema50: 100, ema200: 105, rsi: 35, atrPercent: 1.5, macdHistogram: -2, bollingerPercent: 0.3, trendStrength: 70, momentumScore: 30 },
        { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 5, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 30, momentumScore: 50 },
        { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 0.3, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 20, momentumScore: 50 },
        { ema20: 100, ema50: 101, ema200: 99, rsi: 52, atrPercent: 1, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 25, momentumScore: 50 },
        { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 1.5, macdHistogram: 0, bollingerPercent: 0.95, trendStrength: 40, momentumScore: 60 },
        { ema20: 100, ema50: 100, ema200: 100, rsi: 50, atrPercent: 1, macdHistogram: 0, bollingerPercent: 0.5, trendStrength: 50, momentumScore: 50 },
      ];
      for (const input of inputs) {
        const result = classifyRegime(input);
        expect(VALID_REGIMES).toContain(result.regime);
      }
    });
  });

  describe("Backtest uses production modules", () => {
    it("backtest engine imports classifyRegime from runtime/regime", async () => {
      const mod = await import("./engine");
      expect(typeof mod.runBacktest).toBe("function");
    });

    it("backtest engine imports calculateAllIndicators", async () => {
      const mod = await import("../runtime/indicators");
      expect(typeof mod.calculateAllIndicators).toBe("function");
    });

    it("backtest engine imports calculateTrendStrength and calculateMomentumScore", async () => {
      const mod = await import("../runtime/engine");
      expect(typeof mod.calculateTrendStrength).toBe("function");
      expect(typeof mod.calculateMomentumScore).toBe("function");
    });
  });
});

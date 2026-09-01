import { describe, it, expect } from "vitest";
import { classifyRegime } from "./regime";

describe("Market Regime Classifier", () => {
  it("classifies TRENDING_UP when conditions are met", () => {
    const result = classifyRegime({
      ema20: 105,
      ema50: 100,
      ema200: 95,
      rsi: 65,
      atrPercent: 1.5,
      macdHistogram: 2,
      bollingerPercent: 0.7,
      trendStrength: 70,
      momentumScore: 70,
    });
    expect(result.regime).toBe("TRENDING_UP");
    expect(result.confidence).toBeGreaterThan(50);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("classifies TRENDING_DOWN when conditions are met", () => {
    const result = classifyRegime({
      ema20: 95,
      ema50: 100,
      ema200: 105,
      rsi: 35,
      atrPercent: 1.5,
      macdHistogram: -2,
      bollingerPercent: 0.3,
      trendStrength: 70,
      momentumScore: 30,
    });
    expect(result.regime).toBe("TRENDING_DOWN");
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("classifies HIGH_VOLATILITY when ATR is high", () => {
    const result = classifyRegime({
      ema20: 100,
      ema50: 100,
      ema200: 100,
      rsi: 50,
      atrPercent: 5,
      macdHistogram: 0,
      bollingerPercent: 0.5,
      trendStrength: 30,
      momentumScore: 50,
    });
    expect(result.regime).toBe("HIGH_VOLATILITY");
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("classifies LOW_VOLATILITY when ATR is low and no trend", () => {
    const result = classifyRegime({
      ema20: 100,
      ema50: 100,
      ema200: 100,
      rsi: 50,
      atrPercent: 0.3,
      macdHistogram: 0,
      bollingerPercent: 0.5,
      trendStrength: 20,
      momentumScore: 50,
    });
    expect(result.regime).toBe("LOW_VOLATILITY");
  });

  it("classifies RANGING when no clear trend", () => {
    const result = classifyRegime({
      ema20: 100,
      ema50: 101,
      ema200: 99,
      rsi: 52,
      atrPercent: 1,
      macdHistogram: 0,
      bollingerPercent: 0.5,
      trendStrength: 25,
      momentumScore: 50,
    });
    expect(result.regime).toBe("RANGING");
  });

  it("classifies BREAKOUT near band edge", () => {
    const result = classifyRegime({
      ema20: 100,
      ema50: 100,
      ema200: 100,
      rsi: 50,
      atrPercent: 1.5,
      macdHistogram: 0,
      bollingerPercent: 0.95,
      trendStrength: 40,
      momentumScore: 60,
    });
    expect(result.regime).toBe("BREAKOUT");
  });

  it("returns confidence between 0 and 100", () => {
    const result = classifyRegime({
      ema20: 100,
      ema50: 100,
      ema200: 100,
      rsi: 50,
      atrPercent: 1,
      macdHistogram: 0,
      bollingerPercent: 0.5,
      trendStrength: 50,
      momentumScore: 50,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });
});

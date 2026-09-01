import { describe, it, expect, beforeEach } from "vitest";
import { PaperTradingEngine } from "./engine";
import type { AiDecision } from "../ai/types";

const longDecision: AiDecision = {
  id: "DEC-TEST-001",
  timestamp: Date.now(),
  symbol: "BTCUSDT",
  direction: "LONG",
  confidence: 0.75,
  confidenceLevel: "HIGH",
  strategy: "TREND_FOLLOWING",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  evidence: {
    trend: "UP",
    momentum: "STRONG",
    volume: "28000",
    volatility: "500",
    structure: "HIGHER_HIGHS",
    regime: "TRENDING_UP",
    regimeConfidence: 74,
    indicators: { rsi: 65, ema20: 63000, ema50: 62500, macd: 150, atr: 500 },
  },
  decisionVersion: "1.0.0",
  modelVersion: "rule-based-v1",
};

const noTradeDecision: AiDecision = {
  ...longDecision,
  id: "DEC-TEST-002",
  direction: "NO_TRADE",
};

describe("Paper Trading Engine", () => {
  let engine: PaperTradingEngine;

  beforeEach(() => {
    engine = new PaperTradingEngine({
      initialCapital: 5.0,
      simulatedFeeRate: 0.0004,
      simulatedSlippageRate: 0.0001,
      defaultLeverage: 5,
      positionSizePercent: 20,
    });
  });

  describe("execute", () => {
    it("executes LONG order", () => {
      const order = engine.execute(longDecision, 63000);
      expect(order).not.toBeNull();
      expect(order!.side).toBe("BUY");
      expect(order!.symbol).toBe("BTCUSDT");
      expect(order!.status).toBe("FILLED");
      expect(order!.simulatedFee).toBeGreaterThan(0);
      expect(order!.simulatedSlippage).toBeGreaterThan(0);
    });

    it("skips NO_TRADE", () => {
      const order = engine.execute(noTradeDecision, 63000);
      expect(order).toBeNull();
    });

    it("creates position after execution", () => {
      engine.execute(longDecision, 63000);
      const position = engine.getPosition();
      expect(position).not.toBeNull();
      expect(position!.side).toBe("LONG");
      expect(position!.symbol).toBe("BTCUSDT");
      expect(position!.leverage).toBe(5);
    });

    it("deducts margin from capital", () => {
      const initialCapital = engine.getCapital();
      engine.execute(longDecision, 63000);
      expect(engine.getCapital()).toBeLessThan(initialCapital);
    });

    it("skips if already in position", () => {
      engine.execute(longDecision, 63000);
      const order = engine.execute(longDecision, 63000);
      expect(order).toBeNull();
    });
  });

  describe("updatePosition", () => {
    it("updates unrealized PnL for LONG", () => {
      engine.execute(longDecision, 63000);
      engine.updatePosition(63500);
      const position = engine.getPosition();
      expect(position!.unrealizedPnl).toBeGreaterThan(0);
    });

    it("triggers stop loss", () => {
      engine.execute(longDecision, 63000);
      engine.updatePosition(61000); // Below stop loss
      const position = engine.getPosition();
      expect(position).toBeNull(); // Position closed
      expect(engine.getTrades().length).toBe(1);
    });

    it("triggers take profit", () => {
      engine.execute(longDecision, 63000);
      engine.updatePosition(66000); // Above take profit
      const position = engine.getPosition();
      expect(position).toBeNull(); // Position closed
      expect(engine.getTrades().length).toBe(1);
    });
  });

  describe("closePosition", () => {
    it("closes position and records trade", () => {
      engine.execute(longDecision, 63000);
      const trade = engine.closePosition(63500, "MANUAL");
      expect(trade).not.toBeNull();
      expect(trade!.pnl).toBeGreaterThan(0);
      expect(trade!.fees).toBeGreaterThan(0);
      expect(engine.getPosition()).toBeNull();
    });

    it("returns margin to capital", () => {
      engine.execute(longDecision, 63000);
      const capitalAfterEntry = engine.getCapital();
      engine.closePosition(63500, "MANUAL");
      expect(engine.getCapital()).toBeGreaterThan(capitalAfterEntry);
    });
  });

  describe("getStats", () => {
    it("returns correct stats with no trades", () => {
      const stats = engine.getStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.capital).toBe(5.0);
      expect(stats.winRate).toBe(0);
    });

    it("returns correct stats after trades", () => {
      engine.execute(longDecision, 63000);
      engine.closePosition(63500, "TP");
      const stats = engine.getStats();
      expect(stats.totalTrades).toBe(1);
      expect(stats.winRate).toBe(100);
      expect(stats.totalPnl).toBeGreaterThan(0);
    });

    it("tracks fees", () => {
      engine.execute(longDecision, 63000);
      engine.closePosition(63500, "TP");
      const stats = engine.getStats();
      expect(stats.totalFees).toBeGreaterThan(0);
    });
  });

  describe("SHORT position", () => {
    it("executes SHORT order", () => {
      const shortDecision = { ...longDecision, direction: "SHORT" as const };
      const order = engine.execute(shortDecision, 63000);
      expect(order).not.toBeNull();
      expect(order!.side).toBe("SELL");
    });

    it("SHORT position profits on price drop", () => {
      const shortDecision = { ...longDecision, direction: "SHORT" as const };
      engine.execute(shortDecision, 63000);
      engine.updatePosition(62500);
      const position = engine.getPosition();
      expect(position!.unrealizedPnl).toBeGreaterThan(0);
    });
  });
});

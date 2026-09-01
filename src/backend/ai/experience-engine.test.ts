import { describe, it, expect, beforeEach } from "vitest";
import { recordTradeExperience, recordNoTradeExperience } from "./experience-engine";
import type { AiDecision, PaperTrade } from "./types";
import type { MarketState } from "../runtime/types";
import { getDatabase } from "../database";

const mockMarketState: MarketState = {
  symbol: "BTCUSDT",
  timestamp: Date.now(),
  price: 63000,
  priceChange24h: 500,
  priceChangePercent24h: 0.8,
  trend: "UP",
  trendStrength: 75,
  momentum: "STRONG",
  momentumScore: 80,
  volatility: 500,
  volatilityPercent: 0.8,
  volume24h: 28000,
  volumeChange: 15,
  marketStructure: "HIGHER_HIGHS",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  liquidity: 80,
  dataQuality: "GOOD",
  feedStatus: "ONLINE",
  lastUpdate: Date.now(),
  dataAge: 1000,
};

const mockDecision: AiDecision = {
  id: "DEC-TEST-EXP-001",
  timestamp: Date.now(),
  symbol: "BTCUSDT",
  direction: "LONG",
  confidence: 0.75,
  confidenceLevel: "HIGH",
  strategy: "TREND_FOLLOWING",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  evidence: {
    trend: "UP (strength: 75)",
    momentum: "STRONG (score: 80)",
    volume: "24h: 28000",
    volatility: "ATR: 500",
    structure: "HIGHER_HIGHS",
    regime: "TRENDING_UP",
    regimeConfidence: 74,
    indicators: { rsi: 65, ema20: 63000, ema50: 62500, macd: 150, atr: 500 },
  },
  decisionVersion: "1.0.0",
  modelVersion: "rule-based-v1",
};

const mockTrade: PaperTrade = {
  id: "PAPER-TRD-EXP-001",
  symbol: "BTCUSDT",
  side: "LONG",
  entryPrice: 63000,
  exitPrice: 63500,
  quantity: 0.0001,
  pnl: 0.05,
  pnlPercent: 1.5,
  fees: 0.025,
  slippage: 0.006,
  duration: 3600000,
  strategy: "TREND_FOLLOWING",
  decisionId: "DEC-TEST-EXP-001",
  openedAt: Date.now() - 3600000,
  closedAt: Date.now(),
};

describe("Experience Engine", () => {
  describe("recordTradeExperience", () => {
    it("records a winning trade experience", () => {
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = recordTradeExperience(mockDecision, mockMarketState, mockTrade, riskResult);

      expect(experience).toBeDefined();
      expect(experience.id).toContain("EXP-");
      expect(experience.decisionId).toBe("DEC-TEST-EXP-001");
      expect(experience.tradeId).toBe("PAPER-TRD-EXP-001");
      expect(experience.symbol).toBe("BTCUSDT");
      expect(experience.direction).toBe("LONG");
      expect(experience.confidence).toBe(0.75);
      expect(experience.outcome).toBe("WIN");
      expect(experience.netPnl).toBe(0.05);
      expect(experience.marketContext).toBeDefined();
      expect(experience.marketContext.symbol).toBe("BTCUSDT");
    });

    it("records a losing trade experience", () => {
      const losingTrade = { ...mockTrade, id: "PAPER-TRD-EXP-002", pnl: -0.03 };
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = recordTradeExperience(
        { ...mockDecision, id: "DEC-TEST-EXP-002" },
        mockMarketState,
        losingTrade,
        riskResult,
      );

      expect(experience.outcome).toBe("LOSS");
      expect(experience.netPnl).toBe(-0.03);
    });

    it("records a breakeven trade experience", () => {
      const breakevenTrade = { ...mockTrade, id: "PAPER-TRD-EXP-003", pnl: 0 };
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = recordTradeExperience(
        { ...mockDecision, id: "DEC-TEST-EXP-003" },
        mockMarketState,
        breakevenTrade,
        riskResult,
      );

      expect(experience.outcome).toBe("BREAKEVEN");
      expect(experience.netPnl).toBe(0);
    });

    it("records a cancelled experience when risk rejects", () => {
      const riskResult = { approved: false, reason: "Daily loss limit reached" };
      const experience = recordTradeExperience(
        { ...mockDecision, id: "DEC-TEST-EXP-004" },
        mockMarketState,
        null,
        riskResult,
      );

      expect(experience.outcome).toBe("CANCELLED");
      expect(experience.tradeId).toBeNull();
    });

    it("captures full market context", () => {
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = recordTradeExperience(mockDecision, mockMarketState, mockTrade, riskResult);

      expect(experience.marketContext.price).toBe(63000);
      expect(experience.marketContext.trend).toBe("UP");
      expect(experience.marketContext.momentum).toBe("STRONG");
      expect(experience.marketContext.marketRegime).toBe("TRENDING_UP");
      expect(experience.marketContext.dataQuality).toBe("GOOD");
      expect(experience.marketContext.feedStatus).toBe("ONLINE");
    });
  });

  describe("recordNoTradeExperience", () => {
    it("records a no-trade experience", () => {
      const noTradeDecision = { ...mockDecision, id: "DEC-TEST-NT-001", direction: "NO_TRADE" as const, confidence: 0.2 };
      const riskResult = { approved: true, reason: "NO_TRADE — no action required" };
      const experience = recordNoTradeExperience(noTradeDecision, mockMarketState, riskResult);

      expect(experience).toBeDefined();
      expect(experience.direction).toBe("NO_TRADE");
      expect(experience.outcome).toBe("NO_TRADE_SKIPPED");
      expect(experience.tradeId).toBeNull();
      expect(experience.confidence).toBe(0.2);
    });

    it("records no-trade when risk rejects", () => {
      const noTradeDecision = { ...mockDecision, id: "DEC-TEST-NT-002", direction: "NO_TRADE" as const };
      const riskResult = { approved: false, reason: "System locked" };
      const experience = recordNoTradeExperience(noTradeDecision, mockMarketState, riskResult);

      expect(experience.outcome).toBe("NO_TRADE_RISK_REJECTED");
    });

    it("captures market context for no-trade", () => {
      const noTradeDecision = { ...mockDecision, id: "DEC-TEST-NT-003", direction: "NO_TRADE" as const, confidence: 0.15 };
      const riskResult = { approved: true, reason: "NO_TRADE" };
      const experience = recordNoTradeExperience(noTradeDecision, mockMarketState, riskResult);

      expect(experience.marketContext).toBeDefined();
      expect(experience.marketContext.symbol).toBe("BTCUSDT");
      expect(experience.marketContext.marketRegime).toBe("TRENDING_UP");
    });
  });
});

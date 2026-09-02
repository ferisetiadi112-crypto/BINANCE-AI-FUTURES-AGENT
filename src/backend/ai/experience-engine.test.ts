import { describe, it, expect, beforeEach } from "vitest";
import { recordTradeExperience, recordNoTradeExperience } from "./experience-engine";
import type { AiDecision, PaperTrade } from "./types";
import type { MarketState } from "../runtime/types";
import { getDatabase } from "../database";

// Helper to create in-memory test database
const createTestDatabase = () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  // Create necessary tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_experiences (
      id TEXT PRIMARY KEY,
      decision_id TEXT,
      trade_id TEXT,
      symbol TEXT,
      timestamp INTEGER,
      market_regime TEXT,
      strategy TEXT,
      direction TEXT,
      confidence REAL,
      entry_price REAL,
      exit_price REAL,
      duration INTEGER,
      fees REAL,
      slippage REAL,
      gross_pnl REAL,
      net_pnl REAL,
      outcome TEXT,
      market_context TEXT,
      decision_version TEXT,
      model_version TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
};

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
    it("records a winning trade experience", async () => {
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = await recordTradeExperience(mockDecision, mockMarketState, mockTrade, riskResult);

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

    it("records a losing trade experience", async () => {
      const losingTrade = { ...mockTrade, id: "PAPER-TRD-EXP-002", pnl: -0.03 };
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = await recordTradeExperience(
        { ...mockDecision, id: "DEC-TEST-EXP-002" },
        mockMarketState,
        losingTrade,
        riskResult,
      );

      expect(experience.outcome).toBe("LOSS");
      expect(experience.netPnl).toBe(-0.03);
    });

    it("records a breakeven trade experience", async () => {
      const breakevenTrade = { ...mockTrade, id: "PAPER-TRD-EXP-003", pnl: 0 };
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = await recordTradeExperience(
        { ...mockDecision, id: "DEC-TEST-EXP-003" },
        mockMarketState,
        breakevenTrade,
        riskResult,
      );

      expect(experience.outcome).toBe("BREAKEVEN");
      expect(experience.netPnl).toBe(0);
    });

    it("records a cancelled experience when risk rejects", async () => {
      const riskResult = { approved: false, reason: "Daily loss limit reached" };
      const experience = await recordTradeExperience(
        { ...mockDecision, id: "DEC-TEST-EXP-004" },
        mockMarketState,
        null,
        riskResult,
      );

      expect(experience.outcome).toBe("CANCELLED");
      expect(experience.tradeId).toBeNull();
    });

    it("captures full market context", async () => {
      const riskResult = { approved: true, reason: "All checks passed" };
      const experience = await recordTradeExperience(mockDecision, mockMarketState, mockTrade, riskResult);

      expect(experience.marketContext.price).toBe(63000);
      expect(experience.marketContext.trend).toBe("UP");
      expect(experience.marketContext.momentum).toBe("STRONG");
      expect(experience.marketContext.marketRegime).toBe("TRENDING_UP");
      expect(experience.marketContext.dataQuality).toBe("GOOD");
      expect(experience.marketContext.feedStatus).toBe("ONLINE");
    });
  });

  describe("recordNoTradeExperience", () => {
    it("records a no-trade experience", async () => {
      const noTradeDecision = { ...mockDecision, id: "DEC-TEST-NT-001", direction: "NO_TRADE" as const, confidence: 0.2 };
      const riskResult = { approved: true, reason: "NO_TRADE — no action required" };
      const experience = await recordNoTradeExperience(noTradeDecision, mockMarketState, riskResult);

      expect(experience).toBeDefined();
      expect(experience.direction).toBe("NO_TRADE");
      expect(experience.outcome).toBe("NO_TRADE_SKIPPED");
      expect(experience.tradeId).toBeNull();
      expect(experience.confidence).toBe(0.2);
    });

    it("records no-trade when risk rejects", async () => {
      const noTradeDecision = { ...mockDecision, id: "DEC-TEST-NT-002", direction: "NO_TRADE" as const };
      const riskResult = { approved: false, reason: "System locked" };
      const experience = await recordNoTradeExperience(noTradeDecision, mockMarketState, riskResult);

      expect(experience.outcome).toBe("NO_TRADE_RISK_REJECTED");
    });

    it("captures market context for no-trade", async () => {
      const noTradeDecision = { ...mockDecision, id: "DEC-TEST-NT-003", direction: "NO_TRADE" as const, confidence: 0.15 };
      const riskResult = { approved: true, reason: "NO_TRADE" };
      const experience = await recordNoTradeExperience(noTradeDecision, mockMarketState, riskResult);

      expect(experience.marketContext).toBeDefined();
      expect(experience.marketContext.symbol).toBe("BTCUSDT");
      expect(experience.marketContext.marketRegime).toBe("TRENDING_UP");
    });
  });
});

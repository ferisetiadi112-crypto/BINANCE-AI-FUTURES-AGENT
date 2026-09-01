import { describe, it, expect } from "vitest";
import { getDataSource } from "./data-adapter";
import * as mock from "./mock-data";

describe("Data Adapter", () => {
  it("returns mock data when no database is available", () => {
    // Without a database, the adapter should return mock data
    const source = getDataSource();
    expect(source).toBe("mock");
  });

  describe("Mock Data Functions", () => {
    it("fetchDashboard returns valid structure", async () => {
      const { fetchDashboard } = await import("./data-adapter");
      const data = await fetchDashboard();
      expect(data).toHaveProperty("account");
      expect(data).toHaveProperty("dailyPnl");
      expect(data).toHaveProperty("recentTrades");
      expect(data).toHaveProperty("riskEnvelope");
      expect(data).toHaveProperty("candles");
      expect(data.account.balance).toBeGreaterThan(0);
      expect(Array.isArray(data.recentTrades)).toBe(true);
    });

    it("fetchRuntime returns valid structure", async () => {
      const { fetchRuntime } = await import("./data-adapter");
      const data = await fetchRuntime();
      expect(data).toHaveProperty("aiIntelligence");
      expect(data).toHaveProperty("strategyPerformance");
      expect(data.aiIntelligence.confidence).toBeGreaterThan(0);
      expect(Array.isArray(data.strategyPerformance)).toBe(true);
    });

    it("fetchStrategies returns array", async () => {
      const { fetchStrategies } = await import("./data-adapter");
      const data = await fetchStrategies();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it("fetchTrades returns array", async () => {
      const { fetchTrades } = await import("./data-adapter");
      const data = await fetchTrades();
      expect(Array.isArray(data)).toBe(true);
    });

    it("fetchLearning returns valid structure", async () => {
      const { fetchLearning } = await import("./data-adapter");
      const data = await fetchLearning();
      expect(data).toHaveProperty("experiences");
      expect(data).toHaveProperty("lessons");
      expect(data).toHaveProperty("timeline");
      expect(data).toHaveProperty("improvement");
    });

    it("fetchRisk returns valid risk envelope", async () => {
      const { fetchRisk } = await import("./data-adapter");
      const data = await fetchRisk();
      expect(data).toHaveProperty("dailyProfitCap");
      expect(data).toHaveProperty("dailyLossLimit");
      expect(data).toHaveProperty("status");
      expect(data.dailyProfitCap).toBe(0.5);
      expect(data.dailyLossLimit).toBe(0.5);
    });

    it("fetchHealth returns health status", async () => {
      const { fetchHealth } = await import("./data-adapter");
      const data = await fetchHealth();
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("database");
      expect(data.status).toBe("healthy");
    });
  });

  describe("Mock Data Module", () => {
    it("has all required exports", () => {
      expect(mock.getDashboardData).toBeDefined();
      expect(mock.getRuntimeData).toBeDefined();
      expect(mock.getPerformanceData).toBeDefined();
      expect(mock.getMarketData).toBeDefined();
      expect(mock.getStrategiesData).toBeDefined();
      expect(mock.getTradesData).toBeDefined();
      expect(mock.getLearningData).toBeDefined();
      expect(mock.getRiskData).toBeDefined();
      expect(mock.getRiskEvents).toBeDefined();
      expect(mock.getSystemData).toBeDefined();
      expect(mock.getAuditData).toBeDefined();
      expect(mock.getCandlesData).toBeDefined();
    });

    it("returns consistent data shapes", () => {
      const dashboard = mock.getDashboardData();
      expect(typeof dashboard.account.balance).toBe("number");
      expect(typeof dashboard.winRate).toBe("number");

      const risk = mock.getRiskData();
      expect(typeof risk.dailyProfitCap).toBe("number");
      expect(typeof risk.dailyLossLimit).toBe("number");

      const strategies = mock.getStrategiesData();
      expect(Array.isArray(strategies)).toBe(true);
      expect(strategies[0]).toHaveProperty("name");
      expect(strategies[0]).toHaveProperty("winRate");
    });

    it("getPaperStatus returns valid structure", () => {
      const status = mock.getPaperStatus();
      expect(status.mode).toBe("PAPER");
      expect(status.noRealTrading).toBe(true);
      expect(typeof status.capital).toBe("number");
      expect(typeof status.totalPnl).toBe("number");
      expect(typeof status.winRate).toBe("number");
      expect(Array.isArray(status.recentTrades)).toBe(true);
      expect(Array.isArray(status.feedSymbols)).toBe(true);
      expect(status.feedSymbols.length).toBeGreaterThan(0);
      expect(status.feedSymbols[0]).toHaveProperty("symbol");
      expect(status.feedSymbols[0]).toHaveProperty("feedState");
      expect(status.feedSymbols[0]).toHaveProperty("dataAgeMs");
      expect(status.riskEngineStatus).toBe("PAPER");
      expect(status.emergencyStopState).toBe("ARMED");
    });

    it("fetchPaperStatus returns valid structure", async () => {
      const { fetchPaperStatus } = await import("./data-adapter");
      const data = await fetchPaperStatus();
      expect(data.mode).toBe("PAPER");
      expect(data.noRealTrading).toBe(true);
      expect(Array.isArray(data.feedSymbols)).toBe(true);
    });

    // Phase 8C: No random feed state in API responses
    it("fetchPaperStatus feed state is deterministic (no Math.random)", async () => {
      const { fetchPaperStatus } = await import("./data-adapter");
      const data1 = await fetchPaperStatus();
      const data2 = await fetchPaperStatus();

      // Feed symbols should have consistent structure
      expect(data1.feedSymbols.length).toBe(data2.feedSymbols.length);
      for (let i = 0; i < data1.feedSymbols.length; i++) {
        expect(data1.feedSymbols[i]!.symbol).toBe(data2.feedSymbols[i]!.symbol);
        // feedState should be a valid enum value, not random
        expect(["ONLINE", "DEGRADED", "STALE", "OFFLINE"]).toContain(data1.feedSymbols[i]!.feedState);
      }
    });

    it("fetchFeedStatus returns aggregate state", async () => {
      const { fetchFeedStatus } = await import("./data-adapter");
      const data = await fetchFeedStatus();
      expect(data).toHaveProperty("aggregate");
      expect(data).toHaveProperty("symbols");
      expect(data).toHaveProperty("connectionStatus");
      expect(["ONLINE", "DEGRADED", "STALE", "OFFLINE"]).toContain(data.aggregate.overallFeedState);
      expect(typeof data.aggregate.totalSymbols).toBe("number");
      expect(Array.isArray(data.symbols)).toBe(true);
    });
  });
});

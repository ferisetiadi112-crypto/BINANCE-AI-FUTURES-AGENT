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
  });
});

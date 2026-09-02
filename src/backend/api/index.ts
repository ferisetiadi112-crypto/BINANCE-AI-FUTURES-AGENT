/**
 * API Server Functions — BINANCE AI FUTURES AGENT v0.1
 *
 * 11 API endpoints consumed by the Lovable dashboard frontend.
 * Uses TanStack Start createServerFn for type-safe server calls.
 *
 * All endpoints return ApiResponse<T> with timestamp and data source.
 * Currently powered by mock data adapter; future phases swap in
 * database and live data sources.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  fetchDashboard,
  fetchRuntime,
  fetchPerformance,
  fetchMarket,
  fetchStrategies,
  fetchTrades,
  fetchLearning,
  fetchExperiments,
  fetchRisk,
  fetchRiskEvents,
  fetchSystem,
  fetchAudit,
  fetchCandles,
  fetchHealth,
  fetchPaperStatus,
  fetchFeedStatus,
  generateRealtimeMarketState,
  getDataSource,
} from "../services/data-adapter";
import { getRuntimeSnapshot } from "../trading/runtime";
import { getProviderRegistry } from "../ai/llm/providers";
import { walletRepository } from "../repositories/wallet";
import { getTestnetExecutor } from "../exchange/testnet-executor";
import { isTestnetConfigured } from "../exchange/binance-testnet";
import type { ApiResponse, LLMStatusResponse } from "../../types/api";

function wrap<T>(data: T): ApiResponse<T> {
  return {
    data,
    timestamp: new Date().toISOString(),
    source: getDataSource(),
  };
}

// ─── GET /api/dashboard ───────────────────────────────────────────────

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchDashboard();
    return wrap(data);
  },
);

// ─── GET /api/runtime ─────────────────────────────────────────────────

export const getRuntime = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchRuntime();
    return wrap(data);
  },
);

// ─── GET /api/performance ─────────────────────────────────────────────

export const getPerformance = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchPerformance();
    return wrap(data);
  },
);

// ─── GET /api/market ──────────────────────────────────────────────────

export const getMarket = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchMarket();
    return wrap(data);
  },
);

// ─── GET /api/strategies ──────────────────────────────────────────────

export const getStrategies = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchStrategies();
    return wrap(data);
  },
);

// ─── GET /api/trades ──────────────────────────────────────────────────

export const getTrades = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchTrades();
    return wrap(data);
  },
);

// ─── GET /api/learning ────────────────────────────────────────────────

export const getLearning = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchLearning();
    return wrap(data);
  },
);

// ─── GET /api/experiments ─────────────────────────────────────────────

export const getExperiments = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchExperiments();
    return wrap(data);
  },
);

// ─── GET /api/risk ────────────────────────────────────────────────────

export const getRisk = createServerFn({ method: "GET" }).handler(
  async () => {
    const [risk, events] = await Promise.all([
      fetchRisk(),
      fetchRiskEvents(),
    ]);
    return wrap({ ...risk, events });
  },
);

// ─── GET /api/audit ───────────────────────────────────────────────────

export const getAudit = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchAudit();
    return wrap(data);
  },
);

// ─── GET /api/system ──────────────────────────────────────────────────

export const getSystem = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchSystem();
    return wrap(data);
  },
);

// ─── GET /api/health ──────────────────────────────────────────────────

export const getHealth = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchHealth();
    return wrap(data);
  },
);

// ─── GET /api/paper-status ───────────────────────────────────────────

export const getPaperStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchPaperStatus();
    return wrap(data);
  },
);

// ─── GET /api/feed-status ──────────────────────────────────────────

export const getFeedStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const data = await fetchFeedStatus();
    return wrap(data);
  },
);

// ─── GET /api/market-snapshot ─────────────────────────────────────

export const getMarketSnapshot = createServerFn({ method: "GET" })
  .validator((symbol: string) => symbol)
  .handler(async ({ data: symbol }) => {
    const state = generateRealtimeMarketState(symbol);
    return wrap(state);
  });

// ─── GET /api/runtime-status ─────────────────────────────────────

export const getRuntimeStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const snapshot = getRuntimeSnapshot();
    return wrap(snapshot);
  },
);

// ─── GET /api/llm-status ───────────────────────────────────────

export const getLLMStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const providers = getProviderRegistry();
    return wrap({
      providers: providers.map((p) => ({
        name: p.name,
        configured: p.isConfigured(),
      })),
      routerConfig: {
        fallbackEnabled: true,
        totalProviders: providers.length,
        configuredProviders: providers.filter((p) => p.isConfigured()).length,
      },
    });
  },
);

// ─── GET /api/wallet-status ─────────────────────────────────────────

export const getWalletStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const status = walletRepository.getStatus();
    return wrap(status);
  },
);

// ─── POST /api/wallet-top-up ────────────────────────────────────────

export const topUpWallet = createServerFn({ method: "POST" })
  .validator((input: { amount: number; note?: string }) => input)
  .handler(async ({ data }) => {
    const newBalance = walletRepository.topUp(data.amount, data.note || "Boss top-up");
    walletRepository.logGuardrailEvent(
      "WALLET_MODIFIED",
      "INFO",
      `Boss topped up $${data.amount.toFixed(2)} — New balance: $${newBalance.toFixed(2)}`,
      { type: "TOP_UP", amount: data.amount, note: data.note },
      newBalance,
    );
    return wrap({ balance: newBalance });
  },
);

// ─── POST /api/wallet-withdraw ──────────────────────────────────────

export const withdrawFromWallet = createServerFn({ method: "POST" })
  .validator((input: { amount: number; note?: string }) => input)
  .handler(async ({ data }) => {
    const newBalance = walletRepository.withdraw(data.amount, data.note || "Boss withdrawal");
    walletRepository.logGuardrailEvent(
      "WALLET_MODIFIED",
      "INFO",
      `Boss withdrew $${data.amount.toFixed(2)} — New balance: $${newBalance.toFixed(2)}`,
      { type: "WITHDRAW", amount: data.amount, note: data.note },
      newBalance,
    );
    return wrap({ balance: newBalance });
  },
);

// ─── GET /api/audit-trail ───────────────────────────────────────────

export const getAuditTrail = createServerFn({ method: "GET" }).handler(
  async () => {
    const trail = walletRepository.getAuditTrail(50);
    return wrap({ events: trail });
  },
);

// ─── GET /api/testnet-status ───────────────────────────────────────

export const getTestnetStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const executor = getTestnetExecutor();
    const configured = isTestnetConfigured();
    let connected = false;
    let balance = 0;
    let positions: Array<{
      symbol: string;
      side: string;
      size: number;
      entryPrice: number;
      markPrice: number;
      unrealizedPnl: number;
      leverage: number;
    }> = [];

    if (configured) {
      const client = executor.getClient();
      if (client) {
        connected = client.isConnected();
        if (connected) {
          try {
            const snapshot = await executor.getAccountSnapshot();
            balance = snapshot.balance;
            positions = snapshot.positions;
          } catch {
            // Account query failed — still report connection status
          }
        }
      }
    }

    return wrap({
      configured,
      connected,
      balance,
      positions,
      paperTrading: process.env["PAPER_TRADING"] !== "false",
    });
  },
);

// ─── POST /api/testnet-sync-balance ────────────────────────────────

export const syncTestnetBalance = createServerFn({ method: "POST" }).handler(
  async () => {
    const executor = getTestnetExecutor();
    const newBalance = await executor.syncBalance();
    return wrap({ balance: newBalance });
  },
);

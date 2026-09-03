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
import { getJournalEvents, getRecentJournalEvents, type JournalEventType, type JournalImportance } from "../journal";
import { getReviews } from "../journal/post-trade-review";
import { getOrchestrator } from "../trading/runtime";
import type { ApiResponse, LLMStatusResponse } from "../../types/api";
import { bossGuardMiddleware } from "../auth/middleware";
import { createSessionToken, createSessionCookie, createClearSessionCookie } from "../auth";

async function wrap<T>(data: T): Promise<ApiResponse<T>> {
  return {
    data,
    timestamp: new Date().toISOString(),
    source: await getDataSource(),
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

// ─── POST /api/auth/login ───────────────────────────────────────────
// Dev-only login endpoint. Creates a signed session cookie.
// In production, this should verify password credentials.

export const login = createServerFn({ method: "POST" })
  .validator((input: { role?: string }) => input)
  .handler(async ({ data }) => {
    const role = data.role === "viewer" ? "viewer" : "boss";
    const token = createSessionToken(
      role === "boss" ? "boss-dev-001" : "viewer-dev-001",
      role,
    );
    const cookie = createSessionCookie(token);
    return { success: true, cookie, role };
  });

// ─── POST /api/auth/logout ──────────────────────────────────────────
// Clears the session cookie.

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const cookie = createClearSessionCookie();
  return { success: true, cookie };
});

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
    const status = await walletRepository.getStatus();
    return wrap(status);
  },
);

// ─── POST /api/wallet-top-up ────────────────────────────────────────
// Protected: boss role required. Identity derived server-side.

export const topUpWallet = createServerFn({ method: "POST" })
  .middleware([bossGuardMiddleware])
  .validator((input: { amount: number; note?: string }) => input)
  .handler(async ({ data, context }) => {
    const session = (context as any).session as import("../auth").SessionContext;

    // Input validation
    if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error("Invalid amount: must be a positive finite number");
    }
    if (data.amount > 1_000_000) {
      throw new Error("Amount exceeds maximum allowed value");
    }
    const amount = Math.round(data.amount * 100) / 100;
    const note = (typeof data.note === "string" ? data.note : "").slice(0, 500);

    // Execute with server-derived identity (async for PostgreSQL)
    const newBalance = await walletRepository.topUp(amount, note);
    await walletRepository.logGuardrailEvent(
      "WALLET_MODIFIED",
      "INFO",
      `Top-up: $${amount.toFixed(2)} by ${session.userId} (boss) — New balance: $${newBalance.toFixed(2)}`,
      { type: "TOP_UP", amount, note, initiatedBy: session.userId },
      newBalance,
    );
    return wrap({ balance: newBalance });
  },
);

// ─── POST /api/wallet-withdraw ──────────────────────────────────────
// Protected: boss role required. Identity derived server-side.

export const withdrawFromWallet = createServerFn({ method: "POST" })
  .middleware([bossGuardMiddleware])
  .validator((input: { amount: number; note?: string }) => input)
  .handler(async ({ data, context }) => {
    const session = (context as any).session as import("../auth").SessionContext;

    // Input validation
    if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error("Invalid amount: must be a positive finite number");
    }
    if (data.amount > 1_000_000) {
      throw new Error("Amount exceeds maximum allowed value");
    }
    const amount = Math.round(data.amount * 100) / 100;
    const note = (typeof data.note === "string" ? data.note : "").slice(0, 500);

    // Execute with server-derived identity (async for PostgreSQL)
    const newBalance = await walletRepository.withdraw(amount, note);
    await walletRepository.logGuardrailEvent(
      "WALLET_MODIFIED",
      "INFO",
      `Withdrawal: $${amount.toFixed(2)} by ${session.userId} (boss) — New balance: $${newBalance.toFixed(2)}`,
      { type: "WITHDRAW", amount, note, initiatedBy: session.userId },
      newBalance,
    );
    return wrap({ balance: newBalance });
  },
);

// ─── GET /api/audit-trail ───────────────────────────────────────────

export const getAuditTrail = createServerFn({ method: "GET" }).handler(
  async () => {
    const trail = await walletRepository.getAuditTrail(50);
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

// ─── GET /api/journal — AI Decision Journal Events ─────────────────

export const getJournal = createServerFn({ method: "GET" }).handler(
  async () => {
    const events = getRecentJournalEvents(200);
    // Serialize through JSON to ensure all nested types are safe for server transport
    return wrap({ events: JSON.parse(JSON.stringify(events)) } as any);
  },
);

// ─── GET /api/reviews — Post-Trade Reviews ────────────────────────

export const getAiReviews = createServerFn({ method: "GET" }).handler(
  async () => {
    const reviews = getReviews();
    return wrap({ reviews: JSON.parse(JSON.stringify(reviews)) } as any);
  },
);

// ─── GET /api/orchestrator — Full Orchestrator State ─────────────

export const getOrchestratorData = createServerFn({ method: "GET" }).handler(
  async () => {
    const orchestrator = getOrchestrator();
    if (!orchestrator) {
      return wrap({
        running: false,
        account: null,
        recentActivity: [],
        executionMode: "PAPER",
        testnetReady: false,
      });
    }

    let account = null;
    try {
      account = await orchestrator.getBinanceAccountData();
    } catch {
      // Account data unavailable
    }

    return wrap({
      running: true,
      account,
      recentActivity: orchestrator.getRecentActivity(),
      executionMode: orchestrator.getExecutionMode(),
      testnetReady: orchestrator.isTestnetReady(),
    });
  },
);

// ─── POST /api/testnet-sync-balance ────────────────────────────────
// Protected: boss role required.

export const syncTestnetBalance = createServerFn({ method: "POST" })
  .middleware([bossGuardMiddleware])
  .handler(async ({ context }) => {
    const session = (context as any).session as import("../auth").SessionContext;
    const executor = getTestnetExecutor();
    const newBalance = await executor.syncBalance();
    // Log with server-derived identity
    await walletRepository.logGuardrailEvent(
      "BALANCE_CHECK",
      "INFO",
      `Balance synced to testnet by ${session.userId} (boss) — New balance: $${newBalance.toFixed(2)}`,
      { type: "TESTNET_SYNC", newBalance, initiatedBy: session.userId },
      newBalance,
    );
    return wrap({ balance: newBalance });
  },
);

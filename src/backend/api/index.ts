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
export { getDiagnostic } from "./diagnostic";
export { getLLMProbe } from "./llm-probe";
export type { LLMDiagnosticResponse } from "./llm-probe";
export { sendChatMessage, executeChatAction } from "./chat-agent";
export type { ChatAgentResponse, ChatMessage, ChatMessageMeta } from "./chat-agent";
export {
  executeControlledAction,
  detectActionRequest,
  isRegisteredAction,
  getRegisteredActionIds,
  type ActionExecutionResult,
  type ActionDecision,
} from "./controlled-actions";
export { getAgentStatus, AGENT_STATUS_QUERY_KEY } from "./agent-status";
export type { AgentStatusPayload } from "./agent-status";
export { getAgentJournal } from "./agent-journal";
export type { AgentJournalPayload, AgentJournalEvent, AgentJournalDay } from "./agent-journal";
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
import { getRuntimeSnapshot, isRuntimeRunning, getRuntimeStats } from "../trading/runtime";
import { getProviderRegistry } from "../ai/llm/providers";
import { walletRepository } from "../repositories/wallet";
import { getTestnetExecutor } from "../exchange/testnet-executor";
import { isTestnetConfigured } from "../exchange/binance-testnet";
import {
  getJournalEvents,
  getRecentJournalEvents,
  getRecentJournalEventsAsync,
  type JournalEventType,
  type JournalImportance,
} from "../journal";
import { getReviews } from "../journal/post-trade-review";
import { getOrchestrator } from "../trading/runtime";
import { getExchangeSnapshot } from "../exchange/unified-state";
import { buildTestnetDiagnostics } from "../diagnostics/testnet-diagnostics";
import {
  getMarketSnapshot as getMarketDataStateSnapshot,
  type SymbolMarketTick,
} from "../exchange/market-data-state";
import { computeEffectiveAllocation, computeAllocationRemaining } from "../risk/allocation";
import { isPostgresConfigured } from "../database";
import type { ApiResponse, LLMStatusResponse } from "../../types/api";
import { bossGuardMiddleware } from "../auth/middleware";
import { createSessionToken, createSessionCookie, createClearSessionCookie } from "../auth";

// P7D-4.5: Import runtime state checks from server.ts for boot screen
import { isRuntimeInitialized, isDatabaseReady, getRuntimeInitError } from "../../server";

async function wrap<T>(data: T): Promise<ApiResponse<T>> {
  return {
    data,
    timestamp: new Date().toISOString(),
    source: await getDataSource(),
  };
}

/**
 * P7D-5.5: Bound an OPTIONAL server-side enrichment request.
 * The enrichment (e.g. Binance open orders / realized PnL) may be slow or
 * fail when the exchange is unreachable — it must never hang the endpoint
 * or the dashboard. On timeout/error we return `fallback` immediately;
 * the underlying request keeps running in the background harmlessly.
 */
async function bounded<T>(label: string, promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        resolve(fallback);
      }, ms);
      promise.then(
        (value) => resolve(value),
        () => resolve(fallback),
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── GET /api/dashboard ───────────────────────────────────────────────

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchDashboard();
  return wrap(data);
});

// ─── GET /api/runtime ─────────────────────────────────────────────────

export const getRuntime = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchRuntime();
  return wrap(data);
});

// ─── GET /api/performance ─────────────────────────────────────────────

export const getPerformance = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchPerformance();
  return wrap(data);
});

// ─── GET /api/market ──────────────────────────────────────────────────

export const getMarket = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchMarket();
  return wrap(data);
});

// ─── GET /api/strategies ──────────────────────────────────────────────

export const getStrategies = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchStrategies();
  return wrap(data);
});

// ─── GET /api/trades ──────────────────────────────────────────────────

export const getTrades = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchTrades();
  return wrap(data);
});

// ─── GET /api/learning ────────────────────────────────────────────────

export const getLearning = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchLearning();
  return wrap(data);
});

// ─── GET /api/experiments ─────────────────────────────────────────────

export const getExperiments = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchExperiments();
  return wrap(data);
});

// ─── GET /api/risk ────────────────────────────────────────────────────

export const getRisk = createServerFn({ method: "GET" }).handler(async () => {
  const [risk, events] = await Promise.all([fetchRisk(), fetchRiskEvents()]);
  return wrap({ ...risk, events });
});

// ─── GET /api/audit ───────────────────────────────────────────────────

export const getAudit = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchAudit();
  return wrap(data);
});

// ─── GET /api/system ──────────────────────────────────────────────────

export const getSystem = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchSystem();
  return wrap(data);
});

// ─── POST /api/auth/login ───────────────────────────────────────────
// Dev-only login endpoint. Creates a signed session cookie.
// In production, this should verify password credentials.

export const login = createServerFn({ method: "POST" })
  .validator((input: { role?: string }) => input)
  .handler(async ({ data }) => {
    const role = data.role === "viewer" ? "viewer" : "boss";
    const token = createSessionToken(role === "boss" ? "boss-dev-001" : "viewer-dev-001", role);
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

export const getHealth = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchHealth();
  return wrap(data);
});

// ─── GET /api/paper-status ───────────────────────────────────────────

export const getPaperStatus = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchPaperStatus();
  return wrap(data);
});

// ─── GET /api/feed-status ──────────────────────────────────────────

export const getFeedStatus = createServerFn({ method: "GET" }).handler(async () => {
  const data = await fetchFeedStatus();
  return wrap(data);
});

// ─── GET /api/market-snapshot ─────────────────────────────────────

export const getMarketSnapshot = createServerFn({ method: "GET" })
  .validator((symbol: string) => symbol)
  .handler(async ({ data: symbol }) => {
    const state = generateRealtimeMarketState(symbol);
    return wrap(state);
  });

// ─── GET /api/runtime-status ─────────────────────────────────────

export const getRuntimeStatus = createServerFn({ method: "GET" }).handler(async () => {
  const snapshot = getRuntimeSnapshot();
  return wrap(snapshot);
});

// ─── GET /api/llm-status ───────────────────────────────────────

export const getLLMStatus = createServerFn({ method: "GET" }).handler(async () => {
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
});

// ─── GET /api/wallet-status ─────────────────────────────────────────

export const getWalletStatus = createServerFn({ method: "GET" }).handler(async () => {
  const status = await walletRepository.getStatus();
  return wrap(status);
});

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
  });

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
  });

// ─── GET /api/audit-trail ───────────────────────────────────────────

export const getAuditTrail = createServerFn({ method: "GET" }).handler(async () => {
  const trail = await walletRepository.getAuditTrail(50);
  return wrap({ events: trail });
});

// ─── GET /api/testnet-status ───────────────────────────────────────
// P7D-3: Now includes open orders from Binance Futures Testnet

export const getTestnetStatus = createServerFn({ method: "GET" }).handler(async () => {
  // Phase 3.5-E: READ-ONLY runtime diagnostics proving production can reach
  // Binance Futures TESTNET (credentials presence → authenticated → balance →
  // positions → open orders → market → testnet-only protection).
  // Strictly no trading: the diagnostics builder only calls existing GET
  // methods on the existing client and never mutates anything.
  const diagnostics = await buildTestnetDiagnostics();

  // P7D-5.1: Read from unified exchange state (cached, WebSocket-updated)
  // instead of making fresh REST calls to Binance on every request.
  const snapshot = getExchangeSnapshot();

  // P7D-5.5: Optional enrichments (open orders, realized PnL) are read from
  // the executor only when connected, and are BOUNDED — a slow or failing
  // Binance never holds up this endpoint or the dashboard.
  const ENRICH_BUDGET_MS = 4_000;

  type OpenOrderLite = {
    orderId: number;
    symbol: string;
    side: string;
    type: string;
    quantity: string;
    price: string;
    status: string;
  };
  const noOrders: OpenOrderLite[] = [];

  // Also get open orders from executor (lightweight, not cached)
  let openOrders: OpenOrderLite[] = [];
  if (snapshot.connected) {
    openOrders = await bounded(
      "testnet-status:open-orders",
      (async () => {
        const executor = getTestnetExecutor();
        const client = executor.getClient();
        if (!client?.isConnected()) return noOrders;
        const orders = await client.getOpenOrders();
        return orders.map((o) => ({
          orderId: o.orderId,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          quantity: o.origQty,
          price: o.price,
          status: o.status,
        }));
      })(),
      ENRICH_BUDGET_MS,
      noOrders,
    );
  }

  // P7D-3-FIX-REALIZED-PNL-2: Realized PnL from Binance Futures Testnet
  let realizedPnl: number | null = null;
  let realizedPnlStatus: "SUCCESS" | "ERROR" | "UNAVAILABLE" = "UNAVAILABLE";
  if (snapshot.connected) {
    const pnlResult = await bounded(
      "testnet-status:realized-pnl",
      (async () => {
        const executor = getTestnetExecutor();
        return executor.getRealizedPnl();
      })(),
      ENRICH_BUDGET_MS,
      { value: null, status: "UNAVAILABLE" as const, source: "unavailable", recordCount: 0 },
    );
    realizedPnl = pnlResult.value;
    realizedPnlStatus = pnlResult.status;
  }

  return wrap({
    // Phase 3.5-E: safe diagnostics block (credential booleans only — never values)
    diagnostics,
    configured: snapshot.configured,
    connected: snapshot.connected,
    // P7D-5.5: full account surface from the unified snapshot (single source)
    balance: snapshot.account.balance,
    availableBalance: snapshot.account.availableBalance,
    marginBalance: snapshot.account.marginBalance,
    unrealizedPnl: snapshot.account.unrealizedPnl,
    positions: snapshot.positions,
    openOrders,
    paperTrading: process.env["PAPER_TRADING"] !== "false",
    realizedPnl,
    realizedPnlStatus,
    // P7D-5.1: Unified state fields
    connectionStatus: snapshot.connectionStatus,
    lastSyncTimestamp: snapshot.lastSyncTimestamp,
    stale: snapshot.stale,
    lastError: snapshot.lastError,
    consecutiveFailures: snapshot.consecutiveFailures,
    // Legacy fields (still used by some consumers)
    testnetReady: snapshot.connected,
    lastSuccessfulSync: snapshot.lastSyncTimestamp || null,
    lastSyncAttempt: snapshot.lastConnectionAttempt || null,
    connectionError: snapshot.lastError,
    consecutiveSyncFailures: snapshot.consecutiveFailures,
    isStale: snapshot.stale,
  });
});

// ─── GET /api/market-status — P7D-5.3 Market Data Status ──────────
// Read-only view of the market-data-state snapshot (WebSocket + REST
// fallback). In-memory only — never performs a Binance call on request.

export const getMarketStatus = createServerFn({ method: "GET" }).handler(async () => {
  const snapshot = getMarketDataStateSnapshot();

  const ticks: Array<{
    symbol: string;
    lastPrice: number;
    bid: number;
    ask: number;
    spread: number;
    priceChangePercent24h: number;
    volume24h: number;
    quoteVolume24h: number;
    updatedAt: number;
  }> = [];
  for (const symbol of snapshot.subscribedSymbols) {
    const t: SymbolMarketTick | undefined = snapshot.symbols[symbol];
    if (!t || !(t.lastPrice > 0)) continue;
    ticks.push({
      symbol: t.symbol,
      lastPrice: t.lastPrice,
      bid: t.bid,
      ask: t.ask,
      spread: t.spread,
      priceChangePercent24h: t.priceChangePercent24h,
      volume24h: t.volume24h,
      quoteVolume24h: t.quoteVolume24h,
      updatedAt: t.updatedAt,
    });
    if (ticks.length >= 8) break;
  }

  return wrap({
    connectionStatus: snapshot.connectionStatus,
    lastUpdateAt: snapshot.lastUpdateAt,
    dataFreshness: snapshot.dataFreshness,
    errorCount: snapshot.errorCount,
    subscribedSymbols: snapshot.subscribedSymbols,
    ticks,
  });
});

// ─── GET /api/journal — AI Decision Journal Events ─────────────────

export const getJournal = createServerFn({ method: "GET" }).handler(async () => {
  const events = getRecentJournalEvents(200);
  // Serialize through JSON to ensure all nested types are safe for server transport
  return wrap({ events: JSON.parse(JSON.stringify(events)) } as any);
});

// ─── GET /api/ai-logbook — AI Logbook (Bahasa Indonesia) ─────────
// P7D-4: Human-readable activity log in Bahasa Indonesia

export const getAiLogbook = createServerFn({ method: "GET" })
  .validator((input: { includeNoise?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    try {
      const { formatLogbookEntries, computeLogbookSummary } =
        await import("../journal/ai-logbook-formatter");

      // P7D-4.1: Read from PostgreSQL (persistent source of truth)
      const allEntries = formatLogbookEntries(await getRecentJournalEventsAsync(500));

      // P7D-4.3: Filter noise events unless explicitly requested
      const entries = data.includeNoise ? allEntries : allEntries.filter((e: any) => !e.isNoise);

      const summary = computeLogbookSummary(allEntries); // Summary always counts all events

      const orchestrator = getOrchestrator();
      const runtimeActive = orchestrator !== null;
      const runtimeRunning = orchestrator?.getRiskEngine() !== undefined;

      return wrap({
        entries: JSON.parse(JSON.stringify(entries)) as any,
        summary: JSON.parse(JSON.stringify(summary)) as any,
        runtimeActive,
        runtimeRunning,
      } as any);
    } catch (err) {
      // Never let AI Logbook errors break the server or other endpoints
      return wrap({
        entries: [] as any,
        summary: {
          analyses: 0,
          decisions: 0,
          riskChecks: 0,
          trades: 0,
          rejected: 0,
          memorySaved: 0,
          learningGenerated: 0,
        } as any,
        runtimeActive: false,
        runtimeRunning: false,
        error: err instanceof Error ? err.message : "Unknown error",
      } as any);
    }
  });

// ─── GET /api/reviews — Post-Trade Reviews ────────────────────────

export const getAiReviews = createServerFn({ method: "GET" }).handler(async () => {
  const reviews = getReviews();
  return wrap({ reviews: JSON.parse(JSON.stringify(reviews)) } as any);
});

// ─── GET /api/orchestrator — Full Orchestrator State ─────────────
// P7D-3: Now includes open orders from Binance Futures Testnet

export const getOrchestratorData = createServerFn({ method: "GET" }).handler(async () => {
  const orchestrator = getOrchestrator();
  if (!orchestrator) {
    return wrap({
      running: false,
      account: null,
      recentActivity: [],
      executionMode: "PAPER",
      testnetReady: false,
      tradingEnabled: false,
    });
  }

  // P7D-5.5: This endpoint never performs live Binance REST calls.
  // Account + positions come from the unified exchange snapshot (P7D-5.1,
  // WebSocket + bounded REST fallback) and risk state comes from the
  // in-memory risk engine — everything is synchronous & instant, so a
  // slow/failing Binance can never delay the dashboard's risk/account cards.
  const snapshot = getExchangeSnapshot();
  const riskEngine = orchestrator.getRiskEngine();
  const riskStats = riskEngine.getDailyStats();

  // Real account surface is available once Binance has synced at least once.
  const accountAvailable = snapshot.connected || snapshot.lastSyncTimestamp > 0;
  const hasLiveSync = snapshot.connected && snapshot.lastSyncTimestamp > 0;
  const effectiveAllocation = hasLiveSync
    ? computeEffectiveAllocation(snapshot.account.availableBalance)
    : 0;
  const allocated = hasLiveSync ? riskEngine.getOpenPositionMargin() : 0;

  const account = {
    binanceAccount: accountAvailable
      ? {
          balance: snapshot.account.balance,
          availableBalance: snapshot.account.availableBalance,
          unrealizedPnl: snapshot.account.unrealizedPnl,
          marginBalance: snapshot.account.marginBalance,
          realizedPnl: null,
          realizedPnlStatus: "UNAVAILABLE" as const,
        }
      : null,
    aiAllocation: {
      limit: riskEngine.getAiAllocationLimit(),
      effectiveAllocation,
      allocated,
      available: computeAllocationRemaining(effectiveAllocation, allocated),
      accountAvailable: hasLiveSync,
    },
    openPositions: snapshot.positions,
    riskState: {
      dailyPnl: riskStats.pnl,
      sessionPnl: riskStats.sessionPnl,
      isLocked: riskStats.locked,
      lockReason: riskStats.lockReason ?? "",
      cooldownActive: riskStats.cooldownActive,
      cooldownEndsAt: riskStats.cooldownEndsAt,
      hardCapReached: riskStats.hardCapReached,
    },
    connectionState: orchestrator.getConnectionState(),
  };

  return wrap({
    running: true,
    account,
    recentActivity: orchestrator.getRecentActivity(),
    executionMode: orchestrator.getExecutionMode(),
    testnetReady: snapshot.connected,
    tradingEnabled: riskEngine.isTradingEnabled(),
    // P7C: Include truthful connection-state
    connectionState: orchestrator.getConnectionState(),
    // Legacy keys kept for shape compatibility (enrichment now lives on
    // /api/testnet-status only, where it is bounded).
    openOrders: [],
    realizedPnl: null,
    realizedPnlStatus: "UNAVAILABLE",
  });
});

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
  });

// ─── GET /api/system-readiness — P7D-4.5 Boot Screen ───────────────
// Returns real subsystem state for the boot screen.
// Non-blocking: checks module-level singletons, no heavy I/O.

export type SystemReadiness = {
  binanceConfigured: boolean;
  binanceConnected: boolean;
  databaseConfigured: boolean;
  databaseReady: boolean;
  runtimeReady: boolean;
  runtimeRunning: boolean;
  riskEngineReady: boolean;
  aiRuntimeOnline: boolean;
  systemReady: boolean;
  error: string | null;
  executionMode: string;
  tradingEnabled: boolean;
};

export const getSystemReadiness = createServerFn({ method: "GET" }).handler(async () => {
  const binanceConfigured = isTestnetConfigured();
  const databaseConfigured = isPostgresConfigured();
  const runtimeRunning = isRuntimeRunning();
  const runtimeReady = isRuntimeInitialized();
  const dbReady = isDatabaseReady();

  // Check orchestrator and risk engine state
  const orchestrator = getOrchestrator();
  const riskEngineReady = orchestrator?.getRiskEngine() !== undefined;
  const aiRuntimeOnline = runtimeRunning;

  // Check Binance actual connection via orchestrator state
  let binanceConnected = false;
  if (orchestrator) {
    const conn = orchestrator.getConnectionState();
    binanceConnected = conn?.testnetReady ?? false;
  }

  const mode =
    process.env["BINANCE_TESTNET_API_KEY"] && process.env["BINANCE_TESTNET_SECRET"]
      ? "TESTNET"
      : "PAPER";
  const tradingEnabled = process.env["TRADING_ENABLED"] === "true";

  const error = getRuntimeInitError();

  // System is ready when database + runtime are both ready
  const systemReady = dbReady && runtimeReady;

  return wrap({
    binanceConfigured,
    binanceConnected,
    databaseConfigured,
    databaseReady: dbReady,
    runtimeReady,
    runtimeRunning,
    riskEngineReady,
    aiRuntimeOnline,
    systemReady,
    error,
    executionMode: mode,
    tradingEnabled,
  } satisfies SystemReadiness);
});

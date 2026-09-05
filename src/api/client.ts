/**
 * API Client — BINANCE AI FUTURES AGENT v0.1
 *
 * Client-side module that calls TanStack Start server functions.
 * Routes import THIS instead of @/lib/mock.
 *
 * Architecture:
 *   Route Component → api/client.ts → Server Function → Data Adapter → Database/Mock
 *
 * P7D-5.5: Every call is bounded by `withTimeout` so no UI request can hang
 * forever. A slow/offline Binance or LLM backend surfaces a structured
 * timeout error that resolves the component loading state into an explicit
 * ERROR/DEGRADED/OFFLINE state.
 */

import {
  getDashboard,
  getRuntime,
  getPerformance,
  getMarket,
  getStrategies,
  getTrades,
  getLearning,
  getExperiments,
  getRisk,
  getAudit,
  getSystem,
  getHealth,
  getPaperStatus,
  getFeedStatus,
  getMarketSnapshot,
  getLLMStatus,
  getWalletStatus,
  topUpWallet,
  withdrawFromWallet,
  getAuditTrail,
  getTestnetStatus,
  getMarketStatus,
  getRuntimeStatus,
  syncTestnetBalance,
  getJournal,
  getAiReviews,
  getOrchestratorData,
  getDiagnostic,
  getAiLogbook,
  getSystemReadiness,
  getAgentStatus,
  getAgentJournal,
  sendChatMessage,
  executeChatAction,
} from "../backend/api";
import type { ApiResponse } from "../types/api";
import {
  BUDGET_EXCHANGE_MS,
  BUDGET_FAST_MS,
  BUDGET_BOOT_MS,
  withTimeout,
} from "@/lib/fetch-timeout";

// ─── Dashboard ────────────────────────────────────────────────────────

export async function fetchDashboard() {
  const result = await withTimeout("dashboard", getDashboard(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Runtime ──────────────────────────────────────────────────────────

export async function fetchRuntime() {
  const result = await withTimeout("runtime", getRuntime(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Runtime Snapshot (in-memory scheduler events) ──────────────────

export async function fetchRuntimeStatus() {
  const result = await withTimeout("runtime-status", getRuntimeStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Performance ──────────────────────────────────────────────────────

export async function fetchPerformance() {
  const result = await withTimeout("performance", getPerformance(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Market ───────────────────────────────────────────────────────────

export async function fetchMarket() {
  const result = await withTimeout("market", getMarket(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Strategies ───────────────────────────────────────────────────────

export async function fetchStrategies() {
  const result = await withTimeout("strategies", getStrategies(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Trades ───────────────────────────────────────────────────────────

export async function fetchTrades() {
  const result = await withTimeout("trades", getTrades(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Learning ─────────────────────────────────────────────────────────

export async function fetchLearning() {
  const result = await withTimeout("learning", getLearning(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Experiments ──────────────────────────────────────────────────────

export async function fetchExperiments() {
  const result = await withTimeout("experiments", getExperiments(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Risk ─────────────────────────────────────────────────────────────

export async function fetchRisk() {
  const result = await withTimeout("risk", getRisk(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Audit ────────────────────────────────────────────────────────────

export async function fetchAudit() {
  const result = await withTimeout("audit", getAudit(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── System ───────────────────────────────────────────────────────────

export async function fetchSystem() {
  const result = await withTimeout("system", getSystem(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Health ───────────────────────────────────────────────────────────

export async function fetchHealth() {
  const result = await withTimeout("health", getHealth(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Paper Status (Phase 8B) ─────────────────────────────────────────

export async function fetchPaperStatus() {
  const result = await withTimeout("paper-status", getPaperStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Feed Status (Phase 8C) ─────────────────────────────────────────

export async function fetchFeedStatus() {
  const result = await withTimeout("feed-status", getFeedStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Market Snapshot (Phase 8D) ────────────────────────────────────

export async function fetchMarketSnapshot(symbol: string) {
  const result = await withTimeout(
    "market-snapshot",
    getMarketSnapshot({ data: symbol }),
    BUDGET_FAST_MS,
  );
  return result as ApiResponse<any>;
}

// ─── LLM Provider Status (Phase 9B) ────────────────────────────────

export async function fetchLLMStatus() {
  const result = await withTimeout("llm-status", getLLMStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Sandbox Wallet (Phase 9D) ─────────────────────────────────────

export async function fetchWalletStatus() {
  const result = await withTimeout("wallet-status", getWalletStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

export async function walletTopUp(amount: number, note?: string) {
  const payload: { amount: number; note?: string } = { amount };
  if (note !== undefined) payload.note = note;
  const result = await withTimeout("wallet-top-up", topUpWallet({ data: payload }), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

export async function walletWithdraw(amount: number, note?: string) {
  const payload: { amount: number; note?: string } = { amount };
  if (note !== undefined) payload.note = note;
  const result = await withTimeout(
    "wallet-withdraw",
    withdrawFromWallet({ data: payload }),
    BUDGET_FAST_MS,
  );
  return result as ApiResponse<any>;
}

// ─── Audit Trail (Phase 9D) ────────────────────────────────────────

export async function fetchAuditTrail() {
  const result = await withTimeout("audit-trail", getAuditTrail(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Binance Futures Testnet (Phase 9E) ────────────────────────────
// May include bounded optional Binance enrichment — budget accordingly.

export async function fetchTestnetStatus() {
  const result = await withTimeout("testnet-status", getTestnetStatus(), BUDGET_EXCHANGE_MS);
  return result as ApiResponse<any>;
}

export async function syncTestnetBalanceAction() {
  const result = await withTimeout(
    "testnet-sync-balance",
    syncTestnetBalance(),
    BUDGET_EXCHANGE_MS,
  );
  return result as ApiResponse<any>;
}

// ─── Market Data Status (P7D-5.3 / P7D-5.5) ───────────────────────
// In-memory market-data-state snapshot — instant, never touches Binance.

export async function fetchMarketStatus() {
  const result = await withTimeout("market-status", getMarketStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── AI Journal Events (P5) ────────────────────────────────────────

export async function fetchJournal() {
  const result = await withTimeout("journal", getJournal(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Post-Trade Reviews (P5) ────────────────────────────────────────

export async function fetchReviews() {
  const result = await withTimeout("reviews", getAiReviews(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── Orchestrator State (P5) ──────────────────────────────────────
// Snapshot-based since P7D-5.5 — never waits on live Binance calls.

export async function fetchOrchestratorData() {
  const result = await withTimeout("orchestrator", getOrchestratorData(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── AI Logbook (P7D-4) ──────────────────────────────────────────

export async function fetchAiLogbook(includeNoise = false) {
  const result = await withTimeout(
    "ai-logbook",
    getAiLogbook({ data: { includeNoise } }),
    BUDGET_FAST_MS,
  );
  return result as ApiResponse<any>;
}

// ─── Diagnostic (P7D-3-FIX-CONNECTION-DIAGNOSTIC) ────────────────

export async function fetchDiagnostic() {
  const result = await withTimeout("diagnostic", getDiagnostic(), BUDGET_FAST_MS);
  return result as ApiResponse<any>;
}

// ─── System Readiness (P7D-4.5 Boot Screen) ─────────────────────

export async function fetchSystemReadiness() {
  const result = await withTimeout("system-readiness", getSystemReadiness(), BUDGET_BOOT_MS);
  return result as ApiResponse<any>;
}

// ─── Agent Status (lightweight monitor) ──────────────────────────
// Single aggregate for the main monitoring screen. In-memory only —
// no database queries, no Binance REST calls.

// ─── Agent Journal (persistent, DB-backed) ───────────────────────
// Daily journal history + live work log, read from the persistent
// agent_events/journal_events table — never from session or AI state.

export async function fetchAgentJournal(date?: string) {
  const result = await withTimeout(
    "agent-journal",
    getAgentJournal({ data: date ? { date } : {} }),
    BUDGET_FAST_MS,
  );
  return result as ApiResponse<import("../backend/api").AgentJournalPayload>;
}

export async function fetchAgentStatus() {
  const result = await withTimeout("agent-status", getAgentStatus(), BUDGET_FAST_MS);
  return result as ApiResponse<import("../backend/api").AgentStatusPayload>;
}

// ─── Chat Agent (Phase 3.8-C.1) ──────────────────────────────────
// Boss-guarded server function → existing LLM provider chain.
// READ-ONLY: never touches executor, risk engine, or journal.

export async function sendAgentChat(
  message: string,
  history: Array<{ role: "boss" | "agent"; content: string }> = [],
) {
  // LLM chain can take longer than a fast budget — bounded at 30s.
  const result = await withTimeout(
    "chat-agent",
    sendChatMessage({ data: { message, history } }),
    30_000,
  );
  return result as import("../backend/api/chat-agent").ChatAgentResponse;
}

// ─── Controlled Actions (Phase 3.8-D.2) ──────────────────────────
// Boss-guarded; registry allowlist + permission + safety gate server-side.
// READ_ONLY actions run immediately; mutations require confirmation (none
// exist in D.2). Trading/money actions are always DENIED.

export async function runChatAction(actionId: string) {
  const result = await withTimeout(
    "chat-action",
    executeChatAction({ data: { actionId } }),
    15_000,
  );
  return result as import("../backend/api/controlled-actions").ActionExecutionResult;
}

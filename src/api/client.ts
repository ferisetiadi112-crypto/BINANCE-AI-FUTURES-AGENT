/**
 * API Client — BINANCE AI FUTURES AGENT v0.1
 *
 * Client-side module that calls TanStack Start server functions.
 * Routes import THIS instead of @/lib/mock.
 *
 * Architecture:
 *   Route Component → api/client.ts → Server Function → Data Adapter → Database/Mock
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
  syncTestnetBalance,
  getJournal,
  getAiReviews,
  getOrchestratorData,
  getDiagnostic,
  getAiLogbook,
  getSystemReadiness,
} from "../backend/api";
import type { ApiResponse } from "../types/api";

// ─── Dashboard ────────────────────────────────────────────────────────

export async function fetchDashboard() {
  const result = await getDashboard();
  return result as ApiResponse<any>;
}

// ─── Runtime ──────────────────────────────────────────────────────────

export async function fetchRuntime() {
  const result = await getRuntime();
  return result as ApiResponse<any>;
}

// ─── Performance ──────────────────────────────────────────────────────

export async function fetchPerformance() {
  const result = await getPerformance();
  return result as ApiResponse<any>;
}

// ─── Market ───────────────────────────────────────────────────────────

export async function fetchMarket() {
  const result = await getMarket();
  return result as ApiResponse<any>;
}

// ─── Strategies ───────────────────────────────────────────────────────

export async function fetchStrategies() {
  const result = await getStrategies();
  return result as ApiResponse<any>;
}

// ─── Trades ───────────────────────────────────────────────────────────

export async function fetchTrades() {
  const result = await getTrades();
  return result as ApiResponse<any>;
}

// ─── Learning ─────────────────────────────────────────────────────────

export async function fetchLearning() {
  const result = await getLearning();
  return result as ApiResponse<any>;
}

// ─── Experiments ──────────────────────────────────────────────────────

export async function fetchExperiments() {
  const result = await getExperiments();
  return result as ApiResponse<any>;
}

// ─── Risk ─────────────────────────────────────────────────────────────

export async function fetchRisk() {
  const result = await getRisk();
  return result as ApiResponse<any>;
}

// ─── Audit ────────────────────────────────────────────────────────────

export async function fetchAudit() {
  const result = await getAudit();
  return result as ApiResponse<any>;
}

// ─── System ───────────────────────────────────────────────────────────

export async function fetchSystem() {
  const result = await getSystem();
  return result as ApiResponse<any>;
}

// ─── Health ───────────────────────────────────────────────────────────

export async function fetchHealth() {
  const result = await getHealth();
  return result as ApiResponse<any>;
}

// ─── Paper Status (Phase 8B) ─────────────────────────────────────────

export async function fetchPaperStatus() {
  const result = await getPaperStatus();
  return result as ApiResponse<any>;
}

// ─── Feed Status (Phase 8C) ─────────────────────────────────────────

export async function fetchFeedStatus() {
  const result = await getFeedStatus();
  return result as ApiResponse<any>;
}

// ─── Market Snapshot (Phase 8D) ────────────────────────────────────

export async function fetchMarketSnapshot(symbol: string) {
  const result = await getMarketSnapshot({ data: symbol });
  return result as ApiResponse<any>;
}

// ─── LLM Provider Status (Phase 9B) ────────────────────────────────

export async function fetchLLMStatus() {
  const result = await getLLMStatus();
  return result as ApiResponse<any>;
}

// ─── Sandbox Wallet (Phase 9D) ─────────────────────────────────────

export async function fetchWalletStatus() {
  const result = await getWalletStatus();
  return result as ApiResponse<any>;
}

export async function walletTopUp(amount: number, note?: string) {
  const payload: { amount: number; note?: string } = { amount };
  if (note !== undefined) payload.note = note;
  const result = await topUpWallet({ data: payload });
  return result as ApiResponse<any>;
}

export async function walletWithdraw(amount: number, note?: string) {
  const payload: { amount: number; note?: string } = { amount };
  if (note !== undefined) payload.note = note;
  const result = await withdrawFromWallet({ data: payload });
  return result as ApiResponse<any>;
}

// ─── Audit Trail (Phase 9D) ────────────────────────────────────────

export async function fetchAuditTrail() {
  const result = await getAuditTrail();
  return result as ApiResponse<any>;
}

// ─── Binance Futures Testnet (Phase 9E) ────────────────────────────

export async function fetchTestnetStatus() {
  const result = await getTestnetStatus();
  return result as ApiResponse<any>;
}

export async function syncTestnetBalanceAction() {
  const result = await syncTestnetBalance();
  return result as ApiResponse<any>;
}

// ─── AI Journal Events (P5) ────────────────────────────────────────

export async function fetchJournal() {
  const result = await getJournal();
  return result as ApiResponse<any>;
}

// ─── Post-Trade Reviews (P5) ────────────────────────────────────────

export async function fetchReviews() {
  const result = await getAiReviews();
  return result as ApiResponse<any>;
}

// ─── Orchestrator State (P5) ──────────────────────────────────────

export async function fetchOrchestratorData() {
  const result = await getOrchestratorData();
  return result as ApiResponse<any>;
}

// ─── AI Logbook (P7D-4) ──────────────────────────────────────────

export async function fetchAiLogbook(includeNoise = false) {
  const result = await getAiLogbook({ data: { includeNoise } });
  return result as ApiResponse<any>;
}

// ─── Diagnostic (P7D-3-FIX-CONNECTION-DIAGNOSTIC) ────────────────

export async function fetchDiagnostic() {
  const result = await getDiagnostic();
  return result as ApiResponse<any>;
}

// ─── System Readiness (P7D-4.5 Boot Screen) ─────────────────────

export async function fetchSystemReadiness() {
  const result = await getSystemReadiness();
  return result as ApiResponse<any>;
}

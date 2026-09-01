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

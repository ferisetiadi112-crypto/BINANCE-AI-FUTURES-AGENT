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
  getDataSource,
} from "../services/data-adapter";
import type { ApiResponse } from "../../types/api";

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

/**
 * Centralized Binance REST request policy — E.2-FIX-D.6
 *
 * Every Binance Futures TESTNET REST request passes through this policy:
 *
 *   caller → circuit breaker → weight throttle → concurrency limiter
 *          → in-flight dedup → execute → (cache result) → backoff on transient errors
 *
 * SAFETY:
 * - READ-ONLY infrastructure; it never issues requests itself beyond the one
 *   delegated execution it guards.
 * - TESTNET ONLY — this module contains no endpoints, just policy.
 * - Trading is never triggered here; no order endpoints referenced.
 *
 * Behaviors implemented (per E.2-FIX-D.5 audit findings):
 * - Cache with TTL per resource key (ticker 15s, klines 60s, account 60s).
 * - In-flight dedup: concurrent callers of the same key share one request.
 * - Bounded concurrency (no uncontrolled Promise.all bursts).
 * - Exponential backoff + jitter for 429/418/-1003/timeout/5xx (bounded retries).
 * - Circuit breaker: 429 / 418 / -1003 / "Way too many requests" / IP ban →
 *   OPEN for cooldown (default 5 min), half-open single probe, then CLOSE/OPEN.
 *   If Binance provides a Retry-After or ban-until longer than the baseline,
 *   that value is honored.
 * - Weight monitoring: X-MBX-USED-WEIGHT header parsed; soft threshold throttles
 *   further REST until weight decays. Limit assumption documented below.
 *
 * WEIGHT LIMIT ASSUMPTION:
 * - The project does not hard-code a Binance weight limit anywhere. We treat
 *   the observed used-weight value as monotone and apply a soft threshold as a
 *   FRACTION of a configurable ceiling (default 1200/min — a conservative
 *   documented Binance Futures REST weight budget; override via
 *   BINANCE_REST_WEIGHT_LIMIT env when the operator knows better).
 * - We never wait for 429 to react: crossing the soft threshold (default 50%)
 *   delays/defers further REST calls in favor of cache/WS data.
 */

import { logger } from "../logger";

// ─── Configuration ─────────────────────────────────────────────────

export const CACHE_TTL_TICKER_MS = 15_000;
export const CACHE_TTL_KLINES_MS = 60_000;
export const CACHE_TTL_ACCOUNT_MS = 60_000;
export const CACHE_TTL_EXCHANGE_INFO_MS = 24 * 60 * 60_000;
// E.2-FIX-D.9: /fapi/v1/openOrders (no symbol) is a high-weight (~40) request.
// Diagnostics/status only need a recent count — 30s cache keeps dashboard polling
// to at most 2 underlying requests/min (≈80 weight/min) while staying fresh.
export const CACHE_TTL_OPEN_ORDERS_MS = 30_000;

const CIRCUIT_OPEN_COOLDOWN_MS = 5 * 60_000; // baseline 5 minutes
const MAX_RETRIES = 2; // bounded — no infinite retry
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
const MAX_CONCURRENCY = 3; // bounded concurrent Binance REST requests
const RETRYABLE_TRANSIENT_MS = 1_000; // spacing before first transient retry

const WEIGHT_LIMIT_DEFAULT = 1200; // documented assumption, see module header
const WEIGHT_SOFT_THRESHOLD_RATIO = 0.5;
const WEIGHT_WINDOW_MS = 60_000; // assume decay after a minute of quiet

// ─── State ─────────────────────────────────────────────────────────

type CacheEntry = { value: unknown; expiresAt: number };
const _cache = new Map<string, CacheEntry>();
const _inFlight = new Map<string, Promise<unknown>>();

let _active = 0;
const _waiters: Array<() => void> = [];

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
let _circuit: CircuitState = "CLOSED";
let _circuitOpenUntil = 0;
let _probeInFlight = false;

let _usedWeight = 0;
let _weightObservedAt = 0;
let _throttleUntil = 0;

let _stats = {
  requestsExecuted: 0,
  cacheHits: 0,
  dedupJoins: 0,
  breakerTrips: 0,
  breakerSuppressed: 0,
  retries: 0,
  throttledByWeight: 0,
};

// ─── Circuit breaker classification ────────────────────────────────

/** Errors that must open the circuit immediately. */
export function isRateLimitError(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { code?: string; httpStatus?: number; message?: string };
  if (e.httpStatus === 429 || e.httpStatus === 418) return true;
  if (e.code === "RATE_LIMITED") return true;
  const msg = String(e.message ?? "");
  if (msg.includes("Way too many requests")) return true;
  if (msg.includes("-1003")) return true;
  if (msg.toLowerCase().includes("ip ban") || msg.includes("IP banned")) return true;
  // Binance JSON error body surfaced as "Code -1003: ..." in the message
  if (/Code -1003\b/.test(msg)) return true;
  return false;
}

/** Transient errors eligible for bounded backoff retry. */
function isTransientError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  const e = err as { code?: string; httpStatus?: number; message?: string };
  if (e.code === "NETWORK_ERROR" || e.code === "TIMEOUT") return true;
  if (e.httpStatus !== undefined && e.httpStatus >= 500 && e.httpStatus < 600) return true;
  const msg = String(e.message ?? "");
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("fetch failed")
  );
}

/**
 * Extract ban duration from the error when Binance signals one.
 * Honors Retry-After style hints ("banned until <timestamp>", "retry after Ns").
 * Returns ms to keep the circuit OPEN, or null to use the baseline cooldown.
 */
function extractBanDurationMs(err: unknown): number | null {
  const msg = String((err as { message?: string })?.message ?? "");
  // "banned until 1700000000000" (epoch ms) or "banned until 1700000000" (epoch s)
  const untilMatch = msg.match(/banned until (\d{10,13})/i);
  if (untilMatch) {
    const raw = Number(untilMatch[1]);
    const epochMs = raw > 1e12 ? raw : raw * 1000;
    const delta = epochMs - Date.now();
    if (Number.isFinite(delta) && delta > 0) return delta;
  }
  const retryAfter = msg.match(/retry after (\d+)/i);
  if (retryAfter) {
    return Number(retryAfter[1]) * 1000;
  }
  return null;
}

// ─── Public introspection / test hooks ─────────────────────────────

export function getCircuitState(): CircuitState {
  if (_circuit === "OPEN" && Date.now() >= _circuitOpenUntil) return "HALF_OPEN";
  return _circuit;
}

export function getRestPolicyStats() {
  return {
    ..._stats,
    circuit: getCircuitState(),
    usedWeight: _usedWeight,
    weightObservedAt: _weightObservedAt,
    circuitOpenUntil: _circuitOpenUntil,
  };
}

/** Test/diagnostic helper — reset all policy state. */
export function resetRestPolicy(): void {
  _cache.clear();
  _inFlight.clear();
  _active = 0;
  _waiters.length = 0;
  _circuit = "CLOSED";
  _circuitOpenUntil = 0;
  _probeInFlight = false;
  _usedWeight = 0;
  _weightObservedAt = 0;
  _throttleUntil = 0;
  _stats = {
    requestsExecuted: 0,
    cacheHits: 0,
    dedupJoins: 0,
    breakerTrips: 0,
    breakerSuppressed: 0,
    retries: 0,
    throttledByWeight: 0,
  };
}

/** Test helper: force the circuit into OPEN state. */
export function forceCircuitOpen(durationMs: number): void {
  _circuit = "OPEN";
  _circuitOpenUntil = Date.now() + durationMs;
}

/** Clear a single cache key (used after WS-driven refresh invalidation). */
export function invalidateCache(key: string): void {
  _cache.delete(key);
}

// ─── Weight monitoring ─────────────────────────────────────────────

function recordWeightFromHeaders(headers: unknown): void {
  const h = headers as Record<string, string | string[]> | undefined;
  if (!h) return;
  const raw = h["x-mbx-used-weight"] ?? h["X-MBX-USED-WEIGHT"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return;
  const w = Number(value);
  if (Number.isFinite(w) && w >= 0) {
    _usedWeight = w;
    _weightObservedAt = Date.now();
  }
}

function weightThrottled(): boolean {
  const limit = Number(process.env["BINANCE_REST_WEIGHT_LIMIT"]) || WEIGHT_LIMIT_DEFAULT;
  // Weight decays after a quiet window — stale observation beyond the window
  // no longer throttles.
  if (Date.now() - _weightObservedAt > WEIGHT_WINDOW_MS) return false;
  if (_usedWeight >= limit * WEIGHT_SOFT_THRESHOLD_RATIO) return true;
  return false;
}

// ─── Concurrency limiter ───────────────────────────────────────────

async function acquireSlot(): Promise<void> {
  if (_active < MAX_CONCURRENCY) {
    _active++;
    return;
  }
  await new Promise<void>((resolve) => _waiters.push(resolve));
  _active++;
}

function releaseSlot(): void {
  _active--;
  const next = _waiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number): number {
  return Math.floor(ms * (0.5 + Math.random() * 0.5));
}

// ─── Core entry point ──────────────────────────────────────────────

export type RestPolicyOptions = {
  /** Cache key — required. Requests with the same key share cache + dedup. */
  key: string;
  /** Cache TTL for the result. 0 disables result caching (dedup still applies). */
  ttlMs: number;
  /** Raw fetch executor. */
  execute: () => Promise<{ value: unknown; headers?: unknown }>;
};

/**
 * Execute a Binance REST request under the full policy.
 * Throws the underlying error when all retries are exhausted or when the
 * circuit is OPEN (after suppression logging).
 */
export async function executeWithRestPolicy<T>(opts: RestPolicyOptions): Promise<T> {
  const { key, ttlMs } = opts;

  // 1. Circuit breaker — suppress everything while OPEN.
  if (getCircuitState() === "OPEN") {
    _stats.breakerSuppressed++;
    throw new BinanceRestSuppressedError(
      `REST suppressed — Binance circuit OPEN until ${new Date(_circuitOpenUntil).toISOString()}`,
    );
  }

  // 2. Cache hit.
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    _stats.cacheHits++;
    return cached.value as T;
  }

  // 3. In-flight dedup — concurrent callers share one request.
  const pending = _inFlight.get(key);
  if (pending) {
    _stats.dedupJoins++;
    return pending as Promise<T>;
  }

  const exec = _executeWithBackoff(key, ttlMs, opts.execute);
  _inFlight.set(key, exec as Promise<unknown>);
  try {
    return (await exec) as T;
  } finally {
    _inFlight.delete(key);
  }
}

async function _executeWithBackoff<T>(
  key: string,
  ttlMs: number,
  execute: RestPolicyOptions["execute"],
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Weight soft threshold — defer briefly (bounded) rather than burst.
      if (weightThrottled() && attempt === 0) {
        _stats.throttledByWeight++;
        await sleep(jitter(RETRYABLE_TRANSIENT_MS * 2));
      }

      // Bounded concurrency — wait for a slot.
      await acquireSlot();
      let headers: unknown;
      let value: unknown;
      try {
        const result = await execute();
        value = result.value;
        headers = result.headers;
        recordWeightFromHeaders(headers);
      } finally {
        releaseSlot();
      }

      _stats.requestsExecuted++;
      if (ttlMs > 0) {
        _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value as T;
    } catch (err) {
      if (isRateLimitError(err)) {
        // Circuit breaker trip — no retry, suppress future REST.
        _stats.breakerTrips++;
        const banMs = extractBanDurationMs(err) ?? CIRCUIT_OPEN_COOLDOWN_MS;
        _circuit = "OPEN";
        _circuitOpenUntil = Date.now() + Math.max(banMs, CIRCUIT_OPEN_COOLDOWN_MS);
        _cache.clear(); // stale cache better than nothing; keep WS as source
        logger.error(
          "rest-policy",
          `Circuit OPEN for ${Math.round((_circuitOpenUntil - Date.now()) / 1000)}s: ${(err as Error).message}`,
        );
        throw err;
      }

      if (isTransientError(err) && attempt < MAX_RETRIES) {
        attempt++;
        _stats.retries++;
        const delay = Math.min(
          jitter(BACKOFF_BASE_MS * Math.pow(2, attempt - 1)),
          BACKOFF_MAX_MS,
        );
        logger.warn(
          "rest-policy",
          `Transient error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${(err as Error).message}`,
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

// ─── Half-open probe handling ──────────────────────────────────────

/**
 * Called by the executor layer when a request was suppressed earlier.
 * When the circuit is HALF_OPEN, exactly ONE probe request may pass;
 * its success closes the circuit, failure reopens it.
 */
export function allowHalfOpenProbe(): boolean {
  if (getCircuitState() !== "HALF_OPEN") return false;
  if (_probeInFlight) return false;
  _probeInFlight = true;
  return true;
}

export function probeSucceeded(): void {
  _probeInFlight = false;
  _circuit = "CLOSED";
  _circuitOpenUntil = 0;
  logger.info("rest-policy", "Circuit CLOSED after successful probe");
}

export function probeFailed(err: unknown): void {
  _probeInFlight = false;
  _stats.breakerTrips++;
  const banMs = extractBanDurationMs(err) ?? CIRCUIT_OPEN_COOLDOWN_MS;
  _circuit = "OPEN";
  _circuitOpenUntil = Date.now() + Math.max(banMs, CIRCUIT_OPEN_COOLDOWN_MS);
  logger.warn("rest-policy", "Circuit reopened after failed probe");
}

// ─── Suppression error ─────────────────────────────────────────────

export class BinanceRestSuppressedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinanceRestSuppressedError";
  }
}

// ─── Convenience: cached getters used by the client layer ─────────

/**
 * Run an executor with the given cache TTL. Used by binance-testnet.ts for
 * ticker/klines/account fetches so every REST call shares one policy.
 */
export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  execute: () => Promise<{ value: unknown; headers?: unknown }>,
): Promise<T> {
  return executeWithRestPolicy<T>({ key, ttlMs, execute });
}

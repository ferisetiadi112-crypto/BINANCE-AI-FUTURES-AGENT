/**
 * Fetch / async guards — P7D-5.5
 *
 * Every async request that backs UI state must terminate: success, error,
 * or a bounded timeout that surfaces as a structured, displayable error.
 * No `loading === true` state may last forever.
 *
 * Used by the API client to bound every server-function call. Safe to
 * import from client components (no server-only imports).
 */

export type ApiErrorCode = "TIMEOUT" | "SERVER" | "NETWORK" | "UNKNOWN";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly label: string;
  override readonly cause?: unknown;

  constructor(code: ApiErrorCode, label: string, message: string, cause?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.label = label;
    if (cause !== undefined) this.cause = cause;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Race `promise` against a hard timeout. When the timeout wins, the caller
 * receives a structured ApiClientError — loading state can then resolve to
 * an explicit ERROR/DEGRADED state instead of spinning forever.
 *
 * The underlying promise is intentionally not awaited afterwards; its late
 * settlement can no longer mutate any state because no code path observes it.
 */
export async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return await new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ApiClientError(
          "TIMEOUT",
          label,
          `${label} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(normalizeError(label, err));
      },
    );
  }).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Map arbitrary rejection reasons onto ApiClientError with a clear code. */
export function normalizeError(label: string, err: unknown): ApiClientError {
  if (err instanceof ApiClientError) return err;

  if (err instanceof Error) {
    const lower = `${err.name} ${err.message}`.toLowerCase();
    if (err.name === "AbortError" || lower.includes("abort")) {
      return new ApiClientError("TIMEOUT", label, `${label} was aborted (timeout or cancellation).`, err);
    }
    if (/fetch failed|network|load failed|failed to fetch|econnreset|econnrefused|undici/i.test(lower)) {
      return new ApiClientError("NETWORK", label, `${label} network error: ${err.message}`, err);
    }
    // HTTP-ish errors from server functions
    if (/\b(4\d\d|5\d\d)\b/.test(err.message) || err.name === "HTTPError") {
      return new ApiClientError("SERVER", label, `${label} server error: ${err.message}`, err);
    }
    return new ApiClientError("UNKNOWN", label, `${label} failed: ${err.message}`, err);
  }

  return new ApiClientError("UNKNOWN", label, `${label} failed with an unknown error.`, err);
}

// ─── Timeout budgets (seconds→ms) ────────────────────────────────────
// Deliberately non-aggressive: the backend already bounds Binance calls,
// these budgets only protect the UI from ever spinning forever.

/** In-memory / DB-backed server endpoints. */
export const BUDGET_FAST_MS = 8_000;
/** Endpoints that may wait on optional Binance enrichment. */
export const BUDGET_EXCHANGE_MS = 12_000;
/** Boot readiness probe. */
export const BUDGET_BOOT_MS = 8_000;

// ─── Retry policy (shared with react-query) ─────────────────────────
// Polling queries re-run on their refetch interval anyway, so we never do
// aggressive client retries — that would create request storms.

/** Max automatic retries for a transient server error (react-query `retry`). */
export const MAX_AUTO_RETRIES = 1;

/**
 * Deterministic backoff helper for any bounded retry (tests + optional use).
 * attempt is 1-based; returns delay in ms, capped at maxDelayMs.
 */
export function backoffDelayMs(attempt: number, baseMs = 1_000, maxDelayMs = 8_000): number {
  const safe = Math.max(1, Math.floor(attempt));
  return Math.min(baseMs * 2 ** (safe - 1), maxDelayMs);
}

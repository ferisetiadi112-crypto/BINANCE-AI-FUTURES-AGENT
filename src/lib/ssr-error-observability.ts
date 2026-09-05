/**
 * SSR Error Observability — Phase 3.5-X
 *
 * Minimal, dependency-free, secret-safe structured logging for server-side
 * SSR failures that produce renderErrorPage(). Extends the existing
 * error-capture pipeline (describeError/consumeLastCapturedError) with:
 *
 *   - requestId: x-vercel-id header when present, else a generated id
 *   - path + method context
 *   - source: which error path fired ("server_top_level" | "h3_swallowed" | "start_middleware")
 *   - error name/message/sanitized stack/cause chain
 *   - ISO timestamp
 *
 * HARD RULES:
 * - Never logs API keys, secrets, tokens, cookies, Authorization headers,
 *   DATABASE_URL, or any env value. Output is sanitized via redactSecretLike().
 * - Only console output (Vercel Runtime Logs pipeline) — no third-party
 *   telemetry, no new storage, no schema.
 * - Behavior of successful requests and error responses is unchanged.
 */

export type SsrErrorSource =
  | "server_top_level" // server.ts fetch() catch
  | "h3_swallowed" // server.ts normalizeCatastrophicSsrResponse()
  | "start_middleware"; // start.ts errorMiddleware

/** Keys whose values must never appear in logs. */
const FORBIDDEN_KEY_PATTERN =
  /api[-_]?key|api[-_]?secret|authorization|cookie|token|password|secret|signature|database[-_]?url|bearer/i;

/**
 * Redact secret-like strings from free text (error messages/stacks can
 * occasionally embed a connection string or header value).
 */
export function redactSecretLike(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/([A-Za-z0-9_-]{20,})(=[A-Za-z0-9&%_+.-]{8,})/g, "$1=[REDACTED]");
}

function describe(err: unknown): {
  name: string;
  message: string;
  stack: string | null;
  cause: string | null;
} {
  if (err instanceof Error) {
    const chain: string[] = [];
    let cur: unknown = err.cause;
    for (let i = 0; i < 5 && cur != null; i++) {
      chain.push(cur instanceof Error ? `${cur.name}: ${cur.message}` : String(cur));
      cur = cur instanceof Error ? cur.cause : undefined;
    }
    return {
      name: err.name,
      message: redactSecretLike(err.message),
      stack: err.stack ? redactSecretLike(err.stack) : null,
      cause: chain.length ? redactSecretLike(chain.join(" | ")) : null,
    };
  }
  return {
    name: typeof err,
    message: redactSecretLike(String(err)),
    stack: null,
    cause: null,
  };
}

/**
 * Emit one structured, sanitized `ssr_error` log line.
 * Returns the requestId used, so tests/callers can correlate.
 */
export function logSsrError(params: {
  source: SsrErrorSource;
  request?: Request | null;
  error: unknown;
  now?: Date;
}): string {
  const url = (() => {
    try {
      return params.request ? new URL(params.request.url) : null;
    } catch {
      return null;
    }
  })();

  const vercelId = params.request?.headers?.get?.("x-vercel-id") ?? null;
  const requestId =
    vercelId ??
    (globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

  const e = describe(params.error);
  const payload = {
    event: "ssr_error",
    requestId,
    source: params.source,
    path: url?.pathname ?? null,
    method: params.request?.method ?? null,
    timestamp: (params.now ?? new Date()).toISOString(),
    error: e,
  };

  // Single structured line → Vercel Runtime Logs.
  const original = console.error.bind(console);
  original(JSON.stringify(payload));

  return requestId;
}

/** Guard used by tests: verify a candidate payload key/value is loggable. */
export function isLoggableKey(key: string): boolean {
  return !FORBIDDEN_KEY_PATTERN.test(key);
}

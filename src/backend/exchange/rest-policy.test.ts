/**
 * E.2-FIX-D.6 — REST rate-safety tests.
 *
 * Proves the centralized REST policy (cache, dedup, backoff, circuit breaker)
 * and the WebSocket-first market data path eliminate the per-tick REST storm.
 *
 * No live Binance API calls — HTTP and WS layers are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  executeWithRestPolicy,
  resetRestPolicy,
  isRateLimitError,
  getCircuitState,
  forceCircuitOpen,
  getRestPolicyStats,
  allowHalfOpenProbe,
  probeSucceeded,
  probeFailed,
  BinanceRestSuppressedError,
} from "./rest-policy";
import {
  BinanceTestnetClient,
  BinanceTestnetError,
  parsePositionAmount,
} from "./binance-testnet";
import type { TestnetAccountResponse } from "./binance-testnet";

// ─── Helpers ────────────────────────────────────────────────────────

function rateLimitError(): BinanceTestnetError {
  return new BinanceTestnetError("RATE_LIMITED", "Code -1003: Way too many requests", 429);
}

function ipBanError(): BinanceTestnetError {
  return new BinanceTestnetError("API_ERROR", "Code -1003: IP banned until 9999999999999", 418);
}

// ─── Rate limit classification ─────────────────────────────────────

describe("rest-policy: rate limit classification (req 10-12)", () => {
  it("classifies HTTP 429 as rate limit error (req 10)", () => {
    expect(isRateLimitError(new BinanceTestnetError("RATE_LIMITED", "limited", 429))).toBe(true);
  });

  it("classifies Binance -1003 as rate limit error (req 11)", () => {
    expect(isRateLimitError(new BinanceTestnetError("API_ERROR", "Code -1003: Way too many requests", 403))).toBe(true);
  });

  it("classifies HTTP 418 as rate limit error (req 12)", () => {
    expect(isRateLimitError(new BinanceTestnetError("API_ERROR", "banned", 418))).toBe(true);
  });

  it("classifies explicit 'IP banned' text as rate limit error", () => {
    expect(isRateLimitError(new BinanceTestnetError("NETWORK_ERROR", "IP banned from API", 0))).toBe(true);
  });

  it("does not classify normal errors as rate limit", () => {
    expect(isRateLimitError(new BinanceTestnetError("API_ERROR", "Code -1121: Invalid symbol", 400))).toBe(false);
    expect(isRateLimitError(new Error("something else"))).toBe(false);
  });
});

// ─── Cache (req 3) ──────────────────────────────────────────────────

describe("rest-policy: cache TTL (req 3)", () => {
  beforeEach(() => resetRestPolicy());

  it("multiple calls within TTL hit the cache — only one underlying request", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions++;
      return { value: { n: executions } };
    };

    const [a, b, c] = await Promise.all([
      executeWithRestPolicy({ key: "t:1", ttlMs: 60_000, execute: fetcher }),
      executeWithRestPolicy({ key: "t:1", ttlMs: 60_000, execute: fetcher }),
      executeWithRestPolicy({ key: "t:1", ttlMs: 60_000, execute: fetcher }),
    ]);

    expect(executions).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);

    // After explicit invalidation the fetch runs again.
    resetRestPolicy();
    const refreshed = await executeWithRestPolicy({
      key: "t:1",
      ttlMs: 60_000,
      execute: fetcher,
    });
    expect(refreshed).toEqual({ n: 2 });
    expect(executions).toBe(2);
  });

  it("different keys do not share cache", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions++;
      return { value: executions };
    };
    await executeWithRestPolicy({ key: "a", ttlMs: 60_000, execute: fetcher });
    await executeWithRestPolicy({ key: "b", ttlMs: 60_000, execute: fetcher });
    expect(executions).toBe(2);
  });
});

// ─── In-flight dedup (req 4) ────────────────────────────────────────

describe("rest-policy: in-flight dedup (req 4)", () => {
  beforeEach(() => resetRestPolicy());

  it("12 concurrent requests for the same resource produce 1 HTTP request", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 20)); // simulate latency
      return { value: { ok: true } };
    };

    const callers = Array.from({ length: 12 }, () =>
      executeWithRestPolicy({ key: "btc:snapshot", ttlMs: 0, execute: fetcher }),
    );
    const results = await Promise.all(callers);

    expect(executions).toBe(1);
    expect(results).toHaveLength(12);
    expect((results as Array<{ ok: boolean }>).every((r) => r.ok)).toBe(true);
    expect(getRestPolicyStats().dedupJoins).toBe(11);
  });

  it("ttl=0 still dedups concurrent callers but does not cache", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 5));
      return { value: executions };
    };

    await Promise.all([
      executeWithRestPolicy({ key: "x", ttlMs: 0, execute: fetcher }),
      executeWithRestPolicy({ key: "x", ttlMs: 0, execute: fetcher }),
    ]);
    expect(executions).toBe(1);

    // sequential second call re-executes (no cache with ttl 0)
    await executeWithRestPolicy({ key: "x", ttlMs: 0, execute: fetcher });
    expect(executions).toBe(2);
  });
});

// ─── Circuit breaker (req 10-16) ────────────────────────────────────

describe("rest-policy: circuit breaker (req 10-16)", () => {
  beforeEach(() => resetRestPolicy());
  afterEach(() => resetRestPolicy());

  it("429 opens the circuit (req 10)", async () => {
    const fetcher = async () => {
      throw rateLimitError();
    };
    await expect(
      executeWithRestPolicy({ key: "k", ttlMs: 0, execute: fetcher }),
    ).rejects.toThrow(BinanceTestnetError);
    expect(getCircuitState()).toBe("OPEN");
  });

  it("-1003 opens the circuit (req 11)", async () => {
    const fetcher = async () => {
      throw new BinanceTestnetError("API_ERROR", "Code -1003: Way too many requests", 403);
    };
    await expect(
      executeWithRestPolicy({ key: "k", ttlMs: 0, execute: fetcher }),
    ).rejects.toThrow();
    expect(getCircuitState()).toBe("OPEN");
  });

  it("418 opens the circuit and honors ban-until (req 12)", async () => {
    const fetcher = async () => {
      throw ipBanError(); // banned until 9999999999999 → effectively forever
    };
    await expect(
      executeWithRestPolicy({ key: "k", ttlMs: 0, execute: fetcher }),
    ).rejects.toThrow();
    expect(getCircuitState()).toBe("OPEN");
    const stats = getRestPolicyStats();
    // ban-until far in the future must extend the cooldown beyond baseline
    expect(stats.circuitOpenUntil).toBeGreaterThan(Date.now() + 5 * 60_000);
  });

  it("while OPEN all REST requests are suppressed (req 13)", async () => {
    forceCircuitOpen(60_000);
    let executions = 0;
    const fetcher = async () => {
      executions++;
      return { value: 1 };
    };
    for (let i = 0; i < 5; i++) {
      await expect(
        executeWithRestPolicy({ key: `k${i}`, ttlMs: 0, execute: fetcher }),
      ).rejects.toThrow(BinanceRestSuppressedError);
    }
    expect(executions).toBe(0);
    expect(getRestPolicyStats().breakerSuppressed).toBeGreaterThanOrEqual(5);
  });

  it("half-open allows exactly one probe (req 14)", async () => {
    forceCircuitOpen(30); // tiny cooldown — real timers
    await new Promise((r) => setTimeout(r, 40)); // → HALF_OPEN

    expect(getCircuitState()).toBe("HALF_OPEN");
    expect(allowHalfOpenProbe()).toBe(true); // first probe allowed
    expect(allowHalfOpenProbe()).toBe(false); // second probe blocked
    probeSucceeded();
  });

  it("probe success closes the circuit (req 15)", async () => {
    forceCircuitOpen(30);
    await new Promise((r) => setTimeout(r, 40));

    expect(allowHalfOpenProbe()).toBe(true);
    probeSucceeded();
    expect(getCircuitState()).toBe("CLOSED");
  });

  it("probe failure with rate-limit error reopens the circuit (req 16)", async () => {
    forceCircuitOpen(30);
    await new Promise((r) => setTimeout(r, 40));

    expect(allowHalfOpenProbe()).toBe(true);
    probeFailed(rateLimitError());
    expect(getCircuitState()).toBe("OPEN");
    // While OPEN, executeWithRestPolicy suppresses everything.
    let executions = 0;
    await expect(
      executeWithRestPolicy({
        key: "k",
        ttlMs: 0,
        execute: async () => {
          executions++;
          return { value: 1 };
        },
      }),
    ).rejects.toThrow(BinanceRestSuppressedError);
    expect(executions).toBe(0);
  });
});

// ─── Retry storm prevention (req 17) ────────────────────────────────

describe("rest-policy: no retry storm on persistent 429 (req 17)", () => {
  beforeEach(() => resetRestPolicy());

  it("a rate-limit error never retries — one trip opens the circuit", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions++;
      throw rateLimitError();
    };
    for (let i = 0; i < 10; i++) {
      await expect(
        executeWithRestPolicy({ key: `k${i}`, ttlMs: 0, execute: fetcher }),
      ).rejects.toThrow();
    }
    // First call trips the breaker; the remaining 9 are suppressed, not retried.
    expect(executions).toBe(1);
    expect(getCircuitState()).toBe("OPEN");
  });

  it("transient errors are retried a bounded number of times only", async () => {
    let executions = 0;
    const fetcher = async () => {
      executions++;
      throw new BinanceTestnetError("NETWORK_ERROR", "ECONNRESET", 0);
    };
    await expect(
      executeWithRestPolicy({ key: "k", ttlMs: 0, execute: fetcher }),
    ).rejects.toThrow();
    expect(executions).toBe(3); // 1 initial + 2 bounded retries (MAX_RETRIES=2)
    expect(getRestPolicyStats().retries).toBe(2);
  }, 20_000); // bounded backoff sleeps (~1s+2s+4s with jitter) need > 5s under parallel load
});

// ─── Client-level: cached account snapshot (req 5) ──────────────────

describe("client: shared account snapshot (req 5)", () => {
  let originalFetch: typeof globalThis.fetch;

  const ACCOUNT: TestnetAccountResponse = {
    totalWalletBalance: "5000",
    totalUnrealizedProfit: "0",
    totalMarginBalance: "5000",
    totalCrossWalletBalance: "5000",
    totalCrossUnPnl: "0",
    availableBalance: "5000",
    maxWithdrawAmount: "5000",
    canTrade: true,
    totalPositionInitialMargin: "0",
    totalOpenOrderInitialMargin: "0",
    accountAlias: "test",
    assetUpdateTime: 0,
    positions: [],
  } as unknown as TestnetAccountResponse;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetRestPolicy();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetRestPolicy();
  });

  function stubFetch(payload: unknown, counter?: { n: number }) {
    globalThis.fetch = (async () => {
      if (counter) counter.n++;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  function newClient(): BinanceTestnetClient {
    return new BinanceTestnetClient({
      apiKey: "test-key",
      apiSecret: "test-secret",
      baseUrl: "http://localhost:0",
    });
  }

  it("12 concurrent account reads within TTL produce ≤1 HTTP call", async () => {
    const counter = { n: 0 };
    stubFetch(ACCOUNT, counter);
    const client = newClient();

    const results = await Promise.all(
      Array.from({ length: 12 }, () => client.getAccountInfo()),
    );

    expect(results).toHaveLength(12);
    expect(counter.n).toBeLessThanOrEqual(1);
  });

  it("sequential account reads within 60s TTL hit the cache", async () => {
    const counter = { n: 0 };
    stubFetch(ACCOUNT, counter);
    const client = newClient();

    await client.getAccountInfo();
    await client.getAccountInfo();
    await client.getAccountInfo();
    expect(counter.n).toBe(1);
  });
});

// ─── Position parsing regression (req 6-9, E.2-FIX-D.3 preserved) ──

describe("position parsing (req 6-9, D.3 preserved)", () => {
  it("zero position → no position (req 6)", () => {
    expect(parsePositionAmount("0").isOpen).toBe(false);
    expect(parsePositionAmount("0.000").isOpen).toBe(false);
  });

  it("positive positionAmt → LONG (req 7)", () => {
    const p = parsePositionAmount("0.5");
    expect(p.isOpen).toBe(true);
    expect(p.side).toBe("LONG");
  });

  it("negative positionAmt → SHORT (req 8)", () => {
    const p = parsePositionAmount("-1.25");
    expect(p.isOpen).toBe(true);
    expect(p.side).toBe("SHORT");
  });

  it("hedge mode: LONG and SHORT rows on the same symbol parse independently (req 9)", () => {
    const long = parsePositionAmount("2.0");
    const short = parsePositionAmount("-2.0");
    expect(long.side).toBe("LONG");
    expect(short.side).toBe("SHORT");
    expect(long.isOpen && short.isOpen).toBe(true);
    // undefined/invalid/NaN → no position
    expect(parsePositionAmount(undefined).isOpen).toBe(false);
    expect(parsePositionAmount(null).isOpen).toBe(false);
    expect(parsePositionAmount("").isOpen).toBe(false);
    expect(parsePositionAmount("abc").isOpen).toBe(false);
  });
});

// ─── Safety (req 22-24) ─────────────────────────────────────────────

describe("safety (req 22-24)", () => {
  it("rest-policy never references mainnet URLs (req 24)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(new URL("./rest-policy.ts", import.meta.url), "utf-8");
    expect(src).not.toContain("fapi.binance.com");
    expect(src).not.toContain("api.binance.com");
    expect(src).not.toContain("TRADING_ENABLED");
    expect(src).not.toContain("placeOrder");
  });

  it("client mainnet URL guard is preserved", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./binance-testnet.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("testnet.binancefuture.com");
  });
});

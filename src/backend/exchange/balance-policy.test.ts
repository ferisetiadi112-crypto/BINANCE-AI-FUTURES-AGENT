/**
 * E.2-FIX-D.14 — Balance path REST-policy regression tests.
 *
 * Proves the -1003 storm fix:
 * - getBalance() no longer calls /fapi/v2/balance directly; it is served from
 *   the SAME cached /fapi/v2/account snapshot as getAccountInfo().
 * - 10 concurrent account/balance requests → exactly 1 underlying HTTP request.
 * - Second request within TTL → no new Binance request.
 * - Circuit OPEN → zero HTTP requests.
 *
 * No live Binance calls — fetch is stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetRestPolicy, forceCircuitOpen, CACHE_TTL_ACCOUNT_MS } from "./rest-policy";
import { BinanceTestnetClient } from "./binance-testnet";

const ACCOUNT = {
  totalWalletBalance: "5000",
  totalUnrealizedProfit: "0",
  totalMarginBalance: "5000",
  totalCrossWalletBalance: "5000",
  totalCrossUnPnl: "0",
  updateTimestamp: Date.now(),
  accountAlias: "test",
  assets: [
    {
      asset: "USDT",
      walletBalance: "5000",
      unrealizedProfit: "0",
      marginBalance: "5000",
      availableBalance: "5000",
      crossWalletBalance: "5000",
      crossUnPnl: "0",
    },
  ],
  positions: [],
};

function newClient(): BinanceTestnetClient {
  return new BinanceTestnetClient({
    apiKey: "test-key",
    apiSecret: "test-secret",
    baseUrl: "http://localhost:0",
  });
}

function stubFetch(counter?: { n: number }) {
  globalThis.fetch = (async () => {
    if (counter) counter.n++;
    return new Response(JSON.stringify(ACCOUNT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("E.2-FIX-D.14 — balance shares the account snapshot", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetRestPolicy();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetRestPolicy();
  });

  it("10 concurrent account+balance requests → exactly 1 underlying HTTP request", async () => {
    const counter = { n: 0 };
    stubFetch(counter);
    const client = newClient();

    const calls = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? client.getAccountInfo() : client.getUSDTBalance(),
    );
    await Promise.all(calls);

    expect(counter.n).toBe(1);
  });

  it("second request within TTL makes no new Binance request", async () => {
    const counter = { n: 0 };
    stubFetch(counter);
    const client = newClient();

    await client.getAccountInfo();
    await client.getUSDTBalance(); // must come from the same cached snapshot
    expect(counter.n).toBe(1);
    expect(CACHE_TTL_ACCOUNT_MS).toBe(60_000);
  });

  it("getBalance returns balance-shaped rows derived from the account snapshot", async () => {
    stubFetch();
    const client = newClient();
    const balances = await client.getBalance();
    expect(balances).toHaveLength(1);
    expect(balances[0]!.asset).toBe("USDT");
    expect(balances[0]!.availableBalance).toBe("5000");
    expect(balances[0]!.balance).toBe("5000");
  });

  it("circuit OPEN → zero HTTP requests on the balance path", async () => {
    forceCircuitOpen(60_000);
    const counter = { n: 0 };
    stubFetch(counter);
    const client = newClient();

    await expect(client.getBalance()).rejects.toThrow();
    await expect(client.getAccountInfo()).rejects.toThrow();
    expect(counter.n).toBe(0);
  });
});

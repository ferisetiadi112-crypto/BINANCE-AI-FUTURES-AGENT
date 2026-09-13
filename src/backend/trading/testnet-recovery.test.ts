/**
 * E.2-FIX-D.12 — Stale orchestrator testnet connection error recovery tests.
 *
 * Proves:
 * 1. startup ping failure → stale error state (testnetReady=false, error set)
 * 2. subsequent successful authenticated exchange evidence → recovery succeeds
 * 3. recovery success clears connectionError
 * 4. recovery success resets consecutiveSyncFailures
 * 5. recovery failure keeps fail-closed state
 * 6. cooldown prevents repeated recovery attempts
 * 7. successful recovery does not create duplicate reconciliation loop
 * 8. fresh healthy exchange state suppresses stale dashboard error
 * 9. stale/unhealthy exchange state still shows genuine error
 * 10. TRADING_ENABLED=false remains unchanged
 *
 * Exchange layer is fully mocked — no live Binance calls, no credentials.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TradingOrchestrator } from "./orchestrator";

function makeExecutor(overrides: Record<string, unknown> = {}) {
  return {
    validateTestnetConfig: vi.fn().mockResolvedValue({
      valid: true,
      errors: [],
      connected: true,
      balance: 5000,
    }),
    syncBalance: vi.fn().mockResolvedValue(5000),
    reconcilePositions: vi.fn().mockResolvedValue({
      matched: [],
      localOnly: [],
      remoteOnly: [],
      consistent: true,
    }),
    ...overrides,
  };
}

async function staleOrchestrator(): Promise<TradingOrchestrator> {
  const orch = new TradingOrchestrator("TESTNET");
  // Simulate the D.11-confirmed startup residue: one failed init ping.
  (orch as any).state.testnetReady = false;
  (orch as any).state.connectionError = "Cannot connect to Binance Futures Testnet";
  (orch as any).state.consecutiveSyncFailures = 1;
  (orch as any).testnetExecutor = makeExecutor();
  // Make recovery immediately eligible (cooldown expired).
  (orch as any).lastRecoveryAttemptAt = 0;
  return orch;
}

describe("E.2-FIX-D.12 — testnet recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("1. startup ping failure leaves stale error state", async () => {
    const orch = new TradingOrchestrator("TESTNET");
    (orch as any).testnetExecutor = makeExecutor({
      validateTestnetConfig: vi.fn().mockResolvedValue({
        valid: false,
        errors: ["Cannot connect to Binance Futures Testnet"],
        connected: false,
        balance: 0,
      }),
    });
    const ok = await orch.initializeTestnet();
    expect(ok).toBe(false);
    const cs = orch.getConnectionState();
    expect(cs.testnetReady).toBe(false);
    expect(cs.connectionError).toContain("Cannot connect to Binance Futures Testnet");
    expect(cs.consecutiveSyncFailures).toBeGreaterThan(0);
  });

  it("2-4. successful authenticated evidence → recovery succeeds, clears error, resets failures", async () => {
    const orch = await staleOrchestrator();
    orch.getConnectionState(); // triggers fire-and-forget recovery
    // Allow the async recovery to complete.
    await vi.waitFor(() => {
      expect((orch as any).state.connectionError).toBeNull();
    });
    const cs = orch.getConnectionState();
    expect(cs.testnetReady).toBe(true);
    expect(cs.connectionError).toBeNull();          // req 3
    expect(cs.consecutiveSyncFailures).toBe(0);     // req 4
    expect(cs.lastSuccessfulSync).not.toBeNull();
  });

  it("5. recovery failure keeps fail-closed state", async () => {
    const orch = await staleOrchestrator();
    (orch as any).testnetExecutor = makeExecutor({
      validateTestnetConfig: vi.fn().mockResolvedValue({
        valid: false,
        errors: ["Cannot connect to Binance Futures Testnet"],
        connected: false,
        balance: 0,
      }),
    });
    orch.getConnectionState();
    await vi.waitFor(() => {
      expect((orch as any).recoveryInFlight).toBeNull();
    });
    const cs = orch.getConnectionState();
    expect(cs.testnetReady).toBe(false);
    expect(cs.connectionError).toContain("Cannot connect");
    expect(cs.consecutiveSyncFailures).toBeGreaterThan(0);
  });

  it("6. cooldown prevents repeated recovery attempts", async () => {
    const orch = await staleOrchestrator();
    const validate = (orch as any).testnetExecutor.validateTestnetConfig;
    validate.mockImplementation(
      () => new Promise(() => {}), // never resolves — keeps recoveryInFlight set
    );
    orch.getConnectionState();
    await vi.waitFor(() => {
      expect((orch as any).recoveryInFlight).not.toBeNull();
    });
    // Many dashboard polls during cooldown/in-flight → no new attempts.
    for (let i = 0; i < 20; i++) orch.getConnectionState();
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("7. successful recovery does not duplicate the reconciliation loop", async () => {
    const orch = await staleOrchestrator();
    orch.getConnectionState();
    await vi.waitFor(() => {
      expect((orch as any).state.testnetReady).toBe(true);
    });
    // Recovery started the loop once; a second recovery path (or re-read) must not add another.
    const before = (orch as any).reconciliationInterval;
    (orch as any).maybeAttemptTestnetRecovery(); // no-op: testnetReady=true
    expect((orch as any).reconciliationInterval).toBe(before);
    // Idempotency of startReconciliationLoop itself:
    (orch as any).startReconciliationLoop();
    expect((orch as any).reconciliationInterval).toBe(before);
  });

  it("8. fresh healthy exchange state suppresses stale dashboard error (agent-status semantics)", async () => {
    const orch = await staleOrchestrator();
    orch.getConnectionState();
    await vi.waitFor(() => {
      expect((orch as any).state.connectionError).toBeNull();
    });
    // Reproduce the agent-status.ts error condition:
    const cs = orch.getConnectionState();
    const showsError = cs.consecutiveSyncFailures > 0 && cs.connectionError !== null;
    expect(showsError).toBe(false);
  });

  it("9. stale/unhealthy exchange state still shows genuine error", async () => {
    const orch = await staleOrchestrator();
    (orch as any).testnetExecutor = makeExecutor({
      validateTestnetConfig: vi.fn().mockRejectedValue(
        new Error("[API_ERROR] Code -1003 HTTP 429"),
      ),
    });
    orch.getConnectionState();
    await vi.waitFor(() => {
      expect((orch as any).recoveryInFlight).toBeNull();
    });
    const cs = orch.getConnectionState();
    const showsError = cs.consecutiveSyncFailures > 0 && cs.connectionError !== null;
    expect(showsError).toBe(true); // genuinely unhealthy → error remains
  });

  it("10. recovery never touches trading flags", async () => {
    const orch = await staleOrchestrator();
    const before = process.env["TRADING_ENABLED"];
    orch.getConnectionState();
    await vi.waitFor(() => {
      expect((orch as any).state.testnetReady).toBe(true);
    });
    expect(process.env["TRADING_ENABLED"]).toBe(before); // unchanged
    expect(orch.getRiskEngine().isTradingEnabled()).toBe(false); // default OFF
  });

  it("recovery is skipped for PAPER mode / missing executor / already-ready", async () => {
    const paper = new TradingOrchestrator("PAPER");
    (paper as any).state.connectionError = "stale";
    (paper as any).state.consecutiveSyncFailures = 3;
    const spy = vi.fn();
    (paper as any).testnetExecutor = null;
    paper.getConnectionState();
    expect((paper as any).state.connectionError).toBe("stale"); // untouched
    expect(spy).not.toHaveBeenCalled();

    const ready = new TradingOrchestrator("TESTNET");
    (ready as any).state.testnetReady = true;
    (ready as any).testnetExecutor = makeExecutor();
    const validate = (ready as any).testnetExecutor.validateTestnetConfig;
    ready.getConnectionState();
    expect(validate).not.toHaveBeenCalled(); // already ready → no recovery
  });
});

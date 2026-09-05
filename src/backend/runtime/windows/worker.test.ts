/**
 * Phase 3.8-A — Windows persistent runtime foundation tests.
 *
 * A  worker initialization            G  graceful shutdown
 * B  default safe mode                H  scheduler lifecycle (heartbeat timer)
 * C  TRADING_ENABLED=false gate       I  stale tick detection
 * D  heartbeat generation             J  status separation
 * E  instance ID generation           K  no credential logging
 * F  uptime calculation
 */
import { describe, expect, it, vi } from "vitest";
import {
  HeartbeatTracker,
  STALE_TICK_MS,
  defaultClock,
  type HeartbeatClock,
} from "./heartbeat";
import { createWindowsWorker, loadWorkerConfig } from "./worker";

function fakeClock(start = 1_000_000): HeartbeatClock & { advance(ms: number): void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("HeartbeatTracker", () => {
  it("D. generates a complete heartbeat payload", () => {
    const clock = fakeClock();
    const hb = new HeartbeatTracker("TESTNET", clock, () => "win-host");
    const snap = hb.beat();
    expect(snap.runtime).toBe("windows");
    expect(snap.status).toBe("STARTING");
    expect(snap.mode).toBe("TESTNET");
    expect(snap.lastHeartbeatAt).toBeTruthy();
    expect(snap.hostname).toBe("win-host");
    expect(snap.lastTickAt).toBe(0);
  });

  it("E. generates a unique non-empty instanceId per tracker", () => {
    const a = new HeartbeatTracker("TESTNET", fakeClock(), () => null).beat();
    const b = new HeartbeatTracker("TESTNET", fakeClock(), () => null).beat();
    expect(a.instanceId).toBeTruthy();
    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it("F. computes uptimeSeconds from the injected clock", () => {
    const clock = fakeClock();
    const hb = new HeartbeatTracker("TESTNET", clock, () => null);
    clock.advance(61_500);
    expect(hb.beat().uptimeSeconds).toBe(61);
  });

  it("I. runtimeLoopAlive=false when last tick is stale (3×15s window)", () => {
    const clock = fakeClock();
    const hb = new HeartbeatTracker("TESTNET", clock, () => null);
    hb.setStatus("RUNNING");
    hb.recordTick(clock.now());
    clock.advance(STALE_TICK_MS + 1);
    expect(hb.beat().runtimeLoopAlive).toBe(false);
    expect(hb.beat().status).toBe("RUNNING"); // process status ≠ loop freshness
  });

  it("I(b). runtimeLoopAlive=true for a fresh tick", () => {
    const clock = fakeClock();
    const hb = new HeartbeatTracker("TESTNET", clock, () => null);
    hb.setStatus("RUNNING");
    hb.recordTick(clock.now());
    clock.advance(1_000);
    expect(hb.beat().runtimeLoopAlive).toBe(true);
  });

  it("J. status separation: stale loop does not fabricate RUNNING evidence, tradingEnabled always false", () => {
    const clock = fakeClock();
    const hb = new HeartbeatTracker("TESTNET", clock, () => null);
    hb.setStatus("RUNNING");
    hb.recordTick(clock.now());
    clock.advance(STALE_TICK_MS + 5_000);
    const snap = hb.beat();
    expect(snap.runtimeLoopAlive).toBe(false);
    expect(snap.tradingEnabled).toBe(false);
    expect(snap.mode).toBe("TESTNET");
  });
});

describe("loadWorkerConfig (safety gate)", () => {
  it("B. defaults to safe mode: TESTNET, heartbeat 15s", () => {
    const cfg = loadWorkerConfig({});
    expect(cfg.mode).toBe("TESTNET");
    expect(cfg.heartbeatIntervalMs).toBe(15_000);
  });

  it("C. refuses startup when TRADING_ENABLED=true (no bypass)", () => {
    expect(() => loadWorkerConfig({ TRADING_ENABLED: "true" })).toThrow(/SAFETY GATE/);
    expect(() => loadWorkerConfig({ TRADING_ENABLED: "false" })).not.toThrow();
    expect(() => loadWorkerConfig({})).not.toThrow();
  });

  it("C(b). invalid/unset heartbeat env falls back to the default", () => {
    expect(loadWorkerConfig({ RUNTIME_HEARTBEAT_INTERVAL_MS: "abc" }).heartbeatIntervalMs).toBe(15_000);
    expect(loadWorkerConfig({ RUNTIME_HEARTBEAT_INTERVAL_MS: "20000" }).heartbeatIntervalMs).toBe(20_000);
  });
});

describe("createWindowsWorker", () => {
  it("A. initializes and reports a heartbeat without starting trading", async () => {
    vi.mock("../../trading/runtime", () => ({
      startTradingRuntime: vi.fn().mockResolvedValue({}),
      stopTradingRuntime: vi.fn(),
      getRuntimeSnapshot: vi.fn().mockReturnValue({
        stats: { lastTickAt: 0 },
      }),
    }));
    const { createWindowsWorker: fresh } = await import("./worker");
    const worker = await fresh({ mode: "TESTNET", heartbeatIntervalMs: 15_000 });
    const hb = worker.getHeartbeat();
    expect(hb.status).toBe("STARTING");
    expect(hb.tradingEnabled).toBe(false);
    await worker.shutdown("test");
    expect(worker.getHeartbeat().status).toBe("STOPPED");
  });

  it("G. shutdown is idempotent and marks STOPPED", async () => {
    vi.mock("../../trading/runtime", () => ({
      startTradingRuntime: vi.fn().mockResolvedValue({}),
      stopTradingRuntime: vi.fn(),
      getRuntimeSnapshot: vi.fn().mockReturnValue({ stats: { lastTickAt: 0 } }),
    }));
    const { createWindowsWorker: fresh } = await import("./worker");
    const worker = await fresh({ mode: "PAPER", heartbeatIntervalMs: 15_000 });
    await worker.shutdown("first");
    await worker.shutdown("second"); // must not throw
    expect(worker.getHeartbeat().status).toBe("STOPPED");
    expect(worker.getHeartbeat().mode).toBe("PAPER");
  });
});

describe("K. no credential logging", () => {
  it("heartbeat payload contains no secret-like fields", () => {
    const clock = fakeClock();
    const hb = new HeartbeatTracker("TESTNET", clock, () => "win-host");
    const snap = hb.beat() as unknown as Record<string, unknown>;
    const forbidden = /api[-_]?key|secret|authorization|token|password|signature|database[-_]?url|bearer/i;
    for (const key of Object.keys(snap)) {
      expect(forbidden.test(key)).toBe(false);
    }
    expect(JSON.stringify(snap).toLowerCase()).not.toContain("binance_testnet");
  });

  it("defaultClock is wall-clock based", () => {
    expect(typeof defaultClock.now()).toBe("number");
  });
});

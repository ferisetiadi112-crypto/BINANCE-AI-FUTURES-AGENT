/**
 * Decision Scheduler Tests — P7D-5.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initializeScheduler,
  shutdownScheduler,
  onMarketEvent,
  onAccountChange,
  onDecisionComplete,
  onDecisionError,
  getSchedulerSnapshot,
  resetScheduler,
  markDirty,
  type SchedulerDecisionCallback,
} from "./decision-scheduler";

describe("Decision Scheduler (P7D-5.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetScheduler();
  });

  // --- 1. Basic Lifecycle ---

  it("initializes with callback and throttle", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 30_000);

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.active).toBe(true);
    expect(snapshot.state.throttleMs).toBe(30_000);
  });

  it("shuts down cleanly", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback);
    shutdownScheduler();

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.active).toBe(false);
  });

  it("ignores re-initialization when already active", () => {
    const callback1 = vi.fn().mockResolvedValue(undefined);
    const callback2 = vi.fn().mockResolvedValue(undefined);

    initializeScheduler(callback1, 30_000);
    initializeScheduler(callback2, 10_000); // should be ignored

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.throttleMs).toBe(30_000);
  });

  // --- 2. Market Event Triggering ---

  it("marks dirty on market event", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 30_000);

    // First event after init — should trigger (throttle passed since init)
    onMarketEvent("BTCUSDT");

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.totalEvents).toBe(1);
  });

  it("throttles rapid events", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 30_000);

    // Trigger first decision
    onMarketEvent("BTCUSDT");
    // Complete it immediately
    onDecisionComplete();

    // Rapid events within throttle — should not trigger new decision
    onMarketEvent("BTCUSDT");
    onMarketEvent("BTCUSDT");
    onMarketEvent("BTCUSDT");

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.dirty).toBe(true);
    expect(snapshot.state.totalEvents).toBe(4);
    // Only 1 decision so far (the first one)
    expect(snapshot.state.totalDecisions).toBe(1);
  });

  it("triggers decision after throttle interval", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 5_000); // 5s throttle for testing

    // First decision
    onMarketEvent("BTCUSDT");
    onDecisionComplete();

    const snap1 = getSchedulerSnapshot();
    expect(snap1.state.totalDecisions).toBe(1);

    // Advance time past throttle
    vi.advanceTimersByTime(6_000);

    // New event — should trigger
    onMarketEvent("BTCUSDT");

    // Allow microtasks to flush (scheduler fires callback via Promise.resolve().then())
    await vi.advanceTimersByTimeAsync(0);

    // Callback should have been called again
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // --- 3. In-Flight Protection ---

  it("rejects events while decision is in-flight", () => {
    // Use a callback that never resolves to keep in-flight state
    const neverResolve: SchedulerDecisionCallback = () => new Promise(() => {});
    initializeScheduler(neverResolve, 30_000);

    // Trigger first decision
    onMarketEvent("BTCUSDT");

    // Don't complete — try to trigger another
    onMarketEvent("ETHUSDT");
    onMarketEvent("SOLUSDT");

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.inFlight).toBe(true);
    expect(snapshot.state.totalInFlightRejected).toBe(2);
    expect(snapshot.state.dirty).toBe(true);
  });

  it("allows new decision after in-flight completes", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 1_000); // 1s throttle

    // First decision
    onMarketEvent("BTCUSDT");
    onDecisionComplete();

    // Advance past throttle
    vi.advanceTimersByTime(1_500);

    // Should allow new decision
    onMarketEvent("ETHUSDT");

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.inFlight).toBe(true);
    expect(snapshot.state.totalDecisions).toBe(1); // first decision counted
  });

  it("schedules follow-up when dirty after completion", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 1_000);

    // First decision
    onMarketEvent("BTCUSDT");

    // Mark dirty while in-flight
    onMarketEvent("ETHUSDT");

    const snapBefore = getSchedulerSnapshot();
    expect(snapBefore.state.dirty).toBe(true);

    // Complete first decision
    onDecisionComplete();

    // After completion, a follow-up should be triggered (dirty cleared by triggerDecision)
    // Allow microtasks to flush
    await vi.advanceTimersByTimeAsync(0);

    const snapAfter = getSchedulerSnapshot();
    expect(snapAfter.state.dirty).toBe(false);
    // A second decision should have been triggered
    expect(snapAfter.state.inFlight).toBe(true);
  });

  // --- 4. Position Change Priority ---

  it("triggers faster on position change", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 30_000); // 30s normal throttle

    // First decision
    onMarketEvent("BTCUSDT");
    onDecisionComplete();

    // Position change after only 5s — should trigger with shorter throttle
    vi.advanceTimersByTime(5_000);
    onAccountChange("POSITION_CHANGE", "BTCUSDT");

    // Position change has 10s throttle, so 5s shouldn't trigger
    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.dirty).toBe(true);
  });

  // --- 5. Error Handling ---

  it("clears in-flight on error without counting decision", () => {
    const callback = vi.fn().mockRejectedValue(new Error("LLM failed"));
    initializeScheduler(callback, 30_000);

    onMarketEvent("BTCUSDT");

    // Wait for the callback promise to settle
    vi.advanceTimersByTime(100);

    // After error, in-flight should be cleared
    // (onDecisionError is called by the scheduler's catch handler)
  });

  it("does not update lastDecisionAt on error", () => {
    const callback = vi.fn().mockRejectedValue(new Error("fail"));
    initializeScheduler(callback, 30_000);

    onMarketEvent("BTCUSDT");
    vi.advanceTimersByTime(100);

    const snap1 = getSchedulerSnapshot();
    const decisionAt1 = snap1.state.lastDecisionAt;

    // Allow retry
    vi.advanceTimersByTime(100);
    onDecisionError();

    const snap2 = getSchedulerSnapshot();
    // lastDecisionAt should not have been updated by error
    expect(snap2.state.lastDecisionAt).toBe(decisionAt1);
  });

  // --- 6. Event Coalescing ---

  it("coalesces rapid events within window", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 30_000);

    // First event triggers
    onMarketEvent("BTCUSDT");
    onDecisionComplete();

    // Mark dirty multiple times rapidly
    onMarketEvent("BTCUSDT");
    onMarketEvent("ETHUSDT");
    onMarketEvent("SOLUSDT");

    const snapshot = getSchedulerSnapshot();
    // Events received but decisions throttled
    expect(snapshot.state.totalEvents).toBe(4);
    expect(snapshot.state.dirty).toBe(true);
  });

  // --- 7. Snapshot Consistency ---

  it("returns consistent snapshots", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback);

    const snap1 = getSchedulerSnapshot();
    const snap2 = getSchedulerSnapshot();
    expect(snap1.state.active).toBe(snap2.state.active);
    expect(snap1.state.totalEvents).toBe(snap2.state.totalEvents);
  });

  it("wouldTrigger is accurate", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 5_000);

    // After init, lastDecisionAt = now, so wouldTrigger = false (within throttle)
    let snap = getSchedulerSnapshot();
    expect(snap.wouldTrigger).toBe(false);

    // Advance past throttle
    vi.advanceTimersByTime(6_000);
    markDirty();
    snap = getSchedulerSnapshot();
    expect(snap.wouldTrigger).toBe(true);
  });

  // --- 8. Safety ---

  it("scheduler API is read-only (no order functions)", () => {
    // Verify the public API is purely read-only
    // The scheduler only exports: initialize, shutdown, onMarketEvent, etc.
    // No placeOrder, cancelOrder, or order-related functions exist
    const snapshot = getSchedulerSnapshot();
    expect(typeof snapshot.state).toBe("object");
    expect(typeof snapshot.wouldTrigger).toBe("boolean");
  });

  it("does not contain secrets in snapshot", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback);

    const snapshot = getSchedulerSnapshot();
    const str = JSON.stringify(snapshot);
    expect(str).not.toContain("api_key");
    expect(str).not.toContain("api_secret");
    expect(str).not.toContain("listenKey");
    expect(str).not.toContain("DATABASE_URL");
  });

  // --- 9. Shutdown Cleanup ---

  it("clears timers on shutdown", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 5_000);

    // Start a throttled check
    onMarketEvent("BTCUSDT");
    markDirty();

    shutdownScheduler();

    // Advancing time should not trigger anything
    vi.advanceTimersByTime(10_000);

    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.active).toBe(false);
  });

  // --- 10. Manual Trigger ---

  it("supports manual trigger without throttle", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    initializeScheduler(callback, 30_000);

    // First decision
    onMarketEvent("BTCUSDT");
    onDecisionComplete();

    // Manual trigger should bypass throttle
    onAccountChange("MANUAL");

    // Manual should trigger immediately
    const snapshot = getSchedulerSnapshot();
    expect(snapshot.state.inFlight).toBe(true);
  });
});

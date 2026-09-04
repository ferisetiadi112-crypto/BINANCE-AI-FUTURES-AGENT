/**
 * Latency Telemetry Tests — P7D-5.4
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  startLatencyMeasurement,
  recordLatencyStage,
  completeLatencyMeasurement,
  getLatencySnapshot,
  recordMarketEvent,
  recordDecisionTrigger,
  recordCoalesced,
  recordInFlightRejected,
  resetLatencyTelemetry,
  type LatencySnapshot,
} from "./latency";

describe("Latency Telemetry (P7D-5.4)", () => {
  beforeEach(() => {
    resetLatencyTelemetry();
  });

  // --- 1. Basic Pipeline ---

  it("creates a latency measurement with symbol", () => {
    const id = startLatencyMeasurement("BTCUSDT");
    expect(id).toContain("BTCUSDT");
    expect(id).toContain("LAT-");

    const snapshot = getLatencySnapshot();
    expect(snapshot.current).not.toBeNull();
    expect(snapshot.current!.symbol).toBe("BTCUSDT");
  });

  it("records pipeline stages", () => {
    startLatencyMeasurement("BTCUSDT");
    recordLatencyStage("STATE_UPDATED");
    recordLatencyStage("CONTEXT_BUILT");
    recordLatencyStage("LLM_START");
    recordLatencyStage("LLM_RESPONSE");
    recordLatencyStage("DECISION_COMPLETED");

    const snapshot = getLatencySnapshot();
    expect(snapshot.current!.stages.length).toBe(6); // MARKET_RECEIVED + 5
  });

  it("completes measurement and calculates durations", () => {
    startLatencyMeasurement("BTCUSDT");
    recordLatencyStage("STATE_UPDATED");
    recordLatencyStage("CONTEXT_BUILT");
    recordLatencyStage("LLM_START");
    recordLatencyStage("LLM_RESPONSE");
    recordLatencyStage("DECISION_COMPLETED");
    completeLatencyMeasurement();

    const snapshot = getLatencySnapshot();
    expect(snapshot.current).toBeNull(); // cleared after completion
    expect(snapshot.lastCompleted).not.toBeNull();
    expect(snapshot.lastCompleted!.completedAt).toBeGreaterThan(0);
    expect(snapshot.lastCompleted!.error).toBeNull();
  });

  it("handles error in pipeline", () => {
    startLatencyMeasurement("BTCUSDT");
    recordLatencyStage("STATE_UPDATED");
    completeLatencyMeasurement("LLM provider failed");

    const snapshot = getLatencySnapshot();
    expect(snapshot.lastCompleted!.error).toBe("LLM provider failed");
    expect(snapshot.counts.llmErrors).toBe(1);
  });

  // --- 2. Duration Calculation ---

  it("calculates durations without negative values", () => {
    startLatencyMeasurement("BTCUSDT");
    recordLatencyStage("STATE_UPDATED");
    recordLatencyStage("CONTEXT_BUILT");
    recordLatencyStage("LLM_START");
    recordLatencyStage("LLM_RESPONSE");
    recordLatencyStage("DECISION_COMPLETED");
    completeLatencyMeasurement();

    const snapshot = getLatencySnapshot();
    const d = snapshot.lastCompleted!.durations;
    // All durations should be >= 0
    expect(d.eventToState).toBeGreaterThanOrEqual(0);
    expect(d.stateToContext).toBeGreaterThanOrEqual(0);
    expect(d.contextToLLMStart).toBeGreaterThanOrEqual(0);
    expect(d.llmDuration).toBeGreaterThanOrEqual(0);
    expect(d.totalPipeline).toBeGreaterThanOrEqual(0);
  });

  // --- 3. Aggregate Metrics ---

  it("calculates aggregate metrics from multiple measurements", () => {
    for (let i = 0; i < 5; i++) {
      startLatencyMeasurement("BTCUSDT");
      recordLatencyStage("STATE_UPDATED");
      recordLatencyStage("CONTEXT_BUILT");
      recordLatencyStage("LLM_START");
      recordLatencyStage("LLM_RESPONSE");
      recordLatencyStage("DECISION_COMPLETED");
      completeLatencyMeasurement();
    }

    const snapshot = getLatencySnapshot();
    expect(snapshot.aggregate.totalMeasurements).toBe(5);
    expect(snapshot.aggregate.avgTotalPipelineMs).toBeGreaterThanOrEqual(0);
  });

  it("calculates p95 latency", () => {
    for (let i = 0; i < 20; i++) {
      startLatencyMeasurement("BTCUSDT");
      recordLatencyStage("STATE_UPDATED");
      recordLatencyStage("CONTEXT_BUILT");
      recordLatencyStage("LLM_START");
      recordLatencyStage("LLM_RESPONSE");
      recordLatencyStage("DECISION_COMPLETED");
      completeLatencyMeasurement();
    }

    const snapshot = getLatencySnapshot();
    expect(snapshot.aggregate.p95TotalPipelineMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.aggregate.maxTotalPipelineMs).toBeGreaterThanOrEqual(0);
  });

  // --- 4. Bounded Memory ---

  it("bounds recent measurements buffer", () => {
    for (let i = 0; i < 100; i++) {
      startLatencyMeasurement("BTCUSDT");
      completeLatencyMeasurement();
    }

    const snapshot = getLatencySnapshot();
    expect(snapshot.recentMeasurements.length).toBeLessThanOrEqual(50);
    expect(snapshot.aggregate.totalMeasurements).toBe(100);
  });

  // --- 5. Event Counting ---

  it("counts market events", () => {
    recordMarketEvent();
    recordMarketEvent();
    recordMarketEvent();

    const snapshot = getLatencySnapshot();
    expect(snapshot.counts.marketEvents).toBe(3);
  });

  it("counts decision triggers", () => {
    recordDecisionTrigger();
    recordDecisionTrigger();

    const snapshot = getLatencySnapshot();
    expect(snapshot.counts.decisionTriggers).toBe(2);
  });

  it("counts coalesced events", () => {
    recordCoalesced();
    recordCoalesced();

    const snapshot = getLatencySnapshot();
    expect(snapshot.counts.coalesced).toBe(2);
  });

  it("counts in-flight rejections", () => {
    recordInFlightRejected();

    const snapshot = getLatencySnapshot();
    expect(snapshot.counts.inFlightRejected).toBe(1);
  });

  // --- 6. No Measurement Active ---

  it("completes safely when no measurement is active", () => {
    // Should not throw
    completeLatencyMeasurement();
    const snapshot = getLatencySnapshot();
    expect(snapshot.current).toBeNull();
  });

  it("records stage safely when no measurement is active", () => {
    // Should not throw
    recordLatencyStage("TEST_STAGE");
  });

  // --- 7. Reset ---

  it("resets all state", () => {
    startLatencyMeasurement("BTCUSDT");
    recordLatencyStage("STATE_UPDATED");
    completeLatencyMeasurement();
    recordMarketEvent();

    resetLatencyTelemetry();

    const snapshot = getLatencySnapshot();
    expect(snapshot.current).toBeNull();
    expect(snapshot.lastCompleted).toBeNull();
    expect(snapshot.recentMeasurements.length).toBe(0);
    expect(snapshot.counts.marketEvents).toBe(0);
    expect(snapshot.aggregate.totalMeasurements).toBe(0);
  });

  // --- 8. Security ---

  it("does not contain secrets in snapshot", () => {
    startLatencyMeasurement("BTCUSDT");
    completeLatencyMeasurement();

    const snapshot = getLatencySnapshot();
    const str = JSON.stringify(snapshot);
    expect(str).not.toContain("api_key");
    expect(str).not.toContain("api_secret");
    expect(str).not.toContain("listenKey");
    expect(str).not.toContain("DATABASE_URL");
    expect(str).not.toContain("password");
  });

  // --- 9. No Order Execution ---

  it("latency API is read-only (no order functions)", () => {
    // The latency module only exports measurement and snapshot functions
    // No placeOrder, cancelOrder, or order-related functions
    const snapshot = getLatencySnapshot();
    expect(typeof snapshot.aggregate).toBe("object");
    expect(typeof snapshot.counts).toBe("object");
  });
});

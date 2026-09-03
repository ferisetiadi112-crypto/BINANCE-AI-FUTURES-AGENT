/**
 * P7A — Effective Allocation Tests
 *
 * effectiveAllocation = min(real Futures USDⓈ-M available balance, $10)
 *
 * $10 is a MAXIMUM guardrail — never a wallet balance and never a deposit
 * target. Any non-finite / negative / missing value fail-closes to 0.
 */

import { describe, it, expect } from "vitest";
import {
  AI_ALLOCATION_MAX,
  computeEffectiveAllocation,
  computeAllocationRemaining,
  checkAllocationWithinEffectiveLimit,
} from "./allocation";

describe("computeEffectiveAllocation", () => {
  it("returns 0 when Futures balance is 0", () => {
    expect(computeEffectiveAllocation(0)).toBe(0);
  });

  it("returns 0 when Futures balance is negative", () => {
    expect(computeEffectiveAllocation(-5)).toBe(0);
    expect(computeEffectiveAllocation(-0.01)).toBe(0);
  });

  it("returns the real balance when below the $10 max", () => {
    expect(computeEffectiveAllocation(2)).toBe(2);
    expect(computeEffectiveAllocation(4)).toBe(4);
    expect(computeEffectiveAllocation(9.99)).toBeCloseTo(9.99);
  });

  it("caps at exactly $10 when Futures balance equals $10", () => {
    expect(computeEffectiveAllocation(10)).toBe(AI_ALLOCATION_MAX);
  });

  it("caps at $10 when Futures balance exceeds $10", () => {
    expect(computeEffectiveAllocation(10.01)).toBe(AI_ALLOCATION_MAX);
    expect(computeEffectiveAllocation(100)).toBe(AI_ALLOCATION_MAX);
    expect(computeEffectiveAllocation(1000)).toBe(AI_ALLOCATION_MAX);
  });

  it("fail-closes to 0 on NaN and Infinity", () => {
    expect(computeEffectiveAllocation(Number.NaN)).toBe(0);
    expect(computeEffectiveAllocation(Number.POSITIVE_INFINITY)).toBe(0);
    expect(computeEffectiveAllocation(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("computeAllocationRemaining", () => {
  it("returns effective - allocated when positive", () => {
    expect(computeAllocationRemaining(10, 4)).toBe(6);
    expect(computeAllocationRemaining(4, 0)).toBe(4);
  });

  it("never returns negative — clamps to 0", () => {
    expect(computeAllocationRemaining(4, 4.5)).toBe(0);
    expect(computeAllocationRemaining(10, 12)).toBe(0);
  });

  it("returns 0 when effective allocation is 0 or invalid", () => {
    expect(computeAllocationRemaining(0, 0)).toBe(0);
    expect(computeAllocationRemaining(Number.NaN, 1)).toBe(0);
  });

  it("returns full effective allocation when nothing is allocated", () => {
    expect(computeAllocationRemaining(2.5, 0)).toBe(2.5);
  });
});

describe("checkAllocationWithinEffectiveLimit", () => {
  it("allows proposed margin within the effective allocation", () => {
    const r = checkAllocationWithinEffectiveLimit(10, 4, 5);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(6);
  });

  it("rejects when currentAllocatedMargin + proposedMargin exceeds effective allocation", () => {
    const r = checkAllocationWithinEffectiveLimit(10, 6, 4.01);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(4);
    expect(r.reason).toContain("exceeds remaining allocation");
  });

  it("rejects everything when effective allocation is 0 (fail closed)", () => {
    const r = checkAllocationWithinEffectiveLimit(0, 0, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fail closed");
  });

  it("rejects invalid proposed margin", () => {
    const r = checkAllocationWithinEffectiveLimit(10, 0, Number.NaN);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Proposed margin is invalid");
  });
});
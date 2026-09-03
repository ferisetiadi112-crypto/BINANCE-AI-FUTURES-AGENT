/**
 * P7 — Real Capital Allocation Helpers
 *
 * BINANCE AI FUTURES AGENT v0.1
 *
 * The AI trading allocation is:
 *
 *   effectiveAllocation = min(real Futures USDⓈ-M available balance, $10)
 *
 * $10 is a MAXIMUM guardrail, NOT a wallet balance and NOT a deposit target.
 * Spot / Funding / other wallet balances are IRRELEVANT to AI trading capital.
 *
 * If the Futures available balance cannot be determined reliably (NaN,
 * negative, missing, API failure), the result is 0 → trading fail closed.
 */

/** Hard maximum AI trading allocation (USDT). Authoritative P3 policy. */
export const AI_ALLOCATION_MAX = 10.0;

/**
 * Compute the effective AI allocation from the REAL Futures USDⓈ-M
 * available balance. Never exceeds AI_ALLOCATION_MAX.
 *
 * Fail closed: any non-finite / negative / missing value → 0.
 */
export function computeEffectiveAllocation(
  futuresAvailableBalance: number,
): number {
  if (
    futuresAvailableBalance === null ||
    futuresAvailableBalance === undefined ||
    !Number.isFinite(futuresAvailableBalance) ||
    futuresAvailableBalance <= 0
  ) {
    return 0;
  }
  return Math.min(futuresAvailableBalance, AI_ALLOCATION_MAX);
}

/**
 * Remaining allocation after committed margin.
 * Never negative — clamped to 0.
 */
export function computeAllocationRemaining(
  effectiveAllocation: number,
  allocatedMargin: number,
): number {
  if (!Number.isFinite(effectiveAllocation) || effectiveAllocation <= 0) return 0;
  if (!Number.isFinite(allocatedMargin) || allocatedMargin <= 0) return effectiveAllocation;
  return Math.max(0, effectiveAllocation - allocatedMargin);
}

/**
 * Validate that a proposed trade fits within the effective allocation:
 *   currentAllocatedMargin + proposedMargin <= effectiveAllocation
 *
 * Returns { ok, remaining, reason }.
 */
export function checkAllocationWithinEffectiveLimit(
  effectiveAllocation: number,
  allocatedMargin: number,
  proposedMargin: number,
): { ok: boolean; remaining: number; reason: string } {
  if (!Number.isFinite(effectiveAllocation) || effectiveAllocation <= 0) {
    return {
      ok: false,
      remaining: 0,
      reason: "Effective allocation is 0 — futures balance unavailable or zero; trading blocked (fail closed)",
    };
  }
  if (!Number.isFinite(proposedMargin) || proposedMargin <= 0) {
    return {
      ok: false,
      remaining: computeAllocationRemaining(effectiveAllocation, allocatedMargin),
      reason: "Proposed margin is invalid",
    };
  }
  const remaining = computeAllocationRemaining(effectiveAllocation, allocatedMargin);
  if (proposedMargin > remaining) {
    return {
      ok: false,
      remaining,
      reason: `Proposed margin $${proposedMargin.toFixed(2)} exceeds remaining allocation $${remaining.toFixed(2)} (effective: $${effectiveAllocation.toFixed(2)})`,
    };
  }
  return { ok: true, remaining, reason: "OK" };
}
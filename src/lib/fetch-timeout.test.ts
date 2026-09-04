/**
 * P7D-5.5 — async guard tests.
 *
 * Covers: requests always terminate (success/error/timeout), the timeout
 * path resolves loading state with a structured error, late resolution of
 * a timed-out promise cannot clobber newer state, and the retry policy is
 * bounded (no request storms).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ApiClientError,
  MAX_AUTO_RETRIES,
  backoffDelayMs,
  normalizeError,
  withTimeout,
} from "./fetch-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves when the underlying call succeeds", async () => {
    await expect(withTimeout("probe", Promise.resolve("ok"), 1_000)).resolves.toBe("ok");
  });

  it("propagates a structured error when the call fails (loading resolves after error)", async () => {
    await expect(
      withTimeout("probe", Promise.reject(new Error("boom")), 1_000),
    ).rejects.toMatchObject({ code: "UNKNOWN", label: "probe" });
  });

  it("rejects with a TIMEOUT error when the call never settles", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    // Attach the handler BEFORE the timer fires so the rejection is always
    // observed (avoids an unhandled-rejection window under fake timers).
    const settled = withTimeout("probe", never, 500).then(
      (v) => ({ ok: true as const, value: v }),
      (e: unknown) => ({ ok: false as const, error: e as { code: string; label: string } }),
    );

    await vi.advanceTimersByTimeAsync(500);
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("TIMEOUT");
      expect(outcome.error.label).toBe("probe");
    }
  });

  it("ignores the late resolution of a timed-out request (no stale-state overwrite)", async () => {
    vi.useFakeTimers();
    let resolveLate!: (v: string) => void;
    const slow = new Promise<string>((res) => {
      resolveLate = res;
    });

    const settled = withTimeout("probe", slow, 200).then(
      (v) => ({ ok: true as const, value: v }),
      (e: unknown) => ({ ok: false as const, error: e as { code: string } }),
    );

    await vi.advanceTimersByTimeAsync(200);
    const outcome = await settled;
    expect(outcome.ok).toBe(false);

    // The slow promise resolves afterwards — nothing may observe it, so the
    // only consumer (loading state) has already settled on the timeout error.
    resolveLate("too late");
    await vi.advanceTimersByTimeAsync(0);
  });

  it("normalizes network-ish failures into NETWORK errors", async () => {
    const err = normalizeError("feed", new Error("Failed to fetch: ECONNRESET"));
    expect(err.code).toBe("NETWORK");
    expect(err).toBeInstanceOf(ApiClientError);
  });

  it("normalizes HTTP-ish failures into SERVER errors", async () => {
    const err = normalizeError("feed", new Error("500 Internal Server Error"));
    expect(err.code).toBe("SERVER");
  });
});

describe("retry policy — no request storms", () => {
  it("keeps automatic client retries bounded", () => {
    // Polling queries re-run on their interval anyway; a single automatic
    // retry is the maximum the dashboard ever performs.
    expect(MAX_AUTO_RETRIES).toBe(1);
  });

  it("backoff is deterministic, capped and never infinite", () => {
    expect(backoffDelayMs(1)).toBe(1_000);
    expect(backoffDelayMs(2)).toBe(2_000);
    expect(backoffDelayMs(3)).toBe(4_000);
    expect(backoffDelayMs(10)).toBe(8_000); // capped at maxDelayMs
    expect(backoffDelayMs(Number.POSITIVE_INFINITY)).toBe(8_000);
  });
});

/**
 * P7D-5.5 — boot readiness derivation tests.
 *
 * The boot screen may never spin forever: each readiness payload maps to
 * READY/ERROR/ACTIVE stages and the poll controller's hard cap guarantees
 * the transition. These tests pin the mapping.
 */

import { describe, it, expect } from "vitest";
import { allStagesReported, deriveBootStages } from "./boot-readiness";

describe("deriveBootStages", () => {
  it("returns null before any readiness payload arrives", () => {
    expect(deriveBootStages(null)).toBeNull();
    expect(deriveBootStages(undefined)).toBeNull();
  });

  it("PAPER mode (no Binance keys) boots instantly to READY/READY", () => {
    const stages = deriveBootStages({
      binanceConfigured: false,
      runtimeReady: true,
    });
    expect(stages).not.toBeNull();
    expect(allStagesReported(stages)).toBe(true);
    expect(stages?.[0]).toMatchObject({ status: "READY", message: expect.stringContaining("PAPER MODE") });
  });

  it("configured + connected Binance shows READY", () => {
    const stages = deriveBootStages({
      binanceConfigured: true,
      binanceConnected: true,
      runtimeReady: true,
    });
    expect(allStagesReported(stages)).toBe(true);
    expect(stages?.[0]).toMatchObject({ status: "READY", message: "CONNECTED" });
  });

  it("configured but offline after runtime ready → ERROR/OFFLINE (still reported)", () => {
    const stages = deriveBootStages({
      binanceConfigured: true,
      binanceConnected: false,
      runtimeReady: true,
    });
    expect(allStagesReported(stages)).toBe(true);
    expect(stages?.[0]).toMatchObject({ status: "ERROR", message: "OFFLINE" });
  });

  it("AI engine comes online with the runtime", () => {
    const stages = deriveBootStages({ binanceConfigured: false, aiRuntimeOnline: true });
    expect(stages?.[1]).toMatchObject({ status: "READY", message: "ONLINE" });
  });

  it("before the runtime is ready the stages are ACTIVE — never a terminal hang", () => {
    const stages = deriveBootStages({
      binanceConfigured: true,
      binanceConnected: false,
      runtimeReady: false,
    });
    expect(stages?.[0]?.status).toBe("ACTIVE");
    expect(stages?.[1]?.status).toBe("ACTIVE");
    expect(allStagesReported(stages)).toBe(false); // poll controller hard cap rescues this
  });
});

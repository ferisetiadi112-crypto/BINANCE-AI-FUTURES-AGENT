import { describe, expect, it } from "vitest";
import { timeLabel } from "./chat-agent";

/**
 * Phase 3.8-D.15 regression: the Chat Agent UI must never render
 * "Invalid Date" when a message timestamp is missing or malformed.
 */
describe("chat-agent timeLabel", () => {
  it("formats a valid ISO timestamp", () => {
    const out = timeLabel("2026-09-06T03:35:23.979Z");
    expect(out).not.toBe("—");
    expect(out).not.toContain("Invalid");
    // HH:MM shape
    expect(out).toMatch(/^\d{1,2}:\d{2}( AM| PM)?$/);
  });

  it("returns placeholder for missing timestamp", () => {
    expect(timeLabel(null as unknown as string)).toBe("—");
    expect(timeLabel("" as unknown as string)).toBe("—");
    expect(timeLabel(undefined as unknown as string)).toBe("—");
  });

  it("returns placeholder for invalid timestamp strings", () => {
    expect(timeLabel("not-a-date")).toBe("—");
    expect(timeLabel("2026-13-45T99:99:99Z")).toBe("—");
  });
});

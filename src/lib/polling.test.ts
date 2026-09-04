/**
 * P7D-5.5 — polling controller tests.
 *
 * Covers: polling ends when the condition is met, a hard max-wait ALWAYS
 * terminates polling (no infinite boot), poll errors are tolerated, and
 * dispose() (component unmount) clears every timer.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createPollController } from "./polling";

afterEach(() => {
  vi.useRealTimers();
});

async function tickAll(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("createPollController", () => {
  it("polls immediately, then stops once the condition is met", async () => {
    vi.useFakeTimers();
    let polls = 0;
    let done = 0;
    const controller = createPollController({
      intervalMs: 100,
      maxWaitMs: 10_000,
      onPoll: async () => {
        polls += 1;
        return polls >= 2; // ready on the second poll
      },
      onDone: () => {
        done += 1;
      },
    });

    controller.start();
    await tickAll(0);
    expect(polls).toBe(1);
    expect(done).toBe(0);

    await tickAll(100);
    expect(polls).toBe(2);
    expect(done).toBe(1);

    // No further polling after finish.
    await tickAll(1_000);
    expect(polls).toBe(2);
    expect(done).toBe(1);
  });

  it("always terminates at maxWaitMs even if the condition is never met", async () => {
    vi.useFakeTimers();
    let done = 0;
    const controller = createPollController({
      intervalMs: 1_000,
      maxWaitMs: 5_000,
      onPoll: async () => false,
      onDone: () => {
        done += 1;
      },
    });

    controller.start();
    await tickAll(4_500);
    expect(done).toBe(0); // still within budget

    await tickAll(500); // crosses maxWaitMs
    expect(done).toBe(1);

    await tickAll(5_000);
    expect(done).toBe(1); // exactly once
  });

  it("keeps polling when onPoll rejects (server not ready)", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const controller = createPollController({
      intervalMs: 100,
      maxWaitMs: 1_000,
      onPoll: async () => {
        polls += 1;
        if (polls === 1) throw new Error("not ready");
        return true;
      },
      onDone: () => {},
    });

    controller.start();
    await tickAll(0);
    expect(polls).toBe(1); // first attempt rejected, not terminal

    await tickAll(100);
    expect(polls).toBe(2); // polled again and finished
  });

  it("dispose() clears timers — component unmount stops polling forever", async () => {
    vi.useFakeTimers();
    let polls = 0;
    let done = 0;
    const controller = createPollController({
      intervalMs: 100,
      maxWaitMs: 1_000,
      onPoll: async () => {
        polls += 1;
        return false;
      },
      onDone: () => {
        done += 1;
      },
    });

    controller.start();
    await tickAll(0);
    expect(polls).toBe(1);

    controller.dispose(); // unmount

    await tickAll(5_000);
    expect(polls).toBe(1); // interval stopped
    expect(done).toBe(0); // max-wait timer stopped — no late onDone after unmount
    expect(controller.isFinished()).toBe(false);
  });

  it("is idempotent — double dispose / start after finish is safe", async () => {
    vi.useFakeTimers();
    let done = 0;
    const controller = createPollController({
      intervalMs: 100,
      maxWaitMs: 300,
      onPoll: async () => true,
      onDone: () => {
        done += 1;
      },
    });

    controller.start();
    await tickAll(0);
    expect(done).toBe(1);
    controller.dispose();
    controller.dispose();
    controller.start(); // no-op after finish
    await tickAll(1_000);
    expect(done).toBe(1);
  });
});

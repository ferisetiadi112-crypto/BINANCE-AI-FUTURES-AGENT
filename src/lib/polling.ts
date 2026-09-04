/**
 * Polling controller — P7D-5.5
 *
 * Small, framework-free polling primitive used where the UI must poll a
 * status endpoint with its own loop (currently the P7D-4.5 boot screen).
 *
 * Guarantees:
 * - Polls on an interval AND once immediately on start.
 * - A hard `maxWaitMs` timer ALWAYS fires `onDone` even if the polled
 *   status never changes (no infinite loading).
 * - `dispose()` clears every timer/interval — safe for component unmount.
 * - Polling stops permanently after the first `true` from `onPoll`
 *   (transition ready) or after `maxWaitMs`.
 *
 * onPoll may reject (server not ready) — that is swallowed and polling
 * simply continues until it returns true or maxWaitMs elapses.
 */

export type PollControllerOptions = {
  intervalMs: number;
  /** Hard cap — onDone is guaranteed to run no later than this. */
  maxWaitMs: number;
  /** Return true when the polled condition is satisfied. */
  onPoll: () => Promise<boolean> | boolean;
  onDone: () => void;
};

export type PollController = {
  start: () => void;
  dispose: () => void;
  /** True once polling has finished (condition met or max wait elapsed). */
  isFinished: () => boolean;
};

export function createPollController(opts: PollControllerOptions): PollController {
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  let disposed = false;

  function finish() {
    if (finished || disposed) return;
    finished = true;
    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);
    interval = null;
    timeout = null;
    opts.onDone();
  }

  async function pollOnce() {
    if (finished || disposed) return;
    let ready = false;
    try {
      ready = (await opts.onPoll()) === true;
    } catch {
      // Server may not be ready yet — keep polling.
    }
    if (ready) finish();
  }

  return {
    start() {
      if (disposed || finished) return;
      timeout = setTimeout(finish, Math.max(0, opts.maxWaitMs));
      interval = setInterval(() => {
        void pollOnce();
      }, Math.max(1, opts.intervalMs));
      void pollOnce();
    },
    dispose() {
      disposed = true;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      interval = null;
      timeout = null;
    },
    isFinished() {
      return finished;
    },
  };
}

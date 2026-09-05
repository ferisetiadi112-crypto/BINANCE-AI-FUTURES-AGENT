/**
 * Phase 3.8-A — Windows Persistent Runtime Worker.
 *
 * A long-lived Node.js process that HOSTS the existing trading runtime
 * lifecycle (startTradingRuntime → tick → orchestrator → feed → decision →
 * risk → executor), independent of Vercel serverless lifecycle.
 *
 * FOUNDATION ONLY:
 * - Trading stays gated by the existing env check (TRADING_ENABLED === "true").
 *   This worker additionally REFUSES to start if TRADING_ENABLED is "true",
 *   because this phase proves persistence, not execution.
 * - No order/cancel/modify capability is added here.
 * - Market feed lifecycle is inherited from the existing runtime/FeedManager —
 *   no second feed implementation.
 *
 * STATUS SEPARATION is preserved: heartbeat reports process status, runtime
 * loop freshness, and tradingEnabled independently; nothing is inferred.
 */

import { logger } from "../../logger";
import {
  startTradingRuntime,
  stopTradingRuntime,
  getRuntimeSnapshot,
} from "../../trading/runtime";
import {
  HeartbeatTracker,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  type WindowsRuntimeHeartbeat,
  type RuntimeMode,
} from "./heartbeat";

// ─── Configuration (explicit, env-driven, no secrets) ───────────────

export type WorkerConfig = {
  mode: RuntimeMode;
  heartbeatIntervalMs: number;
};

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const tradingEnabled = env["TRADING_ENABLED"] === "true";
  if (tradingEnabled) {
    // Safety gate: Phase 3.8-A is non-trading. Refuse rather than bypass.
    throw new Error(
      "SAFETY GATE: TRADING_ENABLED=true is not permitted for the Windows runtime worker in Phase 3.8-A. Start with TRADING_ENABLED unset or false.",
    );
  }
  const mode: RuntimeMode = env["RUNTIME_MODE"] === "PAPER" ? "PAPER" : "TESTNET";
  const heartbeatEnv = Number(env["RUNTIME_HEARTBEAT_INTERVAL_MS"]);
  const heartbeatIntervalMs =
    Number.isFinite(heartbeatEnv) && heartbeatEnv >= 1_000
      ? heartbeatEnv
      : DEFAULT_HEARTBEAT_INTERVAL_MS;
  return { mode, heartbeatIntervalMs };
}

// ─── Worker ─────────────────────────────────────────────────────────

export type WindowsWorker = {
  start(): Promise<void>;
  shutdown(reason: string): Promise<void>;
  getHeartbeat(): WindowsRuntimeHeartbeat;
};

export async function createWindowsWorker(
  config: WorkerConfig = loadWorkerConfig(),
): Promise<WindowsWorker> {
  const heartbeat = new HeartbeatTracker(config.mode);
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function start(): Promise<void> {
    if (running) return;
    running = true;
    logger.info("windows-runtime", `Worker starting: mode=${config.mode}, tradingEnabled=false`);

    // Host the EXISTING runtime lifecycle — no duplicate engine. The second
    // argument is the existing env-gated tradingEnabled (false in this phase).
    const tradingEnabled = false;
    await startTradingRuntime(config.mode, tradingEnabled);
    heartbeat.setStatus("RUNNING");

    heartbeatTimer = setInterval(() => {
      // Record fresh tick evidence from the hosted runtime and emit a beat.
      const stats = getRuntimeSnapshot().stats;
      if (stats.lastTickAt > 0) heartbeat.recordTick(stats.lastTickAt);
      heartbeat.beat();
      logger.info(
        "windows-runtime",
        `heartbeat: status=${heartbeat.snapshot().status} uptime=${heartbeat.snapshot().uptimeSeconds}s lastTickAt=${stats.lastTickAt}`,
      );
    }, config.heartbeatIntervalMs);
  }

  async function shutdown(reason: string): Promise<void> {
    if (!running) {
      // Idempotent: converge to STOPPED even if start() never completed.
      heartbeat.setStatus("STOPPED");
      return;
    }
    running = false;
    heartbeat.setStatus("STOPPING");
    logger.info("windows-runtime", `Worker shutting down: ${reason}`);

    // 1–3. stop scheduler/tick loop/reconciliation timer (existing stopTradingRuntime)
    // 4. feed/websocket teardown is owned by orchestrator.stop() inside it.
    stopTradingRuntime();
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    heartbeat.setStatus("STOPPED");
    heartbeat.beat();
    logger.info("windows-runtime", "Worker stopped cleanly");
  }

  function getHeartbeat(): WindowsRuntimeHeartbeat {
    const stats = getRuntimeSnapshot().stats;
    if (stats.lastTickAt > 0) heartbeat.recordTick(stats.lastTickAt);
    return heartbeat.snapshot();
  }

  return { start, shutdown, getHeartbeat };
}

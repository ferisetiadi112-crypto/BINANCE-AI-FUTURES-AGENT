/**
 * Phase 3.8-A — Windows Persistent Runtime Heartbeat.
 *
 * Explicit heartbeat for the persistent worker process. Pure data model +
 * pure computation so it is testable without a live process.
 *
 * STATUS SEPARATION (hard rule):
 *   PROCESS alive  ≠ RUNTIME ticking ≠ MARKET feed online ≠ AI decision exists
 *   ≠ trading enabled. Each is reported independently; none is inferred from
 *   another. No credential, secret, or env value is ever included.
 */

import { randomUUID } from "node:crypto";
import * as os from "node:os";

export type RuntimeMode = "TESTNET" | "PAPER";

export type WorkerStatus = "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "ERROR";

export type WindowsRuntimeHeartbeat = {
  runtime: "windows";
  status: WorkerStatus;
  instanceId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  /** 0 until the hosted runtime loop performs its first tick. */
  lastTickAt: number;
  uptimeSeconds: number;
  mode: RuntimeMode;
  tradingEnabled: boolean;
  /** True only when the hosted runtime ticked within its staleness window. */
  runtimeLoopAlive: boolean;
  hostname: string | null;
};

/** Milliseconds between heartbeats (overridable for tests / env config). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function safeHostname(): string | null {
  try {
    return typeof os.hostname === "function" ? os.hostname() : null;
  } catch {
    return null;
  }
}

export type HeartbeatClock = {
  now(): number;
};

export const defaultClock: HeartbeatClock = { now: () => Date.now() };

/**
 * Mutable heartbeat state for one worker instance. Pure-ish: time comes from
 * the injected clock so tests can drive it deterministically.
 */
export class HeartbeatTracker {
  private readonly instanceId = randomUUID();
  private readonly startedAtMs: number;
  private lastHeartbeatMs: number;
  private lastTickMs = 0;
  private status: WorkerStatus = "STARTING";

  constructor(
    private readonly mode: RuntimeMode,
    private readonly clock: HeartbeatClock = defaultClock,
    hostnameFn: () => string | null = safeHostname,
  ) {
    this.startedAtMs = clock.now();
    this.lastHeartbeatMs = this.startedAtMs;
    this.hostname = hostnameFn();
  }

  private readonly hostname: string | null;

  setStatus(status: WorkerStatus): void {
    this.status = status;
  }

  recordTick(tickTimestampMs: number): void {
    this.lastTickMs = Math.max(this.lastTickMs, tickTimestampMs);
  }

  beat(): WindowsRuntimeHeartbeat {
    this.lastHeartbeatMs = this.clock.now();
    return this.snapshot();
  }

  snapshot(): WindowsRuntimeHeartbeat {
    const now = this.clock.now();
    const runtimeLoopAlive =
      this.status === "RUNNING" &&
      this.lastTickMs > 0 &&
      now - this.lastTickMs <= STALE_TICK_MS;
    return {
      runtime: "windows",
      status: this.status,
      instanceId: this.instanceId,
      startedAt: new Date(this.startedAtMs).toISOString(),
      lastHeartbeatAt: new Date(this.lastHeartbeatMs).toISOString(),
      lastTickAt: this.lastTickMs,
      uptimeSeconds: Math.floor((now - this.startedAtMs) / 1000),
      mode: this.mode,
      tradingEnabled: false,
      runtimeLoopAlive,
      hostname: this.hostname,
    };
  }
}

/**
 * Staleness window for the worker's own tick loop. Mirrors the Phase 3.7
 * rule (3× 15s tick interval) so "RUNNING" means the same thing on Windows
 * as it does on the web runtime.
 */
export const STALE_TICK_MS = 3 * 15_000;

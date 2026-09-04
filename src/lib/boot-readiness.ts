/**
 * Boot readiness derivation — P7D-4.5 / P7D-5.5
 *
 * Pure mapping from a system-readiness payload to the two boot stages
 * (BINANCE FUTURES TESTNET, AI ENGINE). Kept framework-free so the boot
 * screen logic is unit-testable and can never spin forever.
 */

export type BootStageStatus = "WAITING" | "ACTIVE" | "READY" | "ERROR";

export type BootStage = {
  id: string;
  label: string;
  status: BootStageStatus;
  message?: string;
};

export type BootReadinessPayload = {
  binanceConfigured?: boolean | null;
  binanceConnected?: boolean | null;
  runtimeReady?: boolean | null;
  runtimeRunning?: boolean | null;
  aiRuntimeOnline?: boolean | null;
  error?: string | null;
};

/**
 * Derive both boot stages from one readiness payload.
 * Returns null when no payload has been received yet.
 */
export function deriveBootStages(
  data: BootReadinessPayload | null | undefined,
): BootStage[] | null {
  if (!data) return null;

  // 1. BINANCE FUTURES TESTNET
  let binance: BootStage;
  if (!data.binanceConfigured) {
    binance = { id: "binance", label: "BINANCE FUTURES TESTNET", status: "READY", message: "PAPER MODE — Not configured" };
  } else if (data.binanceConnected) {
    binance = { id: "binance", label: "BINANCE FUTURES TESTNET", status: "READY", message: "CONNECTED" };
  } else if (data.runtimeReady) {
    binance = { id: "binance", label: "BINANCE FUTURES TESTNET", status: "ERROR", message: "OFFLINE" };
  } else {
    binance = { id: "binance", label: "BINANCE FUTURES TESTNET", status: "ACTIVE", message: "CONNECTING..." };
  }

  // 2. AI ENGINE
  const aiOnline = data.aiRuntimeOnline || data.runtimeReady;
  const ai: BootStage = aiOnline
    ? { id: "ai-engine", label: "AI ENGINE", status: "READY", message: "ONLINE" }
    : { id: "ai-engine", label: "AI ENGINE", status: "ACTIVE", message: "INITIALIZING..." };

  return [binance, ai];
}

/**
 * A stage has "reported" once it reached READY or ERROR — i.e. the boot
 * screen may transition. ACTIVE forever is never a terminal state; the
 * polling controller's maxWaitMs hard-cap rescues that case.
 */
export function allStagesReported(stages: BootStage[] | null): boolean {
  if (!stages || stages.length === 0) return false;
  return stages.every((s) => s.status === "READY" || s.status === "ERROR");
}

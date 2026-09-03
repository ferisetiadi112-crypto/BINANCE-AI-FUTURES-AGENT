/**
 * SystemBoot — P7D-4.5 Game-Like Loading Screen
 *
 * Fullscreen cinematic boot sequence that verifies system readiness
 * by polling getSystemReadiness server function.
 *
 * Boot stages (in order):
 *  1. DATABASE — PostgreSQL connection
 *  2. BINANCE — Futures Testnet connection
 *  3. AI RUNTIME — Trading orchestrator
 *  4. RISK ENGINE — Risk management
 *  5. DASHBOARD — Final preparation
 *
 * After all stages READY → transitions to main system.
 * On refresh: if sessionStorage has systemBooted=true, skip boot.
 */

import { useState, useEffect, useCallback } from "react";
import { fetchSystemReadiness } from "@/api/client";

// ─── Types ──────────────────────────────────────────────────────────

type StageStatus = "WAITING" | "ACTIVE" | "READY" | "ERROR";

interface BootStage {
  id: string;
  label: string;
  status: StageStatus;
  message?: string | undefined;
}

// ─── Constants ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1_500;
const STORAGE_KEY = "orbital_system_booted";

// ─── Helpers ────────────────────────────────────────────────────────

function getStoredBootState(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setStoredBootState(value: boolean): void {
  try {
    if (value) {
      sessionStorage.setItem(STORAGE_KEY, "true");
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable (SSR, private mode, etc.)
  }
}

// ─── Component ──────────────────────────────────────────────────────

interface SystemBootProps {
  onReady: () => void;
}

export function SystemBoot({ onReady }: SystemBootProps) {
  const [stages, setStages] = useState<BootStage[]>([
    { id: "database", label: "DATABASE", status: "WAITING" },
    { id: "binance", label: "BINANCE FUTURES TESTNET", status: "WAITING" },
    { id: "ai-runtime", label: "AI RUNTIME", status: "WAITING" },
    { id: "risk-engine", label: "RISK ENGINE", status: "WAITING" },
    { id: "dashboard", label: "DASHBOARD", status: "WAITING" },
  ]);
  const [bootPhase, setBootPhase] = useState<"BOOTING" | "SYSTEM_READY" | "TRANSITIONING">("BOOTING");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Elapsed timer
  useEffect(() => {
    if (bootPhase !== "BOOTING") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [bootPhase]);

  // Stage status helper
  const updateStage = useCallback(
    (id: string, status: StageStatus, message?: string) => {
      setStages((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status, message } : s))
      );
    },
    [],
  );

  // Poll readiness
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const resp = await fetchSystemReadiness();
        if (cancelled) return;

        const data = resp?.data;
        if (!data) return;

        // 1. DATABASE
        if (data.databaseReady) {
          updateStage("database", "READY", data.databaseConfigured ? "NEON POSTGRESQL" : "SQLite");
        } else if (data.databaseConfigured) {
          updateStage("database", "ACTIVE", "Menghubungkan database...");
        } else {
          updateStage("database", "READY", "SQLite (embedded)");
        }

        // 2. BINANCE
        if (!data.binanceConfigured) {
          updateStage("binance", "READY", "PAPER MODE — Tidak dikonfigurasi");
        } else if (data.binanceConnected) {
          updateStage("binance", "READY", "Terkoneksi");
        } else if (data.runtimeReady) {
          // Runtime is ready but binance not connected — could be testnet issue
          updateStage("binance", "READY", data.executionMode === "PAPER" ? "PAPER MODE" : "Tidak terhubung");
        } else {
          updateStage("binance", "ACTIVE", "Menghubungkan...");
        }

        // 3. AI RUNTIME
        if (data.aiRuntimeOnline) {
          updateStage("ai-runtime", "READY", "ONLINE");
        } else if (data.runtimeReady) {
          updateStage("ai-runtime", "READY", "Initialized");
        } else {
          updateStage("ai-runtime", "ACTIVE", "Starting...");
        }

        // 4. RISK ENGINE
        if (data.riskEngineReady) {
          updateStage("risk-engine", "READY", data.tradingEnabled ? "ACTIVE (Trading ON)" : "PROTECTED (Trading OFF)");
        } else if (data.runtimeReady) {
          updateStage("risk-engine", "READY", "PROTECTED");
        } else {
          updateStage("risk-engine", "ACTIVE", "Initializing...");
        }

        // 5. DASHBOARD
        if (data.systemReady) {
          updateStage("dashboard", "READY", "System ready");
        } else {
          updateStage("dashboard", "ACTIVE", "Preparing...");
        }

        // Check for errors
        if (data.error) {
          setError(data.error);
        }

        // System fully ready
        if (data.systemReady) {
          setBootPhase("SYSTEM_READY");
          // Brief pause then transition
          setTimeout(() => {
            if (!cancelled) {
              setStoredBootState(true);
              setBootPhase("TRANSITIONING");
              setTimeout(() => {
                if (!cancelled) onReady();
              }, 600);
            }
          }, 800);
        }
      } catch {
        // Server might not be ready yet — keep polling
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [updateStage, onReady]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[oklch(0.08_0.015_175)] text-foreground">
      {/* Background grid effect */}
      <div className="absolute inset-0 grid-field opacity-30" />

      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none scanlines" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-lg px-6">
        {/* Logo / Title */}
        <div className="mb-2 text-center">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.35em] text-primary/60">
            SYSTEM BOOT
          </div>
        </div>

        <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
          <span className="text-primary glow-text">ORBITAL</span>
          <span className="ml-2 text-foreground/80">·AI</span>
        </h1>

        <div className="mt-1 font-mono text-xs uppercase tracking-[0.25em] text-primary/50">
          FUTURES COMMAND
        </div>

        {/* Central indicator */}
        <div className="my-8 relative">
          <div className={`h-10 w-10 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
            bootPhase === "SYSTEM_READY"
              ? "border-gain bg-gain/10 shadow-[0_0_20px_oklch(0.8_0.18_158_/_40%)]"
              : error
                ? "border-loss bg-loss/10"
                : "border-primary/60 bg-primary/5"
          }`}>
            {bootPhase === "SYSTEM_READY" ? (
              <svg className="h-5 w-5 text-gain" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : error ? (
              <span className="text-loss text-lg">✕</span>
            ) : (
              <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
            )}
          </div>
          {/* Rotating ring */}
          {bootPhase === "BOOTING" && (
            <div className="absolute inset-0 rounded-full border border-primary/30 animate-spin" style={{ animationDuration: "3s" }} />
          )}
        </div>

        {/* Stage list */}
        <div className="w-full space-y-2">
          {stages.map((stage) => (
            <div
              key={stage.id}
              className={`flex items-center gap-3 rounded-sm border px-4 py-2.5 font-mono text-xs transition-all duration-300 ${
                stage.status === "READY"
                  ? "border-gain/30 bg-gain/5"
                  : stage.status === "ACTIVE"
                    ? "border-primary/30 bg-primary/5"
                    : stage.status === "ERROR"
                      ? "border-loss/30 bg-loss/5"
                      : "border-hairline/30 bg-muted/10"
              }`}
            >
              {/* Status icon */}
              <div className="flex-shrink-0 w-4 text-center">
                {stage.status === "READY" ? (
                  <span className="text-gain text-sm">●</span>
                ) : stage.status === "ACTIVE" ? (
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                ) : stage.status === "ERROR" ? (
                  <span className="text-loss text-sm">✕</span>
                ) : (
                  <span className="text-muted-foreground/40 text-sm">○</span>
                )}
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <span className={`${
                  stage.status === "READY"
                    ? "text-gain"
                    : stage.status === "ACTIVE"
                      ? "text-primary"
                      : stage.status === "ERROR"
                        ? "text-loss"
                        : "text-muted-foreground/50"
                }`}>
                  {stage.label}
                </span>
              </div>

              {/* Status text */}
              <div className="flex-shrink-0 text-right">
                {stage.status === "READY" ? (
                  <span className="text-gain text-[0.65rem] font-semibold">READY</span>
                ) : stage.status === "ACTIVE" ? (
                  <span className="text-primary/70 text-[0.65rem]">{stage.message || "LOADING..."}</span>
                ) : stage.status === "ERROR" ? (
                  <span className="text-loss text-[0.65rem]">{stage.message || "ERROR"}</span>
                ) : (
                  <span className="text-muted-foreground/30 text-[0.65rem]">WAITING...</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 w-full rounded-sm border border-loss/30 bg-loss/5 px-4 py-3">
            <div className="font-mono text-xs text-loss font-semibold">System initialization error</div>
            <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{error}</div>
          </div>
        )}

        {/* Footer status */}
        <div className="mt-6 text-center">
          <div className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground/40">
            {bootPhase === "SYSTEM_READY"
              ? "SYSTEM READY — ENTERING COMMAND CENTER"
              : bootPhase === "TRANSITIONING"
                ? "TRANSITIONING..."
                : `INITIALIZING SYSTEM... ${elapsed}s`}
          </div>
        </div>

        {/* Disable trading notice */}
        <div className="mt-3 text-center">
          <span className="font-mono text-[0.55rem] text-muted-foreground/30">
            TRADING: OFF • MODE: PAPER
          </span>
        </div>
      </div>
    </div>
  );
}

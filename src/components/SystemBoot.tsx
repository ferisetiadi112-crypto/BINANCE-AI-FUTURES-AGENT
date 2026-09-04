/**
 * SystemBoot — ORBITAL·AI Futures Command Boot Sequence
 *
 * Futuristic military/command-center boot screen focused on 2 core systems:
 *   1. BINANCE FUTURES TESTNET
 *   2. AI ENGINE
 *
 * All readiness state, polling, and sessionStorage behavior are unchanged —
 * this is a presentation-layer redesign only.
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
const SEGMENTS = 20;

/** Stage progress weights — 2 stages, each worth 50%. */
const STAGE_READY_WEIGHT = 50;
const STAGE_ACTIVE_WEIGHT = 25;

const BOOT_MESSAGES: Record<string, string> = {
  binance: "ESTABLISHING TESTNET LINK...",
  "ai-engine": "BOOTING AI CORE...",
};

// ─── Helpers ────────────────────────────────────────────────────────

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
    { id: "binance", label: "BINANCE FUTURES TESTNET", status: "WAITING" },
    { id: "ai-engine", label: "AI ENGINE", status: "WAITING" },
  ]);
  const [bootPhase, setBootPhase] = useState<"BOOTING" | "SYSTEM_READY" | "TRANSITIONING">("BOOTING");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [introStep, setIntroStep] = useState(0);

  // Cinematic intro sequence
  useEffect(() => {
    const timers = [80, 300, 550, 750, 950].map((delay, i) =>
      setTimeout(() => setIntroStep(i + 1), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

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
        prev.map((s) => (s.id === id ? { ...s, status, message } : s)),
      );
    },
    [],
  );

  // Poll readiness — P7D-5.1 Fast Boot.
  // Transition when BOTH stages have reported (any status including ERROR).
  // Don't wait for systemReady — that blocks on database + full runtime.
  useEffect(() => {
    let cancelled = false;
    let booted = false;

    function doTransition() {
      if (booted || cancelled) return;
      booted = true;
      setBootPhase("SYSTEM_READY");
      setTimeout(() => {
        if (!cancelled) {
          setStoredBootState(true);
          setBootPhase("TRANSITIONING");
          setTimeout(() => {
            if (!cancelled) onReady();
          }, 600);
        }
      }, 600);
    }

    // Maximum boot timeout — force transition after 12 seconds
    const maxTimeout = setTimeout(doTransition, 12_000);

    async function poll() {
      try {
        const resp = await fetchSystemReadiness();
        if (cancelled) return;

        const data = resp?.data;
        if (!data) return;

        // 1. BINANCE FUTURES TESTNET
        if (!data.binanceConfigured) {
          updateStage("binance", "READY", "PAPER MODE — Not configured");
        } else if (data.binanceConnected) {
          updateStage("binance", "READY", "CONNECTED");
        } else if (data.runtimeReady) {
          // Runtime is ready but Binance not connected — show ERROR
          updateStage("binance", "ERROR", "OFFLINE");
        } else {
          updateStage("binance", "ACTIVE", "CONNECTING...");
        }

        // 2. AI ENGINE
        if (data.aiRuntimeOnline) {
          updateStage("ai-engine", "READY", "ONLINE");
        } else if (data.runtimeReady) {
          updateStage("ai-engine", "READY", "ONLINE");
        } else {
          updateStage("ai-engine", "ACTIVE", "INITIALIZING...");
        }

        // Check for errors
        if (data.error) {
          setError(data.error);
        }

        // P7D-5.1: Transition when BOTH stages have reported their status
        // (either READY or ERROR) — don't require systemReady
        const binanceReported = stages.some(
          (s) => s.id === "binance" && (s.status === "READY" || s.status === "ERROR"),
        );
        const aiReported = stages.some(
          (s) => s.id === "ai-engine" && (s.status === "READY" || s.status === "ERROR"),
        );
        if (binanceReported && aiReported) {
          doTransition();
        }
      } catch {
        // Server might not be ready yet — keep polling
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(maxTimeout);
      clearInterval(interval);
    };
  }, [updateStage, onReady, stages]);

  // ─── Derived presentation values ────

  const percent = stages.reduce((acc, s) => {
    if (s.status === "READY") return acc + STAGE_READY_WEIGHT;
    if (s.status === "ACTIVE") return acc + STAGE_ACTIVE_WEIGHT;
    return acc;
  }, 0);
  const litSegments = Math.round((percent / 100) * SEGMENTS);

  const firstUnready = stages.find((s) => s.status !== "READY");
  const bootMessage =
    bootPhase === "SYSTEM_READY" || bootPhase === "TRANSITIONING"
      ? "SYSTEMS ONLINE — COMMAND CENTER READY"
      : firstUnready
        ? (BOOT_MESSAGES[firstUnready.id] ?? "INITIALIZING...")
        : "INITIALIZING...";

  const bothOnline = stages.every((s) => s.status === "READY");

  // ─── Render ────

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-[oklch(0.07_0.014_178)] text-foreground transition-all duration-600 ${
        bootPhase === "TRANSITIONING" ? "scale-[1.06] opacity-0" : "opacity-100"
      }`}
    >
      {/* ── Ambient layers ─────────────────────────────────────── */}
      <div className="absolute inset-0 grid-field opacity-25" />
      <div className="absolute inset-0 pointer-events-none scanlines" />
      <div
        className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, oklch(0.78 0.19 158 / 9%) 0%, oklch(0.78 0.19 158 / 3%) 40%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 45%, oklch(0.05 0.01 180 / 80%) 100%)",
        }}
      />

      {/* ── HUD frame ───────────────────────────────────────────── */}
      <div
        className={`absolute inset-3 sm:inset-5 pointer-events-none transition-opacity duration-700 ${
          introStep >= 1 ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="absolute inset-0 border border-primary/15" />
        <div className="absolute -top-px -left-px h-6 w-6 border-t-2 border-l-2 border-primary/70" />
        <div className="absolute -top-px -right-px h-6 w-6 border-t-2 border-r-2 border-primary/70" />
        <div className="absolute -bottom-px -left-px h-6 w-6 border-b-2 border-l-2 border-primary/70" />
        <div className="absolute -bottom-px -right-px h-6 w-6 border-b-2 border-r-2 border-primary/70" />
        <div className="absolute left-0 top-1/2 h-10 w-[3px] -translate-y-1/2 bg-primary/40" />
        <div className="absolute right-0 top-1/2 h-10 w-[3px] -translate-y-1/2 bg-primary/40" />
        <div className="absolute top-2 left-4 font-mono text-[0.5rem] uppercase tracking-[0.3em] text-cyan-signal/50">
          OBT-CMD // LAUNCH SEQ
        </div>
        <div className="absolute top-2 right-4 font-mono text-[0.5rem] uppercase tracking-[0.3em] text-primary/50 tabular-nums">
          T+{String(elapsed).padStart(2, "0")}s
        </div>
        <div className="absolute bottom-2 left-4 font-mono text-[0.5rem] uppercase tracking-[0.3em] text-muted-foreground/40">
          CORE v7.4D
        </div>
        <div className="absolute bottom-2 right-4 font-mono text-[0.5rem] uppercase tracking-[0.3em] text-muted-foreground/40">
          {percent}%
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6">
        {/* Brand block */}
        <div
          className={`text-center transition-all duration-500 ${
            introStep >= 2 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.45em] text-cyan-signal/60">
            SYSTEM BOOT
          </div>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="text-primary glow-text">ORBITAL</span>
            <span className="ml-1.5 text-foreground/85">·AI</span>
          </h1>
          <div className="mt-1.5 font-mono text-[0.6rem] uppercase tracking-[0.4em] text-primary/50">
            FUTURES COMMAND
          </div>
        </div>

        {/* ── Core reactor ─────────────────────────────────────── */}
        <div
          className={`relative my-6 sm:my-8 transition-all duration-700 ${
            introStep >= 3 ? "scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
        >
          <div
            className={`absolute -inset-6 rounded-full transition-opacity duration-1000 ${
              bothOnline ? "opacity-100" : "opacity-50"
            }`}
            style={{
              background:
                "radial-gradient(circle, oklch(0.78 0.19 158 / 18%) 0%, transparent 65%)",
            }}
          />
          <svg
            viewBox="0 0 100 100"
            className="absolute -inset-3 h-[calc(100%+24px)] w-[calc(100%+24px)] animate-spin"
            style={{ animationDuration: "14s" }}
          >
            <circle
              cx="50" cy="50" r="48" fill="none"
              stroke="oklch(0.78 0.19 158 / 45%)"
              strokeWidth="0.8"
              strokeDasharray="4 6"
            />
          </svg>
          <svg
            viewBox="0 0 100 100"
            className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] animate-spin"
            style={{ animationDuration: "22s", animationDirection: "reverse" }}
          >
            <circle
              cx="50" cy="50" r="46" fill="none"
              stroke="oklch(0.8 0.13 195 / 35%)"
              strokeWidth="0.5"
              strokeDasharray="1 9"
            />
          </svg>
          <div
            className={`relative h-24 w-24 rounded-full border flex items-center justify-center transition-all duration-700 ${
              bootPhase === "SYSTEM_READY"
                ? "border-primary bg-primary/15 shadow-[0_0_50px_oklch(0.8_0.18_158_/_45%)]"
                : error
                  ? "border-loss/70 bg-loss/10 shadow-[0_0_30px_oklch(0.66_0.2_20_/_30%)]"
                  : "border-primary/50 bg-primary/5 shadow-[0_0_30px_oklch(0.8_0.18_158_/_20%)]"
            }`}
          >
            {bootPhase === "SYSTEM_READY" ? (
              <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : error ? (
              <span className="text-loss text-2xl">✕</span>
            ) : (
              <>
                <div className="absolute h-8 w-8 rounded-full bg-primary/80 animate-ping" style={{ animationDuration: "2.2s" }} />
                <div className="relative h-8 w-8 rounded-full bg-primary shadow-[0_0_18px_oklch(0.86_0.19_158_/_80%)] animate-pulse" />
                <div
                  className="absolute inset-2 rounded-full border border-transparent border-t-primary/60 border-r-cyan-signal/40 animate-spin"
                  style={{ animationDuration: "1.8s" }}
                />
              </>
            )}
          </div>
        </div>

        {/* ── Segmented loading bar ─────────────────────────────── */}
        <div
          className={`w-full transition-all duration-500 ${
            introStep >= 4 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <div className="flex items-end justify-between font-mono text-[0.55rem] uppercase tracking-[0.25em]">
            <span className="text-muted-foreground/60">{bootMessage}</span>
            <span className={`tabular-nums ${bootPhase === "SYSTEM_READY" ? "text-primary glow-text" : "text-primary/80"}`}>
              {percent}%
            </span>
          </div>
          <div className="mt-2 border border-primary/30 bg-primary/5 px-2 py-1.5">
            <div className="flex gap-[3px]">
              {Array.from({ length: SEGMENTS }, (_, i) => (
                <div
                  key={i}
                  className={`h-3.5 flex-1 transition-all duration-300 ${
                    i < litSegments
                      ? "bg-primary shadow-[0_0_6px_oklch(0.8_0.18_158_/_60%)]"
                      : "bg-muted/40"
                  } ${i === litSegments && bootPhase === "BOOTING" ? "animate-pulse" : ""}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Core System Status — 2 systems only ───────────────── */}
        <div
          className={`mt-6 w-full transition-all duration-500 ${
            introStep >= 5 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <div className="space-y-2">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className="rounded-sm border border-primary/20 bg-primary/5 px-4 py-3 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-foreground/90">
                    {stage.label}
                  </span>
                  {stage.status === "READY" ? (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-gain shadow-[0_0_8px_oklch(0.8_0.18_158_/_60%)]" />
                      <span className="font-mono text-xs font-bold uppercase tracking-wider text-gain glow-text">
                        {stage.message || "ONLINE"}
                      </span>
                    </span>
                  ) : stage.status === "ERROR" ? (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-loss shadow-[0_0_8px_oklch(0.66_0.2_20_/_60%)]" />
                      <span className="font-mono text-xs font-bold uppercase tracking-wider text-loss">
                        ERROR
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-cyan-signal animate-pulse" />
                      <span className="font-mono text-xs uppercase tracking-wider text-cyan-signal/80">
                        {stage.message || "CONNECTING..."}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 w-full border border-loss/40 bg-loss/10 px-3 py-2">
            <div className="font-mono text-[0.6rem] text-loss font-semibold uppercase tracking-widest">
              System initialization error
            </div>
            <div className="mt-0.5 font-mono text-[0.55rem] text-muted-foreground">{error}</div>
          </div>
        )}

        {/* Final state */}
        <div className="mt-5 text-center">
          {bootPhase === "SYSTEM_READY" || bootPhase === "TRANSITIONING" ? (
            <div className="animate-scale-in">
              <div className="font-mono text-xs uppercase tracking-[0.35em] text-primary glow-text">
                SYSTEMS ONLINE
              </div>
              <div className="mt-1.5 font-mono text-[0.55rem] uppercase tracking-[0.25em] text-muted-foreground/60">
                ENTERING COMMAND CENTER
              </div>
            </div>
          ) : (
            <div className="font-mono text-[0.55rem] uppercase tracking-[0.25em] text-muted-foreground/40">
              Initializing core subsystems...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

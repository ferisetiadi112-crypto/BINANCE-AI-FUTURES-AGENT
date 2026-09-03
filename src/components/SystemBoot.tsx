/**
 * SystemBoot — P7D-4.6 Premium Cinematic Boot Screen
 *
 * AAA sci-fi command-system launch sequence for ORBITAL·AI Futures Command.
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
const SEGMENTS = 24;

/** Stage progress weights — 5 stages, each worth 20%. */
const STAGE_READY_WEIGHT = 20;
const STAGE_ACTIVE_WEIGHT = 10;

const BOOT_MESSAGES: Record<string, string> = {
  database: "CONNECTING TO CORE...",
  binance: "VERIFYING SYSTEM...",
  "ai-runtime": "STARTING AI RUNTIME...",
  "risk-engine": "CALIBRATING RISK ENGINE...",
  dashboard: "SYNCHRONIZING COMMAND CENTER...",
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
    { id: "database", label: "DATABASE", status: "WAITING" },
    { id: "binance", label: "EXCHANGE LINK", status: "WAITING" },
    { id: "ai-runtime", label: "AI CORE", status: "WAITING" },
    { id: "risk-engine", label: "RISK ENGINE", status: "WAITING" },
    { id: "dashboard", label: "COMMAND CENTER", status: "WAITING" },
  ]);
  const [bootPhase, setBootPhase] = useState<"BOOTING" | "SYSTEM_READY" | "TRANSITIONING">("BOOTING");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [introStep, setIntroStep] = useState(0); // cinematic intro: 0=frame,1=brand,2=core,3=bar,4=modules

  // Cinematic intro sequence — pure presentation, does not affect readiness.
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
        prev.map((s) => (s.id === id ? { ...s, status, message } : s))
      );
    },
    [],
  );

  // Poll readiness — UNCHANGED backend logic.
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

  // ─── Derived presentation values (from REAL stage state only) ────

  const percent = stages.reduce((acc, s) => {
    if (s.status === "READY") return acc + STAGE_READY_WEIGHT;
    if (s.status === "ACTIVE") return acc + STAGE_ACTIVE_WEIGHT;
    return acc;
  }, 0);
  const litSegments = Math.round((percent / 100) * SEGMENTS);

  const firstUnready = stages.find((s) => s.status !== "READY");
  const bootMessage =
    bootPhase === "SYSTEM_READY" || bootPhase === "TRANSITIONING"
      ? "SYSTEM ONLINE — COMMAND CENTER READY"
      : firstUnready
        ? (BOOT_MESSAGES[firstUnready.id] ?? "INITIALIZING COMMAND SYSTEM")
        : "INITIALIZING COMMAND SYSTEM";

  const coreOnline = stages.find((s) => s.id === "ai-runtime")?.status === "READY";

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-[oklch(0.07_0.014_178)] text-foreground transition-all duration-600 ${
        bootPhase === "TRANSITIONING" ? "scale-[1.06] opacity-0" : "opacity-100"
      }`}
    >
      {/* ── Ambient layers ─────────────────────────────────────── */}
      <div className="absolute inset-0 grid-field opacity-25" />
      <div className="absolute inset-0 pointer-events-none scanlines" />
      {/* Soft emerald core halo behind center */}
      <div
        className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, oklch(0.78 0.19 158 / 9%) 0%, oklch(0.78 0.19 158 / 3%) 40%, transparent 70%)",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 45%, oklch(0.05 0.01 180 / 80%) 100%)",
        }}
      />

      {/* ── HUD frame — thin futuristic border lines ───────────── */}
      <div
        className={`absolute inset-3 sm:inset-5 pointer-events-none transition-opacity duration-700 ${
          introStep >= 1 ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="absolute inset-0 border border-primary/15" />
        {/* Corner brackets */}
        <div className="absolute -top-px -left-px h-6 w-6 border-t-2 border-l-2 border-primary/70" />
        <div className="absolute -top-px -right-px h-6 w-6 border-t-2 border-r-2 border-primary/70" />
        <div className="absolute -bottom-px -left-px h-6 w-6 border-b-2 border-l-2 border-primary/70" />
        <div className="absolute -bottom-px -right-px h-6 w-6 border-b-2 border-r-2 border-primary/70" />
        {/* Side notches */}
        <div className="absolute left-0 top-1/2 h-10 w-[3px] -translate-y-1/2 bg-primary/40" />
        <div className="absolute right-0 top-1/2 h-10 w-[3px] -translate-y-1/2 bg-primary/40" />
        {/* Top HUD readouts */}
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
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center px-6">
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

        {/* ── AI CORE / reactor ─────────────────────────────────── */}
        <div
          className={`relative my-6 sm:my-8 transition-all duration-700 ${
            introStep >= 3 ? "scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
        >
          {/* Outer glow */}
          <div
            className={`absolute -inset-6 rounded-full transition-opacity duration-1000 ${
              coreOnline ? "opacity-100" : "opacity-50"
            }`}
            style={{
              background:
                "radial-gradient(circle, oklch(0.78 0.19 158 / 18%) 0%, transparent 65%)",
            }}
          />
          {/* Slow rotating dashed ring */}
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
          {/* Counter-rotating inner ring with ticks */}
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
          {/* Core body */}
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
                {/* Pulsing nucleus */}
                <div className="absolute h-8 w-8 rounded-full bg-primary/80 animate-ping" style={{ animationDuration: "2.2s" }} />
                <div className="relative h-8 w-8 rounded-full bg-primary shadow-[0_0_18px_oklch(0.86_0.19_158_/_80%)] animate-pulse" />
                {/* Internal energy swirl */}
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

        {/* ── HUD telemetry ─────────────────────────────────────── */}
        <div
          className={`mt-5 w-full transition-all duration-500 ${
            introStep >= 5 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <div className="space-y-1">
            {stages.map((stage) => (
              <div key={stage.id} className="flex items-center gap-2 font-mono text-[0.62rem] tracking-[0.15em]">
                <span className="w-32 truncate text-muted-foreground/70 uppercase">
                  {stage.label}
                </span>
                <span className="flex-1 border-b border-dotted border-hairline/40" />
                {stage.status === "READY" ? (
                  <span className="flex items-center gap-1.5 text-primary">
                    <span className="text-[0.7rem]">●</span> ONLINE
                  </span>
                ) : stage.status === "ERROR" ? (
                  <span className="flex items-center gap-1.5 text-loss">
                    <span className="text-[0.7rem]">✕</span> FAULT
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-cyan-signal/80">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-signal animate-pulse" />
                    CONNECTING...
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-3 w-full border border-loss/40 bg-loss/10 px-3 py-2">
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
                SYSTEM ONLINE
              </div>
              <div className="mt-1.5 font-mono text-[0.55rem] uppercase tracking-[0.25em] text-muted-foreground/60">
                TRADING: OFF &nbsp;•&nbsp; MODE: PAPER
              </div>
            </div>
          ) : (
            <div className="font-mono text-[0.55rem] uppercase tracking-[0.25em] text-muted-foreground/40">
              TRADING: OFF &nbsp;•&nbsp; MODE: PAPER
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

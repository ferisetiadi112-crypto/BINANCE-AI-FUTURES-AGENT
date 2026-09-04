/**
 * DashboardView — AI FUTURES AGENT control room.
 *
 * Philosophy: "AI yang terus bekerja, bukan terus bicara."
 *
 * Exactly THREE primary cards:
 *   1. STATUS    — what the AI is doing now + current result
 *   2. JOURNAL   — completed AI work (one activity = one entry)
 *   3. REASONING — the live, temporary working stream (≈5 lines, newest last)
 *
 * All values come from the real agent-status payload only. When real data is
 * unavailable the card shows an honest state (Waiting for activity /
 * Data unavailable / Agent offline / Connecting). Nothing is fabricated.
 */

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { AgentStatusPayload } from "@/backend/api";
import { formatTime } from "./DashboardFormatters";

const REASONING_LINES_MAX = 5;

/** Internal/system event types — never shown as reasoning or journal entries. */
const INTERNAL_EVENTS: ReadonlySet<string> = new Set([
  "PNL_UPDATED",
  "POSITION_MONITOR",
  "PERIODIC_REPORT",
  "STARTUP_RECONCILIATION",
  "RISK_CHECK",
  "MARKET_SCAN",
]);

type Props = {
  status: AgentStatusPayload | null;
  connecting: boolean;
  error: boolean;
};

// ─── Small primitives ────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const isActive = status === "RUNNING" || status === "STARTING";
  const isError = status === "ERROR" || status === "OFFLINE";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        isActive ? "bg-gain" : isError ? "bg-loss" : "bg-muted-foreground/40"
      } ${status === "STARTING" ? "animate-pulse" : ""}`}
    />
  );
}

function Money({ value }: { value: number }) {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <span
      className={`font-mono tabular-nums ${
        value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-foreground"
      }`}
    >
      {value < 0 ? "-" : value > 0 ? "+" : ""}${formatted}
    </span>
  );
}

function DecisionChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground/60">—</span>;
  const className =
    value === "LONG"
      ? "text-gain font-semibold"
      : value === "SHORT"
        ? "text-loss font-semibold"
        : value === "WAIT" || value === "HOLD"
          ? "text-amber-signal font-semibold"
          : "text-cyan-signal font-semibold";
  return <span className={className}>{value}</span>;
}

function CardHeader({
  title,
  meta,
  live = false,
}: {
  title: string;
  meta?: string | undefined;
  live?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-hairline/60 pb-2.5">
      <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
        {title}
      </h2>
      {live && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-signal animate-pulse" />
      )}
      {meta && (
        <span className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground/60">
          {meta}
        </span>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-hairline/50 last:border-b-0">
      <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-foreground/90 break-words">{children}</div>
    </div>
  );
}

function Honest({ text }: { text: string }) {
  return <span className="font-mono text-xs text-muted-foreground/60">{text}</span>;
}

// ─── Derived view data (pure, from real payload only) ────────────────

type JournalEntryView = {
  key: string;
  time: string;
  header: string;
  finding: string | null;
  decision: string | null;
  plan: { entry: number; sl: number | null; tp: number | null; size: number } | null;
  result: string;
};

/**
 * Build journal view entries from the REAL payload:
 * - entry/SL/TP come from the real open position carried on the event
 * - SIZE likewise; no plan fields are shown when the real event has none
 */
function deriveJournal(status: AgentStatusPayload): JournalEntryView[] {
  const entries = status.journal ?? [];
  return entries.map((e, index) => {
    const header = e.symbol ? `${e.symbol} · ${e.eventType.replace(/_/g, " ")}` : e.eventType.replace(/_/g, " ");
    const finding = e.message.trim().length > 0 ? e.message : null;
    const plan =
      e.position && e.position.entryPrice > 0
        ? {
            entry: e.position.entryPrice,
            sl: null,
            tp: null,
            size: e.position.margin,
          }
        : null;
    const result =
      e.action && e.action.trim().length > 0
        ? e.action
        : e.pnl !== null && e.pnl !== undefined
          ? `Realized PnL $${e.pnl.toFixed(2)}`
          : "Completed";
    return {
      key: `${e.timestamp}-${index}`,
      time: formatTime(new Date(e.timestamp).toISOString()),
      header,
      finding,
      decision: e.decision,
      plan,
      result,
    };
  });
}

/**
 * Live reasoning: the genuinely available agent activity stream, capped to
 * ~5 lines, oldest first, newest last. Internal technical events are
 * excluded. No fake streaming text is ever created.
 */
function deriveReasoning(status: AgentStatusPayload | null): string[] {
  if (!status?.recentActivity) return [];
  return status.recentActivity
    .filter((a) => !INTERNAL_EVENTS.has(a.eventType) && a.message.trim().length > 0)
    .slice(-REASONING_LINES_MAX)
    .map((a) => a.message.trim());
}

// ─── Card 1: STATUS ──────────────────────────────────────────────────

function StatusCard({ status, connecting }: { status: AgentStatusPayload | null; connecting: boolean }) {
  const s = status;

  return (
    <section className="rounded-sm border border-hairline bg-card/40 p-4 sm:p-5">
      <CardHeader
        title="Status"
        meta={s?.executionMode ? `${s.executionMode} mode` : undefined}
        live={s?.status === "RUNNING"}
      />

      <div className="mt-3 flex items-center gap-2">
        <StatusDot status={s?.status ?? "OFFLINE"} />
        <span className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
          {connecting && !s
            ? "CONNECTING"
            : !s
              ? "AGENT OFFLINE"
              : s.status === "OFFLINE"
                ? "AGENT OFFLINE"
                : s.status}
        </span>
      </div>

      <div className="mt-3">
        <Row label="Current Work">
          {connecting && !s ? (
            <Honest text="Connecting" />
          ) : !s ? (
            <Honest text="Agent offline" />
          ) : s.currentTask?.trim().length ? (
            s.currentTask
          ) : (
            <Honest text="Waiting for activity" />
          )}
        </Row>
        <Row label="Finding">
          {s?.finding?.trim().length ? (
            s.finding
          ) : (
            <Honest text="Data unavailable" />
          )}
        </Row>
        <Row label="Decision">
          <DecisionChip value={s?.decision ?? null} />
          {s?.confidence != null && (
            <span className="ml-2 text-xs text-muted-foreground/70">{s.confidence}%</span>
          )}
        </Row>
        <Row label="Reason">
          {s?.reason?.trim().length ? s.reason : <Honest text="Data unavailable" />}
        </Row>
        <Row label="Action">
          {s?.action?.trim().length ? s.action : <Honest text="Data unavailable" />}
        </Row>
        <Row label="Position">
          {s?.position ? (
            <span>
              <span className="font-semibold">{s.position.side}</span> {s.position.symbol} · {s.position.size} @ $
              {s.position.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          ) : (
            "NONE"
          )}
        </Row>
        <Row label="Today">
          <Money value={s?.pnlToday ?? 0} />
          <span className="ml-3 text-muted-foreground/70">Trades: {s?.tradeCountToday ?? 0}</span>
        </Row>
        <Row label="Last Update">
          {s?.lastUpdate ? formatTime(s.lastUpdate) : <Honest text="Waiting for first tick" />}
        </Row>
      </div>
    </section>
  );
}

// ─── Card 2: JOURNAL ─────────────────────────────────────────────────

function JournalCard({ status, connecting }: { status: AgentStatusPayload | null; connecting: boolean }) {
  const entries = useMemo(() => (status ? deriveJournal(status) : []), [status]);

  return (
    <section className="rounded-sm border border-hairline bg-card/40 p-4 sm:p-5">
      <CardHeader title="Journal" meta="COMPLETED WORK" />

      <div className="mt-3 space-y-3">
        {connecting && !status ? (
          <Honest text="Connecting" />
        ) : entries.length === 0 ? (
          <Honest text="Waiting for activity" />
        ) : (
          entries.map((entry) => (
            <div key={entry.key} className="border-b border-hairline/50 pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/60">
                  {entry.time}
                </span>
                <span className="min-w-0 break-words text-sm font-medium text-foreground/90">{entry.header}</span>
              </div>
              {entry.finding && <p className="mt-1.5 text-sm text-foreground/80">{entry.finding}</p>}
              {entry.decision && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
                    Decision
                  </span>
                  <DecisionChip value={entry.decision} />
                </div>
              )}
              {entry.plan && (
                <div className="mt-1.5 font-mono text-xs text-foreground/80">
                  <div className="label-mono mb-0.5">Trade Plan</div>
                  <span className="text-muted-foreground/70">Entry</span> ${entry.plan.entry.toFixed(2)}
                  {entry.plan.sl !== null && (
                    <>
                      {" "}
                      · <span className="text-muted-foreground/70">SL</span> ${entry.plan.sl.toFixed(2)}
                    </>
                  )}
                  {entry.plan.tp !== null && (
                    <>
                      {" "}
                      · <span className="text-muted-foreground/70">TP</span> ${entry.plan.tp.toFixed(2)}
                    </>
                  )}
                  {" "}
                  · <span className="text-muted-foreground/70">Size</span> ${entry.plan.size.toFixed(2)}
                </div>
              )}
              <div className="mt-1.5 text-sm text-foreground/80">
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
                  Result
                </span>
                <span className="ml-2">{entry.result}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ─── Card 3: REASONING ───────────────────────────────────────────────

function ReasoningCard({
  status,
  connecting,
  queryError,
}: {
  status: AgentStatusPayload | null;
  connecting: boolean;
  queryError: boolean;
}) {
  const lines = useMemo(() => deriveReasoning(status), [status]);
  const online = status?.status === "RUNNING";

  let body: React.ReactNode;
  if (connecting && !status) {
    body = <Honest text="Connecting" />;
  } else if (queryError && !status) {
    body = <Honest text="Data unavailable" />;
  } else if (!online) {
    body = <Honest text="Agent offline" />;
  } else if (lines.length === 0) {
    body = <Honest text="Reasoning unavailable" />;
  } else {
    body = (
      <div className="flex flex-col gap-1 overflow-hidden">
        {lines.map((line, i) => (
          <span key={`${i}-${line}`} className="font-mono text-xs text-foreground/85">
            <span className="mr-2 text-primary/70">&gt;</span>
            {line}
          </span>
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-sm border border-hairline bg-card/40 p-4 sm:p-5">
      <CardHeader title="Reasoning" meta="LIVE" live={online && lines.length > 0} />
      <div className="mt-3 max-h-[7.5rem] overflow-hidden">{body}</div>
    </section>
  );
}

// ─── Root ────────────────────────────────────────────────────────────

export function DashboardView({ status, connecting, error }: Props) {
  const showError = error && !status?.error;
  const bannerText = status?.error?.trim().length ? status.error : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-2 py-4 sm:px-4">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <h1 className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          AI FUTURES AGENT
        </h1>
        <StatusDot status={status?.status ?? "OFFLINE"} />
      </div>

      {/* Attention / error banner */}
      {(showError || bannerText) && (
        <div className="mb-4 flex items-center gap-3 rounded-sm border border-loss/40 bg-loss/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-loss" />
          <span className="font-mono text-sm text-loss">
            {bannerText ?? "Cannot reach the agent server."}
          </span>
        </div>
      )}

      {/* The three primary cards — STATUS first on mobile (stacked) */}
      <div className="grid grid-cols-1 gap-4">
        <StatusCard status={status} connecting={connecting} />
        <JournalCard status={status} connecting={connecting} />
        <ReasoningCard status={status} connecting={connecting} queryError={error} />
      </div>
    </div>
  );
}

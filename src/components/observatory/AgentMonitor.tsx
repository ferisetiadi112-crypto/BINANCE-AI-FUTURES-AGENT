/**
 * AgentMonitor — lightweight main monitoring screen.
 *
 * Design principle: "SHOW WHAT MATTERS, HIDE WHAT DOESN'T."
 * Answers, in under 5 seconds:
 *   1. Is the AI online?
 *   2. What is it doing right now?
 *   3. What did it find?
 *   4. What decision did it make?
 *   5. What action did it take?
 *   6. What position is open?
 *   7. What is today's PnL?
 *   8. Is there an error requiring attention?
 *
 * Pure, prop-driven. One small status payload in, plain rows out.
 * All advanced detail stays on the existing advanced/debug pages.
 */

import { AlertTriangle } from "lucide-react";
import type { AgentStatusPayload } from "@/backend/api";
import { Tag } from "@/components/space/Panel";

// ─── Formatters (exported for tests) ───────────────────────────────

export const fmtMoney = (n: number) =>
  `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });

// ─── Presentation pieces ───────────────────────────────────────────

const statusTone: Record<AgentStatusPayload["status"], string> = {
  RUNNING: "bg-gain",
  STARTING: "bg-cyan-signal animate-pulse",
  OFFLINE: "bg-loss",
  ERROR: "bg-loss",
};

function Row({
  label,
  children,
  valueClass = "text-foreground",
}: {
  label: string;
  children: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline/60 py-2.5 last:border-b-0">
      <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
        {label}
      </span>
      <span className={`min-w-0 text-right font-mono text-sm break-words ${valueClass}`}>
        {children}
      </span>
    </div>
  );
}

function decisionTone(decision: string | null): string {
  if (decision === "LONG") return "text-gain font-semibold";
  if (decision === "SHORT") return "text-loss font-semibold";
  if (decision === "WAIT") return "text-amber-signal font-semibold";
  if (decision === "CLOSE") return "text-cyan-signal font-semibold";
  return "text-foreground";
}

// ─── Main view ─────────────────────────────────────────────────────

export function AgentMonitor({
  status,
  connecting,
  unreachable,
}: {
  status: AgentStatusPayload | null;
  /** First load with no data yet — show a small connecting state */
  connecting: boolean;
  /** The status request is failing — server unreachable */
  unreachable: boolean;
}) {
  const s = status;

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          AI FUTURES AGENT
        </h1>
        <div className="flex items-center gap-2">
          {s && <Tag tone="cyan">{s.executionMode}</Tag>}
          {s && (
            <Tag tone={s.tradingEnabled ? "warn" : "gain"}>
              {s.tradingEnabled ? "TRADING ENABLED" : "TRADING DISABLED"}
            </Tag>
          )}
        </div>
      </div>

      {/* ── Error banner: only when attention is required ──────── */}
      {unreachable && (
        <div className="mt-3 flex items-center gap-3 rounded-sm border border-loss/40 bg-loss/5 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-loss" />
          <span className="font-mono text-xs text-loss">
            Cannot reach the agent server — retrying automatically.
          </span>
        </div>
      )}
      {s?.error && (
        <div className="mt-3 flex items-center gap-3 rounded-sm border border-loss/40 bg-loss/5 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-loss" />
          <span className="font-mono text-xs text-loss">{s.error}</span>
        </div>
      )}

      {/* ── Core status ────────────────────────────────────────── */}
      <section className="mt-4 rounded-sm border border-hairline bg-card/40 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5 border-b border-hairline/60 pb-3">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              connecting && !s
                ? "bg-cyan-signal animate-pulse"
                : unreachable && !s
                  ? "bg-loss"
                  : statusTone[s?.status ?? "STARTING"]
            }`}
          />
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
            Status
          </span>
          <span className="ml-auto font-mono text-base font-semibold uppercase tracking-wider text-foreground">
            {connecting && !s
              ? "Connecting..."
              : unreachable && !s
                ? "Unreachable"
                : (s?.status ?? "—")}
          </span>
        </div>

        <Row label="Currently">{s?.currentTask ?? (connecting ? "Connecting..." : "—")}</Row>
        <Row label="AI Finding">{s?.finding ?? "—"}</Row>
        <Row label="Decision" valueClass={decisionTone(s?.decision ?? null)}>
          {s?.decision ?? "—"}
          {s?.confidence !== null && s?.confidence !== undefined && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{s.confidence}%</span>
          )}
        </Row>
        <Row label="Reason">{s?.reason ?? "—"}</Row>
        <Row label="Action">{s?.action ?? "—"}</Row>
        <Row label="Position">
          {s?.position ? (
            <span>
              {s.position.side} {s.position.symbol}{" "}
              <span className={s.position.unrealizedPnl >= 0 ? "text-gain" : "text-loss"}>
                {fmtMoney(s.position.unrealizedPnl)}
              </span>
            </span>
          ) : (
            "NONE"
          )}
        </Row>
        <Row label="Today">
          <span className={(s?.pnlToday ?? 0) >= 0 ? "text-gain" : "text-loss"}>
            PnL: {fmtMoney(s?.pnlToday ?? 0)}
          </span>
          <span className="ml-3 text-muted-foreground">Trades: {s?.tradeCountToday ?? 0}</span>
        </Row>
        <Row label="Last Update">{fmtTime(s?.lastUpdate ?? null)}</Row>
      </section>

      {/* ── Recent AI activity: latest ~10 events only ─────────── */}
      <section className="mt-4 mb-8 rounded-sm border border-hairline bg-card/40 px-4 py-3 sm:px-5">
        <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
          Recent AI Activity
        </h2>
        <ul className="mt-2 space-y-1.5">
          {s && s.recentActivity.length > 0 ? (
            [...s.recentActivity].reverse().map((e, i) => (
              <li
                key={`${e.timestamp}-${i}`}
                className="flex items-baseline gap-3 font-mono text-xs"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground/60">
                  {fmtClock(e.timestamp)}
                </span>
                <span className="min-w-0 break-words text-foreground/85">{e.message}</span>
              </li>
            ))
          ) : (
            <li className="font-mono text-xs text-muted-foreground/60">
              {connecting ? "Connecting..." : "No activity yet."}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

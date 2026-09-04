/** DashboardView — public AI futures agent dashboard.

Design principle: "AI yang terus bekerja, bukan AI yang terus bicara."

The dashboard should answer, in under 5 seconds:

1. Is AI working?
2. What is AI doing now?
3. What has AI found?
4. What decision did AI make?
5. What action/result occurred?
6. Is there an open position?
7. What is today's PnL?
8. Is something requiring attention?

All values come from the real agent-status payload only.
If real data is unavailable, display an honest state.
*/

import { AlertTriangle } from "lucide-react";
import type { AgentStatusPayload } from "@/backend/api";
import { formatTime } from "./DashboardFormatters";

type Props = {
  status: AgentStatusPayload | null;
  connecting: boolean;
  error: boolean;
};

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-card/40 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80 border border-hairline/60">
      {value}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const isActive = status === "RUNNING" || status === "STARTING";
  const isError = status === "ERROR" || status === "OFFLINE";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        isActive
          ? "bg-gain"
          : isError
            ? "bg-loss"
            : "bg-muted-foreground/40"
      } ${
        status === "STARTING" ? "animate-pulse" : ""
      }`}
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
        value > 0
          ? "text-gain"
          : value < 0
            ? "text-loss"
            : "text-foreground"
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
          : value === "CLOSE" || value === "ADJUST" || value === "BLOCK" || value === "ALLOW"
            ? "text-cyan-signal font-semibold"
            : "text-foreground font-semibold";
  return <span className={className}>{value}</span>;
}

function EmptyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-hairline/60 last:border-b-0">
      <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
        {label}
      </span>
      <span className="min-w-0 text-right font-mono text-sm text-muted-foreground/60 break-words">
        {value}
      </span>
    </div>
  );
}

function ActivityRow({
  time,
  header,
  finding,
  decision,
  plan,
  result,
}: {
  time: string;
  header: string;
  finding: string | null;
  decision: string | null;
  plan: React.ReactNode;
  result: string | null;
}) {
  return (
    <div className="border-b border-hairline/60 last:border-b-0">
      <div className="flex items-center gap-2 text-muted-foreground/60">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em]">{time}</span>
        <span className="min-w-0 break-words text-foreground/80 font-medium">{header}</span>
      </div>
      {finding && (
        <div className="mt-1.5 pl-7 text-sm text-foreground/80">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
            Finding
          </span>
          <span className="ml-2">{finding}</span>
        </div>
      )}
      {decision && (
        <div className="mt-1 pl-7 flex items-center gap-2">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
            Decision
          </span>
          <DecisionChip value={decision} />
        </div>
      )}
      {plan && <div className="mt-1 pl-7">{plan}</div>}
      {result && (
        <div className="mt-1 pl-7">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
            Result
          </span>
          <span className="ml-2 text-sm text-foreground/80">{result}</span>
        </div>
      )}
    </div>
  );
}

function ReasoningLines({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-1 overflow-hidden">
      {lines.map((line, index) => (
        <span key={index} className="font-mono text-xs text-foreground/80">
          {line}
        </span>
      ))}
    </div>
  );
}

function InDevCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-sm border border-hairline bg-card/40 p-4">
      <h3 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
        {title}
      </h3>
      <p className="mt-2 text-sm text-foreground/80">{description}</p>
      <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-signal/10 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber-signal/90 border border-amber-signal/20">
        In Development
      </span>
    </div>
  );
}

export function DashboardView({ status, connecting, error }: Props) {
  const s = status;

  const hasRealActivity =
    s && s.recentActivity && s.recentActivity.length > 0 && s.recentActivity.some((a) => a.message.trim().length > 0);

  // Transient reasoning mapping: only from the most recent real live events.
  // No invented text. If real activity is unavailable, show an honest state.
  const reasoningLines = (() => {
    if (!s || !s.recentActivity) return [];
    return s.recentActivity
      .slice(-5)
      .map((a) => a.message.trim())
      .filter((text) => text.length > 0);
  })();

  const latestActivity = s?.recentActivity ?? [];
  const lastActivity = latestActivity.length > 0 ? latestActivity[latestActivity.length - 1] ?? null : null;
  const lastRealTimestamp = lastActivity?.timestamp ?? 0;

  const mainActivity = (() => {
    if (!s || !lastRealTimestamp || !lastActivity) return null;
    // Use the most recent real activity as the latest meaningful completed item.
    const last = lastActivity;
    const header = last.message.trim() || "Recent activity";
    return {
      time: formatTime(String(last.timestamp)),
      header,
      finding: s.finding ?? null,
      decision: s.decision ?? null,
      plan: s.position ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-left">
          <div className="flex flex-wrap gap-x-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">Pair</span>
            <span className="font-mono text-sm text-foreground">{s.position.symbol}</span>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">Side</span>
            <span className="font-mono text-sm text-foreground">{s.position.side}</span>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">Entry</span>
            <span className="font-mono text-sm text-foreground">
              ${s.position.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          {s.position.markPrice > 0 && (
            <div className="flex flex-wrap gap-x-3">
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">Current</span>
              <span className="font-mono text-sm text-foreground">
                ${s.position.markPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">Size</span>
            <span className="font-mono text-sm text-foreground">{s.position.size}</span>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">Leverage</span>
            <span className="font-mono text-sm text-foreground">{s.position.leverage}x</span>
          </div>
        </div>
      ) : (
        <span className="font-mono text-xs text-muted-foreground/60">No trade plan</span>
      ),
      result: s.action ?? null,
    };
  })();

  const recentCompletedRows = (() => {
    if (!s || !s.recentActivity) return [];
    return s.recentActivity.slice(-6).reverse().map((a) => ({
      time: formatTime(String(a.timestamp)),
      header: a.message.trim() || "Activity",
      decision: null,
      result: null,
    }));
  })();

  return (
    <div className="mx-auto w-full max-w-2xl px-2 py-4 sm:px-4">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            AI FUTURES AGENT
          </h1>
          <StatusDot status={s?.status ?? "OFFLINE"} />
          <StatusBadge value={s?.status ?? "OFFLINE"} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {s && (
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              Mode: {s.executionMode}
            </span>
          )}
          {s && (
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              Trading: {s.tradingEnabled ? "Enabled" : "Disabled"}
            </span>
          )}
          <span className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
            {connecting ? "Connecting..." : error ? "Unreachable" : s ? "Live" : "Offline"}
          </span>
        </div>
      </div>

      {/* Attention / error banner */}
      {(error || (s?.error && s.error.trim().length > 0)) && (
        <div className="mb-4 flex items-center gap-3 rounded-sm border border-loss/40 bg-loss/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-loss" />
          <span className="font-mono text-sm text-loss">
            {s?.error && s.error.trim().length > 0 ? s.error : "Cannot reach the agent server."}
          </span>
        </div>
      )}

      {/* Main status block */}
      <section className="rounded-sm border border-hairline bg-card/40 p-4 sm:p-5">
        <div className="flex items-center gap-2 border-b border-hairline/60 pb-3">
          <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
            Status
          </h2>
        </div>

        <div className="mt-3 space-y-0">
          <EmptyRow
            label="Currently"
            value={connecting ? "Connecting..." : s?.currentTask?.trim().length ? s.currentTask : "Waiting for next activity"}
          />
          <EmptyRow label="AI Finding" value={s?.finding?.trim().length ? s.finding : "—"} />
          <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-hairline/60 last:border-b-0">
            <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              Decision
            </span>
            <div className="min-w-0 text-right">
              <DecisionChip value={s?.decision ?? null} />
              {s?.confidence != null && (
                <span className="ml-2 text-xs font-normal text-muted-foreground/70">{s.confidence}%</span>
              )}
            </div>
          </div>
          <EmptyRow label="Reason" value={s?.reason?.trim().length ? s.reason : "—"} />
          <EmptyRow label="Action" value={s?.action?.trim().length ? s.action : "—"} />
          <EmptyRow
            label="Position"
            value={s?.position ? `${s.position.side} ${s.position.symbol}` : "NONE"}
          />
          <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-hairline/60 last:border-b-0">
            <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              Today
            </span>
            <div className="min-w-0 text-right">
              <Money value={s?.pnlToday ?? 0} />
              <span className="ml-3 text-muted-foreground/70">Trades: {s?.tradeCountToday ?? 0}</span>
            </div>
          </div>
          <EmptyRow label="Last Update" value={formatTime(s?.lastUpdate ?? null)} />
        </div>
      </section>

      {/* Current work / reasoning / latest completed work */}
      <section className="mt-4 rounded-sm border border-hairline bg-card/40 p-4 sm:p-5">
        <div className="flex items-center gap-2 border-b border-hairline/60 pb-3">
          <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
            Current Work
          </h2>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-hairline/60">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              Currently
            </span>
            <span className="min-w-0 text-right font-mono text-sm text-foreground/90 break-words">
              {connecting
                ? "Connecting..."
                : s?.currentTask?.trim().length
                  ? s.currentTask
                  : "Waiting for next activity"}
            </span>
          </div>

          <div className="mt-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
              Current Reasoning
            </span>
            <div className="mt-2 rounded-sm border border-hairline bg-background/40 p-3">
              {connecting ? (
                <span className="text-muted-foreground/60 text-sm">Connecting...</span>
              ) : reasoningLines.length > 0 ? (
                <ReasoningLines lines={reasoningLines} />
              ) : (
                <span className="text-muted-foreground/60 text-sm">Reasoning unavailable</span>
              )}
            </div>
          </div>

          <div className="mt-3">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
              Last Completed Work
            </span>
            <div className="mt-2 rounded-sm border border-hairline bg-background/40 p-3">
              {!s || !lastRealTimestamp ? (
                <span className="text-muted-foreground/60 text-sm">No completed AI activity yet.</span>
              ) : (
                <ActivityRow
                  time={mainActivity!.time}
                  header={mainActivity!.header}
                  finding={mainActivity!.finding}
                  decision={mainActivity!.decision}
                  plan={mainActivity!.plan}
                  result={mainActivity!.result}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Recent completed work */}
      <section className="mt-4 rounded-sm border border-hairline bg-card/40 p-4 sm:p-5">
        <div className="flex items-center gap-2 border-b border-hairline/60 pb-3">
          <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/80">
            Recent Completed Work
          </h2>
        </div>

        <div className="mt-3 space-y-3">
          {!s || !hasRealActivity ? (
            <span className="text-muted-foreground/60 text-sm">No completed AI activity yet.</span>
          ) : recentCompletedRows.length > 0 ? (
            recentCompletedRows.map((row, index) => (
              <div key={index} className="border-b border-hairline/60 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
                    {row.time}
                  </span>
                  <span className="min-w-0 break-words text-sm text-foreground/90 font-medium">{row.header}</span>
                </div>
                {row.decision && (
                  <div className="mt-1 pl-6 flex items-center gap-2 text-sm">
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
                      Decision
                    </span>
                    <DecisionChip value={row.decision} />
                  </div>
                )}
                {row.result && (
                  <div className="mt-1 pl-6 text-sm text-foreground/80">{row.result}</div>
                )}
              </div>
            ))
          ) : (
            <span className="text-muted-foreground/60 text-sm">No recent completed work.</span>
          )}
        </div>
      </section>

      {/* Other sections — in development */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <InDevCard
          title="AI Agent"
          description="AI Agent section coming soon. Current control surfaces remain available in advanced pages."
        />
        <InDevCard
          title="Market"
          description="Market section coming soon. Real-time market analysis pages remain available in advanced pages."
        />
        <InDevCard
          title="Trading"
          description="Trading section coming soon. Open positions and execution details remain available in advanced pages."
        />
        <InDevCard
          title="Performance"
          description="Performance section coming soon. Historical results remain available in advanced pages."
        />
        <InDevCard
          title="System"
          description="System section coming soon. Diagnostics and runtime state remain available in advanced pages."
        />
      </div>
    </div>
  );
}

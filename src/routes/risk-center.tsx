import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Gauge as GaugeIcon, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { PageHeader, Panel, Stat, Tag, Meter } from "@/components/space/Panel";
import { fetchRisk } from "@/api/client";

export const Route = createFileRoute("/risk-center")({
  head: () => ({
    meta: [
      { title: "Risk Center — Orbital AI Command Center" },
      { name: "description", content: "Risk envelope, daily limits, exposure, leverage controls and emergency stop status." },
      { property: "og:title", content: "Risk Center — Orbital AI Command Center" },
    ],
  }),
  component: RiskCenter,
});

function RiskCenter() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["risk"],
    queryFn: fetchRisk,
  });

  const risk = response?.data;
  const events = risk?.events || [];

  // P7D-4.4: No full-page loading blocker

  const profitPct = risk ? (risk.dailyProfitUsed / risk.dailyProfitCap) * 100 : 0;
  const lossPct = (risk.dailyLossUsed / risk.dailyLossLimit) * 100;
  const exposurePct = (risk.totalExposure / risk.maxExposure) * 100;
  const leveragePct = (risk.currentLeverage / risk.maxLeverage) * 100;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Guardian · Risk Control"
        title="Risk Center"
        desc="Daily risk boundaries, exposure limits, leverage controls and emergency stop. Risk Engine has final authority over all trades."
      />

      {isLoading && !risk && (
        <div className="flex items-center gap-3 rounded-sm border border-primary/20 bg-primary/5 px-4 py-3 mb-3">
          <div className="pulse-dot h-3 w-3 rounded-full bg-primary" />
          <span className="font-mono text-xs text-muted-foreground">Loading risk data...</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Risk Status" value={risk.status} sub="All systems nominal" tone="gain" icon={<ShieldCheck className="h-4 w-4" />} />
        <Stat label="Daily Profit" value={`$${risk.dailyProfitUsed.toFixed(2)}`} sub={`of $${risk.dailyProfitCap.toFixed(2)} cap`} tone="gain" icon={<GaugeIcon className="h-4 w-4" />} />
        <Stat label="Daily Loss" value={`$${risk.dailyLossUsed.toFixed(2)}`} sub={`of $${risk.dailyLossLimit.toFixed(2)} limit`} tone={lossPct > 50 ? "warn" : "default"} icon={<ShieldAlert className="h-4 w-4" />} />
        <Stat label="Emergency Stop" value={risk.emergencyStopState} sub="Triggered: NEVER" tone="gain" icon={<Shield className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Risk Envelope" code="GUARDIAN" glow className="xl:col-span-2">
          <div className="grid gap-6 sm:grid-cols-2">
            <GaugeItem label="Daily Profit Cap" used={risk.dailyProfitUsed} cap={risk.dailyProfitCap} pct={profitPct} tone="gain" />
            <GaugeItem label="Daily Loss Limit" used={risk.dailyLossUsed} cap={risk.dailyLossLimit} pct={lossPct} tone="loss" />
            <GaugeItem label="Total Exposure" used={risk.totalExposure} cap={risk.maxExposure} pct={exposurePct} tone="primary" />
            <GaugeItem label="Leverage" used={risk.currentLeverage} cap={risk.maxLeverage} pct={leveragePct} tone="primary" isInt />
          </div>

          <div className="mt-6 border-t border-hairline pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">{risk.emergencyStopState}</span>
              </div>
              <Tag tone="gain">{risk.openPositionCount} open position{risk.openPositionCount !== 1 ? "s" : ""}</Tag>
            </div>
          </div>
        </Panel>

        <Panel title="Risk Rules" code="AUTHORITY">
          <div className="space-y-3">
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
              <div className="label-mono">Risk Engine Authority</div>
              <p className="mt-1 text-xs text-foreground/80">
                The Risk Engine has FINAL authority over all trade decisions.
                If AI says LONG but Risk Engine says REJECT → <span className="font-semibold text-gain">REJECT wins</span>.
              </p>
            </div>
            <div className="space-y-2 border-t border-hairline pt-3">
              <div className="flex justify-between"><span className="label-mono">Initial Capital</span><span className="font-mono text-xs text-foreground">$5.00</span></div>
              <div className="flex justify-between"><span className="label-mono">Daily Profit Cap</span><span className="font-mono text-xs text-gain">$0.50</span></div>
              <div className="flex justify-between"><span className="label-mono">Daily Loss Limit</span><span className="font-mono text-xs text-loss">$0.50</span></div>
              <div className="flex justify-between"><span className="label-mono">Max Leverage</span><span className="font-mono text-xs text-foreground">10x</span></div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-3">
        <Panel title="Risk Events" code="LOG" glow>
          <div className="space-y-2">
            {events.map((e: any) => (
              <div key={e.id} className={`flex items-start gap-3 rounded-sm border p-3 ${
                e.severity === "WARN" ? "border-amber-signal/40 bg-amber-signal/10" :
                e.severity === "ERROR" ? "border-loss/40 bg-loss/10" :
                "border-hairline bg-muted/30"
              }`}>
                {e.severity === "WARN" || e.severity === "ERROR" || e.severity === "CRITICAL" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-signal" />
                ) : (
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{e.message}</span>
                    <Tag tone={e.severity === "WARN" ? "warn" : e.severity === "ERROR" ? "loss" : "default"}>{e.severity}</Tag>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{e.details}</div>
                </div>
                <span className="shrink-0 font-mono text-[0.6rem] text-muted-foreground">{e.timestamp}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function GaugeItem({ label, used, cap, pct, tone, isInt = false }: {
  label: string; used: number; cap: number; pct: number; tone: "gain" | "loss" | "cyan" | "primary"; isInt?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-[0.7rem] tabular-nums text-foreground">
          {isInt ? `${used} / ${cap}` : `$${used.toLocaleString()} / $${cap.toLocaleString()}`}
        </span>
      </div>
      <Meter value={pct} tone={tone === "gain" ? "primary" : tone === "cyan" ? "amber" : tone} className="mt-1.5" />
      <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">{pct.toFixed(1)}% consumed</div>
    </div>
  );
}

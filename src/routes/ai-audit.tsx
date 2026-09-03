import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, GitBranch, LineChart, ScrollText, Shield, Zap } from "lucide-react";
import { PageHeader, Panel, Stat, Tag, Meter } from "@/components/space/Panel";
import { MiniBars } from "@/components/space/Charts";
import { fetchAudit } from "@/api/client";

export const Route = createFileRoute("/ai-audit")({
  head: () => ({
    meta: [
      { title: "AI Audit — Orbital AI Command Center" },
      { name: "description", content: "Long-term AI performance audit, strategy evolution, decision quality and evolution tracking." },
      { property: "og:title", content: "AI Audit — Orbital AI Command Center" },
    ],
  }),
  component: AiAudit,
});

function AiAudit() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: fetchAudit,
  });

  const data = response?.data;
  const auditMonths = data?.monthlyAudit || [];
  const evolution = data?.aiEvolution || [];

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Review · Long-Term Audit" title="AI Audit" desc="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Review · Long-Term Audit"
        title="AI Audit"
        desc="Performance audit across all dimensions: win rate, profit factor, drawdown, and decision quality."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Overall Win Rate" value="68.4%" sub="6-month average" tone="gain" icon={<TargetIcon className="h-4 w-4" />} />
        <Stat label="Profit Factor" value="2.34" sub="Best month: 2.34" tone="gain" icon={<BarChart3 className="h-4 w-4" />} />
        <Stat label="Max Drawdown" value="-7.8%" sub="Month of August" tone="loss" icon={<Shield className="h-4 w-4" />} />
        <Stat label="Decision Quality" value="86" sub="Score out of 100" tone="gain" icon={<ScrollText className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Monthly Performance" code="6 MONTHS" glow className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  {["Month", "Win Rate", "Profit Factor", "Max Drawdown", "Decision Quality"].map((h) => (
                    <th key={h} className="label-mono px-4 py-2 text-left font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditMonths.map((m: any) => (
                  <tr key={m.month} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-foreground">{m.month}</td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-gain">{m.winRate}%</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Meter value={(m.profitFactor / 3) * 100} className="w-16" />
                        <span className="font-mono text-xs tabular-nums text-foreground">{m.profitFactor.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-loss">{m.maxDrawdown}%</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Meter value={m.decisionQuality} tone="primary" className="w-16" />
                        <span className="font-mono text-xs tabular-nums text-foreground">{m.decisionQuality}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Drawdown History" code="MONTHLY">
          <MiniBars
            data={auditMonths.map((m: any) => ({ m: m.month, dd: Math.abs(m.maxDrawdown) }))}
            dataKey="dd"
            negative
            height={200}
          />
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="AI Evolution" code="5 GENERATIONS" glow className="xl:col-span-2">
          <div className="space-y-4">
            {evolution.map((e: any, i: number) => (
              <div key={e.generation} className="flex items-center gap-4">
                <div className="w-20 shrink-0">
                  <Tag>{e.generation}</Tag>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{e.label}</div>
                  <Meter value={e.score} className="mt-2" tone={i === evolution.length - 1 ? "primary" : "cyan"} />
                </div>
                <div className="shrink-0 font-mono text-lg font-semibold text-primary glow-text">{e.score}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Audit Summary" code="OVERVIEW">
          <div className="space-y-4">
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
              <div className="label-mono">Current Generation</div>
              <div className="font-mono text-xl font-semibold text-primary glow-text">GEN 5</div>
              <div className="mt-1 text-xs text-foreground/80">Adaptive risk sizing</div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="label-mono">Uptime</span><span className="font-mono text-xs text-foreground">6 months</span></div>
              <div className="flex justify-between"><span className="label-mono">Strategies Tested</span><span className="font-mono text-xs text-foreground">7</span></div>
              <div className="flex justify-between"><span className="label-mono">Strategies Active</span><span className="font-mono text-xs text-foreground">3</span></div>
              <div className="flex justify-between"><span className="label-mono">Learning Cycles</span><span className="font-mono text-xs text-foreground">121</span></div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TargetIcon(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

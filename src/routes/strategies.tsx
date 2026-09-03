import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Layers, TrendingUp, Zap } from "lucide-react";
import { PageHeader, Panel, Stat, Tag, Meter } from "@/components/space/Panel";
import { fetchStrategies } from "@/api/client";

export const Route = createFileRoute("/strategies")({
  head: () => ({
    meta: [
      { title: "Strategies — Orbital AI Command Center" },
      { name: "description", content: "Strategy portfolio overview, performance metrics and allocation status." },
      { property: "og:title", content: "Strategies — Orbital AI Command Center" },
    ],
  }),
  component: Strategies,
});

function Strategies() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["strategies"],
    queryFn: fetchStrategies,
  });

  const strategies = response?.data || [];
  const active = strategies.filter((s: any) => s.state === "ACTIVE");
  const totalAlloc = active.reduce((a: number, s: any) => a + s.allocationPercent, 0);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Allocation · Strategy Matrix" title="Strategies" desc="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Allocation · Strategy Matrix"
        title="Strategies"
        desc="Strategy portfolio: performance, allocation, and evolution state."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Active Strategies" value={String(active.length)} sub={`of ${strategies.length} total`} icon={<Layers className="h-4 w-4" />} />
        <Stat label="Total Allocation" value={`${totalAlloc}%`} sub="Deployed capital" icon={<BarChart3 className="h-4 w-4" />} />
        <Stat label="Best Performer" value={active[0]?.name || "N/A"} sub={`PF ${active[0]?.profitFactor?.toFixed(2) || "0"}`} tone="gain" icon={<TrendingUp className="h-4 w-4" />} />
        <Stat label="Total Trades" value={String(strategies.reduce((a: number, s: any) => a + s.totalTrades, 0))} sub="All strategies" icon={<Zap className="h-4 w-4" />} />
      </div>

      <div className="mt-3">
        <Panel title="Strategy Portfolio" code="ALL STRATEGIES" glow>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  {["Strategy", "Version", "State", "Alloc", "Win Rate", "PF", "Trades", "PnL"].map((h) => (
                    <th key={h} className="label-mono px-4 py-2 text-left font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {strategies.map((s: any) => (
                  <tr key={s.id} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-foreground">{s.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.version}</td>
                    <td className="px-4 py-2.5">
                      <Tag tone={s.state === "ACTIVE" ? "gain" : s.state === "PROBATION" ? "warn" : "default"}>{s.state}</Tag>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Meter value={s.allocationPercent} className="w-16" />
                        <span className="font-mono text-xs text-foreground">{s.allocationPercent}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-foreground">{s.winRate}%</td>
                    <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${s.profitFactor >= 2 ? "text-gain" : "text-foreground"}`}>
                      {s.profitFactor.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">{s.totalTrades}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${s.totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
                      ${s.totalPnl.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        {active.slice(0, 3).map((s: any) => (
          <Panel key={s.id} title={s.name} code={s.version} glow={s.name === "Momentum Breakout"}>
            <div className="flex items-center justify-between">
              <div>
                <Tag tone="gain">{s.state}</Tag>
                <div className="mt-2 font-mono text-3xl font-semibold text-foreground">{s.winRate}%</div>
                <div className="label-mono">Win Rate</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-semibold text-primary glow-text">{s.profitFactor.toFixed(2)}</div>
                <div className="label-mono">Profit Factor</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-hairline pt-3">
              <div className="flex justify-between"><span className="label-mono">Allocation</span><span className="font-mono text-xs text-foreground">{s.allocationPercent}%</span></div>
              <div className="flex justify-between"><span className="label-mono">Total Trades</span><span className="font-mono text-xs text-foreground">{s.totalTrades}</span></div>
              <div className="flex justify-between"><span className="label-mono">Total PnL</span><span className="font-mono text-xs text-gain">${s.totalPnl.toLocaleString()}</span></div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

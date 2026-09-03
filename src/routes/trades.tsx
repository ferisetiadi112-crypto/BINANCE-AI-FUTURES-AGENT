import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Filter, Target } from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { fetchTrades } from "@/api/client";

export const Route = createFileRoute("/trades")({
  head: () => ({
    meta: [
      { title: "Trades — Orbital AI Command Center" },
      { name: "description", content: "Complete trade history with PnL, duration, strategy attribution and filtering." },
      { property: "og:title", content: "Trades — Orbital AI Command Center" },
    ],
  }),
  component: Trades,
});

function Trades() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
  });

  const trades = response?.data || [];
  const wins = trades.filter((t: any) => t.pnl >= 0);
  const losses = trades.filter((t: any) => t.pnl < 0);
  const totalPnl = trades.reduce((a: number, t: any) => a + t.pnl, 0);

  // P7D-4.4: Show page header immediately, data loads inline

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="History · Trade Log"
        title="Trades"
        desc="Complete trade history with PnL, duration and strategy attribution."
      />

      {isLoading && trades.length === 0 && (
        <div className="flex items-center gap-3 rounded-sm border border-primary/20 bg-primary/5 px-4 py-3 mb-3">
          <div className="pulse-dot h-3 w-3 rounded-full bg-primary" />
          <span className="font-mono text-xs text-muted-foreground">Loading trades...</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Total Trades" value={String(trades.length)} sub="Showing recent" icon={<Target className="h-4 w-4" />} />
        <Stat label="Winning" value={String(wins.length)} sub={`${trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(0) : 0}% win rate`} tone="gain" icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="Losing" value={String(losses.length)} sub={`${trades.length > 0 ? ((losses.length / trades.length) * 100).toFixed(0) : 0}%`} tone="loss" icon={<ArrowDownRight className="h-4 w-4" />} />
        <Stat label="Net PnL" value={`$${totalPnl.toFixed(2)}`} sub="Recent trades" tone={totalPnl >= 0 ? "gain" : "loss"} />
      </div>

      <div className="mt-3">
        <Panel
          title="Trade History"
          code={`${trades.length} TRADES`}
          glow
          action={<div className="flex items-center gap-2"><Tag tone="default"><Filter className="mr-1 inline h-3 w-3" />All</Tag></div>}
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  {["ID", "Symbol", "Side", "Entry", "Exit", "PnL", "%", "Duration", "Strategy"].map((h) => (
                    <th key={h} className="label-mono px-4 py-2 text-left font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t: any) => (
                  <tr key={t.id} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.id}</td>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-foreground">{t.symbol}</td>
                    <td className="px-4 py-2.5">
                      <Tag tone={t.side === "LONG" ? "gain" : "violet"}>{t.side}</Tag>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">{t.entryPrice.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">{t.exitPrice.toLocaleString()}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs tabular-nums font-semibold ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${t.pnlPercent >= 0 ? "text-gain" : "text-loss"}`}>
                      {t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent}%
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.duration}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.strategyName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

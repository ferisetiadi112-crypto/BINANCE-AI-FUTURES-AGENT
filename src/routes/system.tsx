import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Globe, HardDrive, Radio, Server, Wifi } from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { fetchSystem, fetchHealth } from "@/api/client";

export const Route = createFileRoute("/system")({
  head: () => ({
    meta: [
      { title: "System — Orbital AI Command Center" },
      { name: "description", content: "System health, component status, architecture overview and configuration." },
      { property: "og:title", content: "System — Orbital AI Command Center" },
    ],
  }),
  component: System,
});

function System() {
  const { data: systemResp, isLoading: systemLoading } = useQuery({
    queryKey: ["system"],
    queryFn: fetchSystem,
  });

  const { data: healthResp } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  const system = systemResp?.data;
  const health = healthResp?.data;
  const config = system?.config;
  const nodes = system?.nodes || [];

  if (systemLoading || !system) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Infrastructure · System Status" title="System" desc="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
        </div>
      </div>
    );
  }

  const online = nodes.filter((n: any) => n.state === "ONLINE").length;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Infrastructure · System Status"
        title="System"
        desc="Component health, latency monitoring and system configuration."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="System Health" value={`${online}/${nodes.length}`} sub="Components online" tone="gain" icon={<Server className="h-4 w-4" />} />
        <Stat label="Version" value={`v${system.version}`} sub="Foundation Phase" icon={<Cpu className="h-4 w-4" />} />
        <Stat label="Environment" value={system.environment} sub="Paper trading mode" icon={<Radio className="h-4 w-4" />} />
        <Stat label="Uptime" value={system.uptime} sub="Since last restart" icon={<Globe className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Component Status" code={`${nodes.length} NODES`} glow className="xl:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((n: any) => (
              <div key={n.name} className="rounded-sm border border-hairline bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-foreground">{n.name}</span>
                  <Tag tone={n.state === "ONLINE" ? "gain" : n.state === "TRAINING" ? "warn" : "loss"}>{n.state}</Tag>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono text-[0.65rem] text-muted-foreground">{n.detail}</span>
                  <span className="font-mono text-[0.65rem] text-foreground">{n.latency}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Configuration" code="SETTINGS">
          <div className="space-y-3">
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
              <div className="label-mono">Trading Mode</div>
              <div className="mt-1 font-mono text-sm font-semibold text-primary glow-text">
                {config?.paperTradingMode ? "PAPER TRADING" : "LIVE"}
              </div>
              <div className="mt-1 text-xs text-foreground/80">
                {config?.tradingEnabled ? "Trading active" : "Trading disabled — foundation phase"}
              </div>
            </div>
            <div className="space-y-2 border-t border-hairline pt-3">
              <div className="flex justify-between"><span className="label-mono">Initial Capital</span><span className="font-mono text-xs text-foreground">${config?.initialCapital?.toFixed(2) || "5.00"}</span></div>
              <div className="flex justify-between"><span className="label-mono">Daily Profit Cap</span><span className="font-mono text-xs text-gain">${config?.dailyProfitCap?.toFixed(2) || "0.50"}</span></div>
              <div className="flex justify-between"><span className="label-mono">Daily Loss Limit</span><span className="font-mono text-xs text-loss">${config?.dailyLossLimit?.toFixed(2) || "0.50"}</span></div>
              <div className="flex justify-between"><span className="label-mono">Max Leverage</span><span className="font-mono text-xs text-foreground">{config?.maxLeverage || 10}x</span></div>
              <div className="flex justify-between"><span className="label-mono">Binance Testnet</span><span className="font-mono text-xs text-foreground">{config?.binanceTestnetEnabled ? "Connected" : "Not configured"}</span></div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Architecture" code="COMPONENT MAP" className="xl:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { name: "Dashboard UI", desc: "TanStack Start + React 19", icon: <Globe className="h-4 w-4" /> },
              { name: "API Layer", desc: "Server Functions (TanStack Start)", icon: <Server className="h-4 w-4" /> },
              { name: "Data Adapter", desc: "Database → Mock fallback", icon: <HardDrive className="h-4 w-4" /> },
              { name: "Database", desc: health?.database === "connected" ? "PostgreSQL (Neon)" : "SQLite (dev fallback)", icon: <HardDrive className="h-4 w-4" /> },
              { name: "Trading Engine", desc: "Long-running process — Phase 4", icon: <Cpu className="h-4 w-4" /> },
              { name: "Binance Adapter", desc: "Exchange interface — Phase 4", icon: <Wifi className="h-4 w-4" /> },
            ].map((c) => (
              <div key={c.name} className="flex items-center gap-3 rounded-sm border border-hairline bg-muted/30 p-3">
                <span className="text-primary/70">{c.icon}</span>
                <div>
                  <div className="font-mono text-xs font-semibold text-foreground">{c.name}</div>
                  <div className="font-mono text-[0.6rem] text-muted-foreground">{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Data Sources" code="ADAPTER">
          <div className="space-y-3">
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
              <div className="label-mono">Current Data Source</div>
              <div className="mt-1 font-mono text-sm font-semibold text-primary glow-text">{health?.database?.toUpperCase() || "MOCK"}</div>
              <div className="mt-1 text-xs text-foreground/80">
                {health?.database === "connected" ? "Database active. Real data served." : "All data is simulated."}
              </div>
            </div>
            <div className="space-y-2 border-t border-hairline pt-3">
              <div className="flex justify-between items-center">
                <span className="label-mono">Market Data</span>
                <Tag>{health?.database === "connected" ? "Database" : "Mock"}</Tag>
              </div>
              <div className="flex justify-between items-center">
                <span className="label-mono">Account Data</span>
                <Tag>{health?.database === "connected" ? "Database" : "Mock"}</Tag>
              </div>
              <div className="flex justify-between items-center">
                <span className="label-mono">AI Decisions</span>
                <Tag>{health?.database === "connected" ? "Database" : "Mock"}</Tag>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

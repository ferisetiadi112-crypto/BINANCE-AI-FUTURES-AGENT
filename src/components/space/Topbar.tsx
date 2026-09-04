import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tag } from "./Panel";
import { useAgentStatus } from "@/hooks/use-agent-status";
import { fmtMoney } from "@/components/observatory/AgentMonitor";

const chipTone = {
  gain: "text-gain",
  loss: "text-loss",
  warn: "text-amber-signal",
  cyan: "text-cyan-signal",
  muted: "text-muted-foreground",
} as const;

function StatusChip({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: keyof typeof chipTone;
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[0.65rem] uppercase tracking-[0.14em]">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          tone === "gain"
            ? "bg-gain"
            : tone === "loss"
              ? "bg-loss"
              : tone === "warn"
                ? "bg-amber-signal"
                : tone === "cyan"
                  ? "bg-cyan-signal animate-pulse"
                  : "bg-muted-foreground/60"
        }`}
      />
      <span className="text-muted-foreground/80">{label}</span>
      <span className={chipTone[tone]}>{text}</span>
    </span>
  );
}

export function Topbar() {
  // Shares the single cached "agent-status" query — no extra endpoints.
  const { data, isPending, isError } = useAgentStatus(30_000);
  const s = data?.data ?? null;

  const statusText =
    isPending && !s ? "CONNECTING" : isError && !s ? "UNREACHABLE" : (s?.status ?? "—");
  const statusTone =
    s?.status === "RUNNING"
      ? ("gain" as const)
      : isPending && !s
        ? ("cyan" as const)
        : ("loss" as const);

  const pnl = s?.pnlToday ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-background/80 px-3 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-primary" />

      {/* Live system strip — hidden on the smallest screens to keep the shell compact */}
      <div className="hidden min-w-0 flex-1 items-center justify-start gap-4 overflow-hidden md:flex">
        <StatusChip label="AI" text={statusText} tone={statusTone} />
        <StatusChip
          label="POSITION"
          text={s?.position ? `${s.position.side} ${s.position.symbol}` : "NONE"}
          tone={s?.position ? "cyan" : "muted"}
        />
        <StatusChip
          label="TODAY"
          text={fmtMoney(pnl)}
          tone={pnl > 0 ? "gain" : pnl < 0 ? "loss" : "muted"}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tag tone="cyan">{s?.executionMode ?? "PAPER"}</Tag>
        <Tag tone={statusTone === "gain" ? "gain" : statusTone === "cyan" ? "cyan" : "loss"}>
          {statusText === "RUNNING" ? "LIVE" : statusText}
        </Tag>
      </div>
    </header>
  );
}

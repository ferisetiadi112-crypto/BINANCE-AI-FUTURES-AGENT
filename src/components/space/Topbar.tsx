import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tag } from "./Panel";

const ticker = [
  { s: "BTCUSDT", p: "63,884.90", d: "+1.24%" },
  { s: "ETHUSDT", p: "3,402.15", d: "+0.86%" },
  { s: "SOLUSDT", p: "182.44", d: "-0.42%" },
  { s: "BNBUSDT", p: "608.20", d: "+0.31%" },
  { s: "FUNDING", p: "0.011%", d: "8h" },
];

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-background/80 px-3 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-primary" />
      <div className="hidden items-center gap-2 md:flex">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-foreground/80">
          Systems Nominal
        </span>
      </div>

      <div className="mx-auto hidden flex-1 items-center justify-center gap-5 overflow-hidden lg:flex">
        {ticker.map((t) => (
          <div key={t.s} className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="label-mono">{t.s}</span>
            <span className="font-mono text-xs tabular-nums text-foreground">{t.p}</span>
            <span
              className={
                t.d.startsWith("-")
                  ? "font-mono text-[0.65rem] text-loss"
                  : "font-mono text-[0.65rem] text-gain"
              }
            >
              {t.d}
            </span>
          </div>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tag tone="cyan">Simulation</Tag>
        <Tag tone="gain">AI Online</Tag>
      </div>
    </header>
  );
}

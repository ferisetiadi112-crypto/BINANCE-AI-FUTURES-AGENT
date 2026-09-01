import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  code,
  action,
  children,
  className,
  bodyClassName,
  glow = false,
}: {
  title?: string;
  code?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  glow?: boolean;
}) {
  return (
    <section className={cn("panel corner-ticks", glow && "panel-glow", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <h2 className="truncate font-mono text-[0.7rem] uppercase tracking-[0.18em] text-foreground/85">
              {title}
            </h2>
            {code && <span className="label-mono hidden sm:inline">{code}</span>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "gain" | "loss" | "warn";
  icon?: ReactNode;
}) {
  const toneClass =
    tone === "gain"
      ? "text-gain glow-text"
      : tone === "loss"
        ? "text-loss"
        : tone === "warn"
          ? "text-amber-signal"
          : "text-foreground";
  return (
    <div className="panel corner-ticks sweep overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="label-mono">{label}</span>
        {icon && <span className="text-primary/70">{icon}</span>}
      </div>
      <div className={cn("mt-2 font-mono text-2xl font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
      {sub && <div className="mt-1 font-mono text-[0.7rem] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Meter({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "amber" | "loss" | "cyan";
  className?: string;
}) {
  const bg =
    tone === "amber"
      ? "bg-amber-signal"
      : tone === "loss"
        ? "bg-loss"
        : tone === "cyan"
          ? "bg-cyan-signal"
          : "bg-primary";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-700", bg)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, boxShadow: "var(--glow-sm)" }}
      />
    </div>
  );
}

export function Tag({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "gain" | "loss" | "warn" | "cyan" | "violet";
}) {
  const map = {
    default: "border-hairline text-muted-foreground",
    gain: "border-primary/40 text-gain bg-primary/10",
    loss: "border-loss/40 text-loss bg-loss/10",
    warn: "border-amber-signal/40 text-amber-signal bg-amber-signal/10",
    cyan: "border-cyan-signal/40 text-cyan-signal bg-cyan-signal/10",
    violet: "border-violet-signal/40 text-violet-signal bg-violet-signal/10",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.14em]",
        map[tone],
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="label-mono flex items-center gap-2">
          <span className="ticker-blink text-primary">▮</span>
          {eyebrow}
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{desc}</p>
      </div>
      {right}
    </div>
  );
}

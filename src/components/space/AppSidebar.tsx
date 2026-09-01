import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BrainCircuit,
  CandlestickChart,
  Gauge,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  Radar,
  ScrollText,
  ShieldAlert,
  Cpu,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const groups = [
  {
    label: "Command",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "AI Intelligence", url: "/ai-intelligence", icon: BrainCircuit },
      { title: "Market Analysis", url: "/market-analysis", icon: Radar },
    ],
  },
  {
    label: "Execution",
    items: [
      { title: "Trading", url: "/trading", icon: CandlestickChart },
      { title: "Strategies", url: "/strategies", icon: LineChart },
      { title: "Trades", url: "/trades", icon: ListOrdered },
    ],
  },
  {
    label: "Cognition",
    items: [
      { title: "Learning", url: "/learning", icon: Activity },
      { title: "AI Audit", url: "/ai-audit", icon: ScrollText },
    ],
  },
  {
    label: "Control",
    items: [
      { title: "Risk Center", url: "/risk-center", icon: ShieldAlert },
      { title: "System", url: "/system", icon: Cpu },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-hairline">
      <SidebarHeader className="border-b border-hairline bg-sidebar/60">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-primary/50 bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
            <span className="pulse-dot absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
                ORBITAL<span className="text-primary">·</span>AI
              </div>
              <div className="label-mono truncate">Futures Command</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar/40">
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="label-mono">{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link
                          to={item.url}
                          className={
                            active
                              ? "relative font-mono text-[0.78rem] tracking-wide text-primary before:absolute before:-left-2 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:bg-primary"
                              : "font-mono text-[0.78rem] tracking-wide text-sidebar-foreground/80"
                          }
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-hairline bg-sidebar/60">
        {!collapsed ? (
          <div className="px-2 py-1.5">
            <div className="label-mono">Session</div>
            <div className="mt-1 font-mono text-[0.7rem] text-foreground/80">
              NODE-07 · SIM MODE
            </div>
            <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
              No exchange connected
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-2">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

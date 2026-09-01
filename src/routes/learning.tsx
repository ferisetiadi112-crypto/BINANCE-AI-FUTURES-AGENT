import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Clock, Lightbulb, TrendingUp } from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { DualLine } from "@/components/space/Charts";
import { fetchLearning } from "@/api/client";

export const Route = createFileRoute("/learning")({
  head: () => ({
    meta: [
      { title: "Learning — Orbital AI Command Center" },
      { name: "description", content: "AI experience memory, lessons learned, learning timeline and improvement metrics." },
      { property: "og:title", content: "Learning — Orbital AI Command Center" },
    ],
  }),
  component: Learning,
});

function Learning() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["learning"],
    queryFn: fetchLearning,
  });

  const data = response?.data;

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Cognition · Memory Core" title="AI Learning" desc="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Cognition · Memory Core"
        title="AI Learning"
        desc="How the agent learns from trade outcomes, adapts its strategies, and improves over time."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Experiences" value={String(data.experiences?.length || 0)} sub="Recorded patterns" icon={<BrainCircuit className="h-4 w-4" />} />
        <Stat label="Lessons" value={String(data.lessons?.length || 0)} sub="Distilled insights" icon={<Lightbulb className="h-4 w-4" />} />
        <Stat label="Learning Cycle" value="121" sub="Current cycle" icon={<Clock className="h-4 w-4" />} />
        <Stat label="Accuracy" value="83.1%" sub="+4.2% from Cycle 1" tone="gain" icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="AI Experiences" code="PATTERN MEMORY" className="xl:col-span-2" glow>
          <div className="space-y-3">
            {(data.experiences || []).map((e: any) => (
              <div key={e.id} className="flex items-start gap-3 rounded-sm border border-hairline bg-muted/30 p-3 transition-colors hover:bg-primary/5">
                <Tag tone={e.tag === "PATTERN" ? "gain" : e.tag === "RISK" ? "loss" : e.tag === "EXIT" ? "cyan" : e.tag === "TIMING" ? "warn" : "default"}>
                  {e.tag}
                </Tag>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{e.title}</div>
                  <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">Impact: {e.impact}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm text-primary">{e.confidence}%</div>
                  <div className="label-mono">Confidence</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Lessons Learned" code="DISTILLED">
          <div className="space-y-3">
            {(data.lessons || []).map((l: any, i: number) => (
              <div key={i} className="border-b border-hairline/50 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Tag>Cycle {l.cycle}</Tag>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{l.text}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Learning Timeline" code="EVOLUTION" className="xl:col-span-2">
          <div className="space-y-4">
            {(data.timeline || []).map((t: any, i: number) => (
              <div key={i} className="flex gap-4 border-b border-hairline/50 pb-4 last:border-0 last:pb-0">
                <div className="shrink-0 text-center">
                  <Tag>{t.cycle}</Tag>
                  <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">{t.when}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{t.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Improvement Curve" code="24 CYCLES">
          <DualLine
            data={(data.improvement || []).map((i: any) => ({
              cycle: i.cycle,
              accuracy: i.accuracy,
              pf: i.profitFactor,
            }))}
            height={260}
          />
          <div className="mt-3 flex items-center gap-4 border-t border-hairline pt-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="label-mono">Accuracy</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-signal" />
              <span className="label-mono">Profit Factor</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

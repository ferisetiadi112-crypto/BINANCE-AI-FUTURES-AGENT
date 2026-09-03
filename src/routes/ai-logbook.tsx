/**
 * AI Logbook — BINANCE AI FUTURES AGENT
 *
 * Halaman logbook aktivitas AI dalam Bahasa Indonesia.
 * Menampilkan rekaman aktivitas, keputusan, memori, dan pembelajaran AI.
 *
 * Sumber data: Journal events dari sistem aktual.
 * Tidak ada data palsu/dummy.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Activity,
  Brain,
  BookOpen,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  ScrollText,
  XCircle,
  AlertTriangle,
  Zap,
  Shield,
  TrendingUp,
  Cpu,
} from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { fetchAiLogbook, fetchRuntime } from "@/api/client";
import type { LogbookCategory } from "@/backend/journal/ai-logbook-formatter";

export const Route = createFileRoute("/ai-logbook")({
  head: () => ({
    meta: [
      { title: "AI Logbook — Orbital AI Command Center" },
      {
        name: "description",
        content:
          "Rekaman aktivitas, keputusan, memori, dan pembelajaran AI.",
      },
      {
        property: "og:title",
        content: "AI Logbook — Orbital AI Command Center",
      },
    ],
  }),
  component: AiLogbook,
});

// ─── Filter Config ──────────────────────────────────────────────────

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "SEMUA", label: "SEMUA" },
  { value: "ANALISIS", label: "ANALISIS" },
  { value: "KEPUTUSAN", label: "KEPUTUSAN" },
  { value: "RISIKO", label: "RISIKO" },
  { value: "TRADING", label: "TRADING" },
  { value: "PEMBELAJARAN", label: "PEMBELAJARAN" },
  { value: "TEKNIS", label: "TEKNIS" },
  { value: "ERROR", label: "ERROR" },
];

// ─── Helpers ────────────────────────────────────────────────────────

const money = (n: number) =>
  `$${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

function memoryIcon(status: string) {
  if (status === "DISIMPAN") return <CheckCircle2 className="inline h-3 w-3 text-gain" />;
  if (status === "GAGAL") return <AlertTriangle className="inline h-3 w-3 text-loss" />;
  return <XCircle className="inline h-3 w-3 text-muted-foreground" />;
}

function learningIcon(status: string) {
  if (status === "TERSIMPAN") return <CheckCircle2 className="inline h-3 w-3 text-gain" />;
  if (status === "GAGAL") return <AlertTriangle className="inline h-3 w-3 text-loss" />;
  return <XCircle className="inline h-3 w-3 text-muted-foreground" />;
}

function categoryColor(cat: string) {
  switch (cat) {
    case "ANALISIS": return "text-cyan-signal";
    case "KEPUTUSAN": return "text-primary";
    case "RISIKO": return "text-amber-signal";
    case "TRADING": return "text-gain";
    case "MEMORI": return "text-violet-signal";
    case "PEMBELAJARAN": return "text-foreground";
    case "SISTEM": return "text-muted-foreground";
    case "ERROR": return "text-loss";
    default: return "text-foreground";
  }
}

function categoryBadgeColor(cat: string) {
  switch (cat) {
    case "ANALISIS": return "bg-cyan-signal/10 text-cyan-signal border-cyan-signal/30";
    case "KEPUTUSAN": return "bg-primary/10 text-primary border-primary/30";
    case "RISIKO": return "bg-amber-signal/10 text-amber-signal border-amber-signal/30";
    case "TRADING": return "bg-gain/10 text-gain border-gain/30";
    case "MEMORI": return "bg-violet-signal/10 text-violet-signal border-violet-signal/30";
    case "PEMBELAJARAN": return "bg-foreground/10 text-foreground border-foreground/30";
    case "SISTEM": return "bg-muted/30 text-muted-foreground border-hairline";
    case "ERROR": return "bg-loss/10 text-loss border-loss/30";
    default: return "bg-muted/30 text-muted-foreground border-hairline";
  }
}

// ─── Summary Card ───────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon: Icon,
  color = "text-foreground",
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-sm border border-hairline bg-surface/50 p-3">
      <Icon className={`h-4 w-4 ${color}`} />
      <div>
        <div className="font-mono text-lg font-bold text-foreground">{value}</div>
        <div className="label-mono">{label}</div>
      </div>
    </div>
  );
}

// ─── Logbook Entry Card ─────────────────────────────────────────────

function LogbookEntryCard({
  entry,
  onClick,
  isSelected,
}: {
  entry: any;
  onClick: () => void;
  isSelected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-sm border p-4 transition-colors ${
        isSelected
          ? "border-primary/50 bg-primary/5"
          : "border-hairline bg-surface/30 hover:bg-surface/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg">{entry.categoryIcon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-xs font-semibold ${categoryColor(entry.category)}`}>
              {entry.categoryLabel}
            </span>
            {entry.symbol && (
              <span className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[0.65rem] text-foreground">
                {entry.symbol}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {entry.timeFormatted}
            </span>
          </div>
          <div className="mt-1 font-mono text-sm text-foreground/90">
            {entry.description}
          </div>
          <div className="mt-1.5 flex items-center gap-3 font-mono text-[0.65rem] text-muted-foreground/70">
            <span>Hasil: {entry.result}</span>
            <span>·</span>
            <span title="Memori">{memoryIcon(entry.memoryStatus)} Memori</span>
            <span>·</span>
            <span title="Pembelajaran">{learningIcon(entry.learningStatus)} Belajar</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────

function DetailPanel({ entry }: { entry: any }) {
  if (!entry) return null;

  return (
    <Panel title="Detail Aktivitas" code="DETAIL" glow>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xl">{entry.categoryIcon}</span>
          <div>
            <div className="font-mono text-sm font-semibold text-foreground">{entry.categoryLabel}</div>
            <div className="font-mono text-xs text-muted-foreground">{entry.timeFormatted}</div>
          </div>
          {entry.symbol && (
            <span className="ml-auto rounded-sm border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[0.65rem] text-foreground">
              {entry.symbol}
            </span>
          )}
        </div>

        {/* Description */}
        <div className="border-t border-hairline pt-3">
          <div className="font-mono text-sm text-foreground/90">{entry.description}</div>
        </div>

        {/* Result & Decision */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-sm border border-hairline bg-surface/50 p-2">
            <div className="label-mono">HASIL</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{entry.result}</div>
          </div>
          <div className="rounded-sm border border-hairline bg-surface/50 p-2">
            <div className="label-mono">KEPUTUSAN</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{entry.decision}</div>
          </div>
        </div>

        {/* Reason */}
        {entry.reason && (
          <div className="border-t border-hairline pt-3">
            <div className="label-mono">ALASAN</div>
            <div className="mt-1 font-mono text-sm text-foreground/80">{entry.reason}</div>
          </div>
        )}

        {/* Risk Check */}
        {entry.riskCheck && (
          <div className="border-t border-hairline pt-3">
            <div className="label-mono">RISK CHECK</div>
            <div className="mt-1 font-mono text-sm text-foreground/80">{entry.riskCheck}</div>
          </div>
        )}

        {/* Memory & Learning Status */}
        <div className="border-t border-hairline pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label-mono">MEMORI</div>
              <div className="mt-1 font-mono text-sm">
                {memoryIcon(entry.memoryStatus)}{" "}
                {entry.memoryStatus === "DISIMPAN"
                  ? "Tersimpan"
                  : entry.memoryStatus === "GAGAL"
                    ? "Gagal menyimpan"
                    : "Tidak disimpan"}
              </div>
              {entry.memoryReason && (
                <div className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground">
                  {entry.memoryReason}
                </div>
              )}
            </div>
            <div>
              <div className="label-mono">PEMBELAJARAN</div>
              <div className="mt-1 font-mono text-sm">
                {learningIcon(entry.learningStatus)}{" "}
                {entry.learningStatus === "TERSIMPAN"
                  ? "Tersimpan"
                  : entry.learningStatus === "GAGAL"
                    ? "Gagal menyimpan"
                    : "Belum ada"}
              </div>
              {entry.learningDetail && (
                <div className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground">
                  {entry.learningDetail}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Technical Event ID (collapsed) */}
        <details className="border-t border-hairline pt-3">
          <summary className="cursor-pointer label-mono text-muted-foreground/60 hover:text-muted-foreground">
            Info Teknis
          </summary>
          <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
            {entry.technicalEventId} ({entry.technicalEventType})
          </div>
        </details>
      </div>
    </Panel>
  );
}

function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-hairline/50 py-1.5 last:border-0">
      <span className="label-mono">{label}</span>
      <span className="font-mono text-sm text-foreground">
        {icon && <span className="mr-1">{icon}</span>}
        {value}
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

function AiLogbook() {
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [activeFilter, setActiveFilter] = useState("SEMUA");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: logbookResp, isLoading: logbookLoading, isError: logbookError } = useQuery({
    queryKey: ["ai-logbook", activeFilter === "TEKNIS"],
    queryFn: () => fetchAiLogbook(activeFilter === "TEKNIS"),
    refetchInterval: 10_000,
    retry: 2,
    retryDelay: 2000,
  });

  const { data: runtimeResp } = useQuery({
    queryKey: ["runtime"],
    queryFn: fetchRuntime,
  });

  const logbook = logbookResp?.data;
  const runtime = runtimeResp?.data;
  const entries = logbook?.entries || [];
  const summary = logbook?.summary;
  const runtimeActive = logbook?.runtimeActive ?? false;

  // Filter entries (client-side search filter on top of server-side noise filter)
  const filteredEntries = useMemo(() => {
    let result = entries;

    if (activeFilter !== "SEMUA") {
      result = result.filter((e: any) => e.category === activeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e: any) =>
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.symbol && e.symbol.toLowerCase().includes(q)) ||
          (e.categoryLabel && e.categoryLabel.toLowerCase().includes(q)) ||
          (e.result && e.result.toLowerCase().includes(q)) ||
          (e.decision && e.decision.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [entries, activeFilter, searchQuery]);

  // P7D-4.4: No full-page loading blocker

  if (logbookError && !logbookResp) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader
          eyebrow="Cognition · AI Logbook"
          title="AI Logbook"
          desc="Gagal memuat aktivitas AI."
        />
        <Panel title="Error" code="ERROR">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-loss" />
            <div className="font-mono text-sm text-loss">
              Logbook tidak dapat memuat aktivitas.
            </div>
            <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
              Coba muat ulang halaman.
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Cognition · AI Logbook"
        title="AI Logbook"
        desc="Rekaman aktivitas, keputusan, memori, dan pembelajaran AI."
        right={
          <div className="flex items-center gap-3">
            <div className="panel corner-ticks flex items-center gap-2 px-3 py-2">
              <span
                className={`pulse-dot h-2 w-2 rounded-full ${
                  runtimeActive ? "bg-gain" : "bg-loss"
                }`}
              />
              <span className="font-mono text-xs text-foreground">
                {runtimeActive ? "AI ONLINE" : "AI OFFLINE"}
              </span>
            </div>
            <Tag tone={runtime?.stats?.testnetReady ? "gain" : "warn"}>
              {runtime?.stats?.executionMode === "TESTNET" ? "LIVE" : "PAUSED"}
            </Tag>
          </div>
        }
      />

      {/* ── Summary Cards ──────────────────────────────────────── */}
      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <SummaryCard label="Analisis" value={summary.analyses} icon={Brain} color="text-cyan-signal" />
          <SummaryCard label="Keputusan" value={summary.decisions} icon={Zap} color="text-primary" />
          <SummaryCard label="Risiko" value={summary.riskChecks} icon={Shield} color="text-amber-signal" />
          <SummaryCard label="Trading" value={summary.trades} icon={TrendingUp} color="text-gain" />
          <SummaryCard label="Ditolak" value={summary.rejected} icon={XCircle} color="text-loss" />
          <SummaryCard label="Memori" value={summary.memorySaved} icon={BookOpen} color="text-violet-signal" />
          <SummaryCard label="Pembelajaran" value={summary.learningGenerated} icon={ScrollText} color="text-foreground" />
        </div>
      )}

      {/* ── Filter Bar ────────────────────────────────────────── */}
      <Panel title="Filter" code="FILTER">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActiveFilter(opt.value)}
              className={`rounded-sm border px-2.5 py-1 font-mono text-[0.7rem] transition-colors ${
                activeFilter === opt.value
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-hairline text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari aktivitas, pasangan, atau kata kunci..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 rounded-sm border border-hairline bg-surface/50 px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </Panel>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Timeline */}
        <div className="lg:col-span-2">
          <Panel title="Timeline Aktivitas" code="LOGBOOK">
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <div className="font-mono text-sm text-muted-foreground">
                  {entries.length === 0
                    ? "Belum ada aktivitas AI yang tercatat."
                    : "Tidak ada aktivitas yang cocok dengan filter."}
                </div>
                <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
                  {entries.length === 0
                    ? "Aktivitas akan muncul setelah sistem mulai bekerja."
                    : "Coba ubah filter atau kata kunci pencarian."}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEntries.map((entry: any) => (
                  <LogbookEntryCard
                    key={entry.id}
                    entry={entry}
                    onClick={() => setSelectedEntry(entry)}
                    isSelected={selectedEntry?.id === entry.id}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Detail Panel */}
        <div>
          {selectedEntry ? (
            <DetailPanel entry={selectedEntry} />
          ) : (
            <Panel title="Detail Aktivitas" code="DETAIL">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <div className="font-mono text-sm text-muted-foreground">
                  Pilih aktivitas untuk melihat detail
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AI Logbook Formatter — BINANCE AI FUTURES AGENT
 *
 * Converts technical JournalEvent data into human-readable Bahasa Indonesia
 * for the AI Logbook dashboard page.
 *
 * Principles:
 * - Real data only — no fabrication
 * - Clear status indicators (✓/○/⚠)
 * - Technical IDs shown as audit info, not primary text
 * - Memory and learning status from actual system state
 */

import type { JournalEvent, JournalEventType } from "./index";

// ─── Activity Category Mapping ──────────────────────────────────────

export type LogbookCategory =
  | "ANALISIS"
  | "KEPUTUSAN"
  | "RISIKO"
  | "TRADING"
  | "MEMORI"
  | "PEMBELAJARAN"
  | "SISTEM"
  | "ERROR";

export const EVENT_TO_CATEGORY: Partial<Record<JournalEventType, LogbookCategory>> = {
  MARKET_SCAN: "ANALISIS",
  RESEARCH: "ANALISIS",
  ANALYSIS: "ANALISIS",
  RISK_CHECK: "RISIKO",
  TRADE_PROPOSED: "KEPUTUSAN",
  TRADE_APPROVED: "KEPUTUSAN",
  TRADE_REJECTED: "KEPUTUSAN",
  TRADE_OPENED: "TRADING",
  TRADE_CLOSED: "TRADING",
  POSITION_OPENED: "TRADING",
  POSITION_CLOSED: "TRADING",
  ORDER_SUBMITTED: "TRADING",
  ORDER_CONFIRMED: "TRADING",
  POST_TRADE_REVIEW: "PEMBELAJARAN",
  SYSTEM_STARTED: "SISTEM",
  SYSTEM_STOPPED: "SISTEM",
  STARTUP_RECONCILIATION: "SISTEM",
  PERIODIC_REPORT: "SISTEM",
  COOLDOWN_STARTED: "SISTEM",
  DAILY_LOSS_LIMIT: "SISTEM",
  PROFIT_TARGET_REACHED: "SISTEM",
  HARD_PROFIT_CAP: "SISTEM",
  PNL_UPDATED: "SISTEM",
  RISK_LOCKED: "SISTEM",
  STOP_LOSS: "TRADING",
  TAKE_PROFIT: "TRADING",
  POSITION_MONITOR: "SISTEM",
};

// ─── Category Display Names ─────────────────────────────────────────

export const CATEGORY_LABELS: Record<LogbookCategory, string> = {
  ANALISIS: "ANALISIS PASAR",
  KEPUTUSAN: "KEPUTUSAN AI",
  RISIKO: "PEMERIKSAAN RISIKO",
  TRADING: "TRADING",
  MEMORI: "MEMORI",
  PEMBELAJARAN: "PEMBELAJARAN",
  SISTEM: "AKTIVITAS SISTEM",
  ERROR: "KESALAHAN SISTEM",
};

export const CATEGORY_ICONS: Record<LogbookCategory, string> = {
  ANALISIS: "🧠",
  KEPUTUSAN: "⚡",
  RISIKO: "🛡",
  TRADING: "📈",
  MEMORI: "💾",
  PEMBELAJARAN: "📚",
  SISTEM: "⚙",
  ERROR: "⚠",
};

// ─── Logbook Entry Type ─────────────────────────────────────────────

export type LogbookEntry = {
  id: string;
  timestamp: number;
  timeFormatted: string;
  category: LogbookCategory;
  categoryLabel: string;
  categoryIcon: string;
  symbol: string | null;
  title: string;
  description: string;
  result: string;
  decision: string;
  reason: string;
  riskCheck: string | null;
  action: string;
  memoryStatus: "DISIMPAN" | "TIDAK DISIMPAN" | "GAGAL";
  memoryReason: string | null;
  learningStatus: "TERSIMPAN" | "BELUM ADA" | "GAGAL";
  learningDetail: string | null;
  technicalEventId: string;
  technicalEventType: JournalEventType;
  rawData: JournalEvent;
};

// ─── Formatter Functions ────────────────────────────────────────────

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  });
}

function formatDescription(event: JournalEvent): string {
  const sym = event.symbol || "";
  const symText = sym ? ` ${sym}` : "";

  switch (event.eventType) {
    case "MARKET_SCAN":
      return `AI melakukan pemindaian pasar${symText}.`;

    case "RESEARCH":
      return `AI melakukan riset mendalam pada${symText}.`;

    case "ANALYSIS":
      return `AI menganalisis${symText} untuk mencari peluang trading.`;

    case "RISK_CHECK": {
      const approved = event.riskDecision?.approved;
      return approved
        ? `AI melakukan pemeriksaan risiko pada${symText}. Keputusan: LULUS.`
        : `AI melakukan pemeriksaan risiko pada${symText}. Keputusan: DITOLAK.`;
    }

    case "TRADE_PROPOSED":
      return `AI mengajukan usulan perdagangan pada${symText}.`;

    case "TRADE_APPROVED":
      return `AI menyetujui perdagangan pada${symText}.`;

    case "TRADE_REJECTED":
      return `AI menolak perdagangan pada${symText}.${event.riskDecision?.reason ? ` ${event.riskDecision.reason}` : ""}`;

    case "TRADE_OPENED":
    case "POSITION_OPENED": {
      const pos = event.position;
      if (pos) {
        return `AI membuka posisi ${pos.side} pada${symText}.`;
      }
      return `AI membuka posisi pada${symText}.`;
    }

    case "TRADE_CLOSED":
    case "POSITION_CLOSED": {
      const pnlText = event.pnl !== undefined ? ` PnL: $${event.pnl.toFixed(2)}.` : "";
      return `AI menutup posisi pada${symText}.${pnlText}`;
    }

    case "ORDER_SUBMITTED":
      return `AI mengirim order pada${symText}.`;

    case "ORDER_CONFIRMED":
      return `Order pada${symText} terkonfirmasi.`;

    case "STOP_LOSS":
      return `AI memasang Stop Loss pada${symText}.`;

    case "TAKE_PROFIT":
      return `AI memasang Take Profit pada${symText}.`;

    case "POST_TRADE_REVIEW":
      return `AI melakukan evaluasi pasca trading pada${symText}.`;

    case "SYSTEM_STARTED":
      return "Sistem trading AI dimulai.";

    case "SYSTEM_STOPPED":
      return "Sistem trading AI dihentikan.";

    case "STARTUP_RECONCILIATION":
      return `Sistem melakukan rekonsiliasi saat startup.`;

    case "PERIODIC_REPORT":
      return `Sistem menghasilkan laporan periodik.`;

    case "COOLDOWN_STARTED":
      return `Sistem mengaktifkan cooldown karena target tercapai.`;

    case "DAILY_LOSS_LIMIT":
      return `Sistem mengunci trading karena batas kerugian harian tercapai.`;

    case "PROFIT_TARGET_REACHED":
      return `Sistem mencatat target keuntungan tercapai.`;

    case "HARD_PROFIT_CAP":
      return `Sistem mengunci trading karena batas keuntungan maksimum tercapai.`;

    case "PNL_UPDATED":
      return `Sistem memperbarui data PnL.`;

    case "RISK_LOCKED":
      return `Risk Engine terkunci.`;

    case "POSITION_MONITOR":
      return `AI memantau posisi yang sedang aktif.`;

    default:
      return event.message || "Aktivitas tidak diketahui.";
  }
}

function formatResult(event: JournalEvent): string {
  switch (event.eventType) {
    case "RISK_CHECK":
      return event.riskDecision?.approved ? "LULUS" : "DITOLAK";

    case "TRADE_PROPOSED":
      return "DIAJUKAN";

    case "TRADE_APPROVED":
      return "DISETUJUI";

    case "TRADE_REJECTED":
      return "DITOLAK";

    case "TRADE_OPENED":
    case "POSITION_OPENED":
      return "BERHASIL";

    case "TRADE_CLOSED":
    case "POSITION_CLOSED":
      return "SELESAI";

    case "ORDER_SUBMITTED":
      return "DIKIRIM";

    case "ORDER_CONFIRMED":
      return "TERKONFIRMASI";

    case "SYSTEM_STARTED":
      return "AKTIF";

    case "SYSTEM_STOPPED":
      return "BERHENTI";

    default:
      return "TERCATAT";
  }
}

function formatDecision(event: JournalEvent): string {
  switch (event.eventType) {
    case "TRADE_PROPOSED":
      return "Mengajukan perdagangan";

    case "TRADE_APPROVED":
      return "Disetujui Risk Engine";

    case "TRADE_REJECTED":
      return "Ditolak Risk Engine";

    case "TRADE_OPENED":
    case "POSITION_OPENED":
      return "Membuka posisi";

    case "TRADE_CLOSED":
    case "POSITION_CLOSED":
      return "Menutup posisi";

    case "RISK_CHECK":
      return event.riskDecision?.approved ? "Lolos pemeriksaan risiko" : "Tidak lolos pemeriksaan risiko";

    default:
      return event.action || "Aktivitas tercatat";
  }
}

function formatRiskCheck(event: JournalEvent): string | null {
  if (event.eventType !== "RISK_CHECK") return null;

  const checks = event.riskDecision?.checks;
  if (!checks || checks.length === 0) {
    return event.riskDecision?.approved ? "LULUS" : "DITOLAK";
  }

  const passed = checks.filter((c) => c.passed).length;
  return `${passed}/${checks.length} pemeriksaan lulus`;
}

function determineMemoryStatus(event: JournalEvent): {
  status: "DISIMPAN" | "TIDAK DISIMPAN" | "GAGAL";
  reason: string | null;
} {
  // Memory is saved for trade events and significant decisions
  const memoryEvents: JournalEventType[] = [
    "TRADE_OPENED",
    "TRADE_CLOSED",
    "POSITION_OPENED",
    "POSITION_CLOSED",
    "TRADE_APPROVED",
    "TRADE_REJECTED",
  ];

  if (memoryEvents.includes(event.eventType)) {
    return { status: "DISIMPAN", reason: null };
  }

  // Low-importance events don't get saved to memory
  if (event.importance === "LOW") {
    return {
      status: "TIDAK DISIMPAN",
      reason: "Informasi tidak memiliki nilai pembelajaran yang cukup",
    };
  }

  // Medium events — check if there's a risk decision
  if (event.eventType === "RISK_CHECK" && event.riskDecision?.approved) {
    return {
      status: "TIDAK DISIMPAN",
      reason: "Pemeriksaan risiko standar",
    };
  }

  return { status: "TIDAK DISIMPAN", reason: null };
}

function determineLearningStatus(event: JournalEvent): {
  status: "TERSIMPAN" | "BELUM ADA" | "GAGAL";
  detail: string | null;
} {
  // Only post-trade reviews and closed trades can generate learning
  if (event.eventType === "POST_TRADE_REVIEW") {
    return { status: "TERSIMPAN", detail: "Evaluasi pasca trading tercatat" };
  }

  if (event.eventType === "TRADE_CLOSED" || event.eventType === "POSITION_CLOSED") {
    return { status: "BELUM ADA", detail: "Menunggu evaluasi pasca trading" };
  }

  return { status: "BELUM ADA", detail: null };
}

// ─── Main Formatter ─────────────────────────────────────────────────

export function formatLogbookEntry(event: JournalEvent): LogbookEntry {
  const category = EVENT_TO_CATEGORY[event.eventType] || "SISTEM";

  return {
    id: event.id,
    timestamp: event.timestamp,
    timeFormatted: formatTime(event.timestamp),
    category,
    categoryLabel: CATEGORY_LABELS[category],
    categoryIcon: CATEGORY_ICONS[category],
    symbol: event.symbol || null,
    title: formatDescription(event).split(".")[0] + ".",
    description: formatDescription(event),
    result: formatResult(event),
    decision: formatDecision(event),
    reason: event.reasoning || event.riskDecision?.reason || "",
    riskCheck: formatRiskCheck(event),
    action: event.action || "",
    memoryStatus: determineMemoryStatus(event).status,
    memoryReason: determineMemoryStatus(event).reason,
    learningStatus: determineLearningStatus(event).status,
    learningDetail: determineLearningStatus(event).detail,
    technicalEventId: event.id,
    technicalEventType: event.eventType,
    rawData: event,
  };
}

export function formatLogbookEntries(events: JournalEvent[]): LogbookEntry[] {
  return events
    .map(formatLogbookEntry)
    .sort((a, b) => b.timestamp - a.timestamp); // Newest first
}

// ─── Summary Statistics ─────────────────────────────────────────────

export type LogbookSummary = {
  totalToday: number;
  analyses: number;
  decisions: number;
  riskChecks: number;
  trades: number;
  rejected: number;
  memorySaved: number;
  learningGenerated: number;
};

export function computeLogbookSummary(entries: LogbookEntry[]): LogbookSummary {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();

  const todayEntries = entries.filter((e) => e.timestamp >= todayTs);

  return {
    totalToday: todayEntries.length,
    analyses: todayEntries.filter((e) => e.category === "ANALISIS").length,
    decisions: todayEntries.filter((e) => e.category === "KEPUTUSAN").length,
    riskChecks: todayEntries.filter((e) => e.category === "RISIKO").length,
    trades: todayEntries.filter((e) => e.category === "TRADING").length,
    rejected: todayEntries.filter(
      (e) => e.result === "DITOLAK" || e.result === "DITOLAK",
    ).length,
    memorySaved: todayEntries.filter((e) => e.memoryStatus === "DISIMPAN").length,
    learningGenerated: todayEntries.filter((e) => e.learningStatus === "TERSIMPAN").length,
  };
}

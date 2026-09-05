/**
 * Phase 3.8-D.2 — Controlled Action Registry (default-deny allowlist)
 *
 * The Chat Agent CANNOT execute arbitrary functions. Every action must be:
 *   1. Declared in this registry (explicit allowlist)
 *   2. Granted an explicit permission
 *   3. Passed through the safety gate in the executor
 *
 * Unknown action IDs → DENY. Ungranted permissions → DENY. Any action whose
 * riskLevel is TRADING or MONEY_MOVEMENT → DENY unconditionally in D.2.
 *
 * HARD SAFETY: no handler in this registry mutates exchange state, and no
 * module in this file imports the trading executor, Binance client, or any
 * order/leverage/margin capability.
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

export type ActionRiskLevel = "READ_ONLY" | "CONTROLLED_MUTATION" | "TRADING" | "MONEY_MOVEMENT";

export type ActionPermission =
  | "chat.read.system"
  | "chat.read.market"
  | "chat.read.journal"
  | "chat.diagnostic.llm"
  | "chat.mutation.system"; // reserved for future controlled mutations

export type ActionId =
  | "system.readiness"
  | "runtime.status"
  | "market.status"
  | "market.feed_status"
  | "diagnostic.llm_probe"
  | "journal.recent"
  | "agent.status";

export type ControlledAction = {
  actionId: ActionId;
  description: string;
  permission: ActionPermission;
  riskLevel: ActionRiskLevel;
  requiresConfirmation: boolean;
  /** Bound at registry definition time — never resolved from AI/user input. */
  handler: () => Promise<unknown>;
};

export type ActionDecision = {
  actionId: string;
  allowed: boolean;
  reason: string;
  timestamp: string;
  actor: "boss/chat-agent";
  resultStatus: "NOT_RUN" | "OK" | "ERROR" | "DENIED";
};

/** JSON-serializable result value (server-fn safe — never Date/Map/class). */
export type SerializableActionValue =
  | null
  | boolean
  | number
  | string
  | SerializableActionValue[]
  | { [key: string]: SerializableActionValue };

export type ActionExecutionResult = {
  decision: ActionDecision;
  /** Present only when allowed and executed successfully. */
  result?: SerializableActionValue;
};

// ─── Handler implementations (existing read-only system functions only) ──

async function systemReadiness(): Promise<unknown> {
  const { isRuntimeInitialized, isDatabaseReady, getRuntimeInitError } = await import(
    "../../server"
  );
  const { isRuntimeRunning } = await import("../trading/runtime");
  const { isPostgresConfigured } = await import("../database");
  const { isTestnetConfigured } = await import("../exchange/binance-testnet");
  return {
    binanceConfigured: isTestnetConfigured(),
    databaseConfigured: isPostgresConfigured(),
    databaseReady: isDatabaseReady(),
    runtimeReady: isRuntimeInitialized(),
    runtimeRunning: isRuntimeRunning(),
    error: getRuntimeInitError(),
    // Hard rule: chat/system actions never report a permissive trading flag.
    tradingEnabled: false,
    executionMode:
      process.env["BINANCE_TESTNET_API_KEY"] && process.env["BINANCE_TESTNET_SECRET"]
        ? "TESTNET"
        : "PAPER",
  };
}

async function runtimeStatus(): Promise<unknown> {
  const { getRuntimeSnapshot, isRuntimeRunning } = await import("../trading/runtime");
  const snap = getRuntimeSnapshot();
  return {
    running: isRuntimeRunning(),
    tickIntervalMs: snap.tickIntervalMs,
    tickCount: snap.stats.tickCount,
    lastTickAt: snap.stats.lastTickAt,
    totalProcessed: snap.stats.totalProcessed,
    totalDecisions: snap.stats.totalDecisions,
    totalErrors: snap.stats.totalErrors,
    executionMode: snap.stats.executionMode,
    tradingEnabled: false,
    perSymbolCount: snap.perSymbol.length,
    recentEventCount: snap.recentEvents.length,
  };
}

async function marketStatus(): Promise<unknown> {
  const { getMarketSnapshot } = await import("../exchange/market-data-state");
  const snap = getMarketSnapshot();
  return {
    connectionStatus: snap.connectionStatus,
    lastUpdateAt: snap.lastUpdateAt,
    dataFreshness: snap.dataFreshness,
    errorCount: snap.errorCount,
    subscribedSymbols: snap.subscribedSymbols,
    tickCount: Object.keys(snap.symbols).length,
  };
}

async function marketFeedStatus(): Promise<unknown> {
  const { fetchFeedStatus } = await import("../services/data-adapter");
  return fetchFeedStatus();
}

async function llmProbe(): Promise<unknown> {
  const { runLLMProbe } = await import("../diagnostics/llm-probe");
  return runLLMProbe();
}

async function journalRecent(): Promise<unknown> {
  const { getRecentJournalEventsAsync } = await import("../journal");
  const events = await getRecentJournalEventsAsync(20);
  // Journal events are already safe metadata; pass through as-is.
  return { events: JSON.parse(JSON.stringify(events)) };
}

async function agentStatus(): Promise<unknown> {
  const { buildAgentStatus, AGENT_ACTIVITY_LIMIT } = await import("./agent-status");
  const { getOrchestrator, getRuntimeSnapshot, isRuntimeRunning } = await import(
    "../trading/runtime"
  );
  const { getRecentJournalEvents } = await import("../journal");
  const { getExchangeSnapshot } = await import("../exchange/unified-state");
  const { isRuntimeInitialized, getRuntimeInitError } = await import("../../server");

  const orchestrator = getOrchestrator();
  const latest = getRecentJournalEvents(AGENT_ACTIVITY_LIMIT);
  const activity = latest.map((e) => ({
    timestamp: e.timestamp,
    eventType: e.eventType,
    message: e.message,
    ...(e.symbol ? { symbol: e.symbol } : {}),
    ...(e.action ? { action: e.action } : {}),
    ...(typeof e.pnl === "number" ? { pnl: e.pnl } : {}),
    ...(e.position
      ? {
          position: {
            symbol: e.position.symbol,
            side: e.position.side,
            entryPrice: e.position.entryPrice,
            margin: e.position.margin,
            leverage: e.position.leverage,
          },
        }
      : {}),
  }));

  return buildAgentStatus({
    orchestrator,
    runtimeRunning: isRuntimeRunning(),
    runtime: getRuntimeSnapshot(),
    runtimeInitialized: isRuntimeInitialized(),
    runtimeInitError: getRuntimeInitError(),
    activity,
    exchangePositions:
      orchestrator?.getState().executionMode === "TESTNET"
        ? getExchangeSnapshot().positions
        : [],
  });
}

// ─── Registry (explicit allowlist — default deny) ───────────────────

const registry: ReadonlyMap<string, ControlledAction> = new Map<string, ControlledAction>([
  [
    "system.readiness",
    {
      actionId: "system.readiness",
      description: "Read boot readiness of database, runtime, and exchange configuration.",
      permission: "chat.read.system",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: systemReadiness,
    },
  ],
  [
    "runtime.status",
    {
      actionId: "runtime.status",
      description: "Read trading runtime tick stats and loop state.",
      permission: "chat.read.system",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: runtimeStatus,
    },
  ],
  [
    "market.status",
    {
      actionId: "market.status",
      description: "Read realtime market data connection state.",
      permission: "chat.read.market",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: marketStatus,
    },
  ],
  [
    "market.feed_status",
    {
      actionId: "market.feed_status",
      description: "Read per-symbol market feed status (12 symbols).",
      permission: "chat.read.market",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: marketFeedStatus,
    },
  ],
  [
    "diagnostic.llm_probe",
    {
      actionId: "diagnostic.llm_probe",
      description: "Run the existing read-only LLM provider probe (diagnostic prompt only).",
      permission: "chat.diagnostic.llm",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: llmProbe,
    },
  ],
  [
    "journal.recent",
    {
      actionId: "journal.recent",
      description: "Read the 20 most recent agent journal events.",
      permission: "chat.read.journal",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: journalRecent,
    },
  ],
  [
    "agent.status",
    {
      actionId: "agent.status",
      description: "Read the aggregate agent monitor status.",
      permission: "chat.read.system",
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      handler: agentStatus,
    },
  ],
]);

/** Permissions granted to the Chat Agent — explicit, minimal, default-deny. */
export const CHAT_AGENT_PERMISSIONS: ReadonlySet<ActionPermission> = new Set<ActionPermission>([
  "chat.read.system",
  "chat.read.market",
  "chat.read.journal",
  "chat.diagnostic.llm",
]);

// ─── Public API ─────────────────────────────────────────────────────

export function isRegisteredAction(actionId: string): boolean {
  return registry.has(actionId);
}

export function getRegisteredActionIds(): string[] {
  return [...registry.keys()];
}

export function getActionDescriptor(actionId: string): ControlledAction | undefined {
  return registry.get(actionId);
}

/**
 * Server-side intent matcher. Maps conversational requests to REGISTERED
 * action IDs ONLY. User/AI text can never name a function, module, or
 * arbitrary action — the output of this function is always validated
 * against the registry before any handler runs.
 *
 * Returns null when no intent matches (plain chat continues normally).
 */
export function detectActionRequest(text: string): string | null {
  const lower = text.toLowerCase();

  // Longest/most specific phrases first so e.g. "feed status" matches
  // market.feed_status and not market.status.
  const rules: Array<{ id: ActionId; patterns: string[] }> = [
    { id: "agent.status", patterns: ["agent status", "status agent", "how is the agent", "agent state"] },
    { id: "diagnostic.llm_probe", patterns: ["provider", "llm probe", "ai provider", "probe ai", "providers configured", "semua provider"] },
    { id: "market.feed_status", patterns: ["feed status", "market feed", "feed state", "status feed"] },
    { id: "journal.recent", patterns: ["journal", "recent activity", "logbook", "aktivitas terakhir"] },
    { id: "market.status", patterns: ["market status", "market data", "market state", "status market", "connection"] },
    // NOTE: no bare "loop" pattern — phrases like "start/stop the autonomous
    // loop" are lifecycle CONTROL requests and must never match an action.
    { id: "runtime.status", patterns: ["runtime", "tick", "uptime", "runtime loop"] },
    { id: "system.readiness", patterns: ["readiness", "system status", "status sistem", "kondisi sistem", "database status", "database ready", "db status", "system ready", "apakah sistem"] },
  ];

  // Explicit action-ID style requests ("action: market.status") are matched
  // exactly and must be a registered ID — anything else stays unmatched.
  const explicit = lower.match(/action[\s:]+([a-z._-]+)/);
  if (explicit?.[1] && registry.has(explicit[1])) {
    return explicit[1];
  }

  for (const rule of rules) {
    if (rule.patterns.some((p) => lower.includes(p))) {
      return rule.id;
    }
  }
  return null;
}

/**
 * Safety gate + executor. The actionId MUST match a registry entry exactly;
 * there is no dynamic resolution path from user text or AI output.
 *
 * Deny rules (in order):
 *   1. Malformed (non-string / empty) actionId → DENY
 *   2. Not in registry → DENY
 *   3. riskLevel TRADING or MONEY_MOVEMENT → DENY (D.2 hard block)
 *   4. Permission not explicitly granted to chat-agent → DENY
 *   5. CONTROLLED_MUTATION without confirmation → DENY (boundary prepared)
 */
export async function executeControlledAction(
  actionId: unknown,
  options: { confirmed?: boolean } = {},
): Promise<ActionExecutionResult> {
  const deny = (reason: string): ActionExecutionResult => {
    const decision: ActionDecision = {
      actionId: typeof actionId === "string" ? actionId : String(actionId),
      allowed: false,
      reason,
      timestamp: new Date().toISOString(),
      actor: "boss/chat-agent",
      resultStatus: "DENIED",
    };
    logger.warn("controlled-action", `DENIED action=${decision.actionId} reason=${reason}`);
    return { decision };
  };

  // 1. Malformed
  if (typeof actionId !== "string" || actionId.length === 0) {
    return deny("MALFORMED_ACTION_ID");
  }
  // 2. Unknown (allowlist match only)
  const action = registry.get(actionId);
  if (!action) {
    return deny("UNKNOWN_ACTION");
  }
  // 3. Trading / money movement — unconditional hard block in D.2
  if (action.riskLevel === "TRADING" || action.riskLevel === "MONEY_MOVEMENT") {
    return deny("TRADING_ACTIONS_DISABLED_IN_D2");
  }
  // 4. Permission check (default-deny)
  if (!CHAT_AGENT_PERMISSIONS.has(action.permission)) {
    return deny("PERMISSION_NOT_GRANTED");
  }
  // 5. Confirmation boundary for controlled mutations
  if (action.riskLevel === "CONTROLLED_MUTATION" && options.confirmed !== true) {
    return deny("CONFIRMATION_REQUIRED");
  }

  // Execute the bound handler
  try {
    const result = (await action.handler()) as SerializableActionValue;
    const decision: ActionDecision = {
      actionId: action.actionId,
      allowed: true,
      reason: "ALLOWED_BY_REGISTRY",
      timestamp: new Date().toISOString(),
      actor: "boss/chat-agent",
      resultStatus: "OK",
    };
    logger.info("controlled-action", `ALLOWED action=${action.actionId} riskLevel=${action.riskLevel}`);
    return { decision, result };
  } catch (err) {
    const decision: ActionDecision = {
      actionId: action.actionId,
      allowed: true,
      reason: "HANDLER_ERROR",
      timestamp: new Date().toISOString(),
      actor: "boss/chat-agent",
      resultStatus: "ERROR",
    };
    // Safe logging only — error category, never payloads or secrets.
    const code = (err as { code?: string })?.code ?? "HANDLER_ERROR";
    logger.error("controlled-action", `ERROR action=${action.actionId} category=${code}`);
    return { decision, result: { error: code } };
  }
}

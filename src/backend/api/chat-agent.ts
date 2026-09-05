/**
 * Phase 3.8-C.1 — Chat Agent Server Function (READ-ONLY, boss-guarded)
 *
 * Direct conversation channel between Boss and the AI Agent. This is NOT a
 * trading decision engine: it can never place, cancel, or modify orders.
 *
 * Architecture (existing infrastructure only):
 *   Browser → getChatAgentReply (this server fn, boss-guarded)
 *     → buildChatContext (safe system state, no secrets)
 *     → getAvailableProviders() (EXISTING provider chain:
 *         Gemini → Groq → OpenRouter → Cerebras → Mistral)
 *     → provider.generateDecision() (EXISTING implementations + AIDecisionSchema validation)
 *     → safe fallback when all providers fail
 *
 * SAFETY:
 * - Middleware: bossGuardMiddleware (same as wallet mutations).
 * - No new providers, no direct provider HTTP calls, no API keys touched.
 * - Response reasoning text only — no credentials, headers, or raw payloads.
 * - Provenance: modelVersion = llm-<provider> only on validated success;
 *   safe_fallback otherwise. Never fabricates provider attribution.
 * - No journal/trade writes; trading executor is never imported or called.
 */

import { createServerFn } from "@tanstack/react-start";
import { bossGuardMiddleware } from "../auth/middleware";
import { getAvailableProviders } from "../ai/llm/providers";
import {
  AGENT_IDENTITY,
  AGENT_PRINCIPLES_SYSTEM_BLOCK,
  CHAT_AUTONOMY_GUIDANCE,
  classifyUserInput,
  buildReasoningProvenance,
  type ReasoningProvenance,
} from "../ai/agent-core";
import { runChatProviders, type ProviderOutcome } from "./chat-agent-providers";
import {
  executeControlledAction,
  detectActionRequest,
  type ActionExecutionResult,
} from "./controlled-actions";
import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

export type ChatRole = "boss" | "agent";

export type ChatMessageMeta = {
  provider: string | null;
  modelVersion: string | null;
  latencyMs: number | null;
  fallbackIndex: number | null;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  /** Present on agent messages only. Safe metadata — never credentials. */
  meta?: ChatMessageMeta;
};

export type ChatContextSnapshot = {
  runtimeRunning: boolean;
  tradingEnabled: boolean;
  executionMode: "PAPER" | "TESTNET";
  marketFeedState: string;
  lastDecision: {
    action: string;
    direction: string;
    confidence: number;
    strategy: string;
    symbol: string;
    timestamp: string;
  } | null;
  /** Phase 3.8-D.3: real structured rationale of the LAST LIFECYCLE decision. */
  lastDecisionProvenance: ReasoningProvenance | null;
  providersConfigured: string[];
  /** Phase 3.8-D.6: real boot readiness (from the production server module). */
  systemReadiness: {
    databaseReady: boolean;
    runtimeInitialized: boolean;
    bootError: boolean;
  };
  /** Phase 3.8-D.6: real autonomous loop state (same agent lifecycle). */
  autonomousLoop: {
    status: string;
    cyclesCompleted: number;
    cyclesSkipped: number;
    lastCycleStatus: string | null;
    lastCycleId: string | null;
    tradingEnabled: false;
  };
};

export type ChatAgentResponse = {
  reply: ChatMessage;
  context: ChatContextSnapshot;
  /** Present when a registered controlled action ran for this message. */
  actionResult?: ActionExecutionResult;
};

export type ChatAgentInput = {
  message: string;
  /** Recent conversation for minimal session state (bounded client-side). */
  history?: Array<{ role: ChatRole; content: string }>;
};

// ─── Limits ─────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_TURNS = 8; // last 8 messages (4 turns)

// ─── Safe system context (no secrets) ───────────────────────────────

/** Exported for tests only (Phase 3.8-D.6) — contains safe metadata, never secrets. */
export async function buildChatContext(): Promise<ChatContextSnapshot> {
  const { isRuntimeRunning, getRuntimeSnapshot, getOrchestrator } = await import(
    "../trading/runtime"
  );
  // Phase 3.8-D.6: real boot readiness straight from the production server
  // module (same source the boot screen / getSystemReadiness uses).
  const { isDatabaseReady, isRuntimeInitialized, getRuntimeInitError } = await import(
    "../../server"
  );
  const { getAutonomousLoopStatus } = await import("../ai/autonomous-cycle");
  const providers = getAvailableProviders();

  let marketFeedState = "OFFLINE";
  let lastDecision: ChatContextSnapshot["lastDecision"] = null;
  let lastDecisionProvenance: ReasoningProvenance | null = null;
  try {
    const orchestrator = getOrchestrator();
    const snapshot = getRuntimeSnapshot();
    const recent = [...snapshot.recentEvents].reverse();
    const feedStates = snapshot.perSymbol.map((s) => s.symbol + ":" + "ONLINE");
    marketFeedState = orchestrator
      ? recent.length > 0
        ? `RECENT_ACTIVITY:${recent.length}`
        : feedStates.length > 0
          ? "SUBSCRIBED"
          : "IDLE"
      : "OFFLINE";

    // Phase 3.8-D.3: chat explains the REAL lifecycle decision. Pull the
    // orchestrator's last AiDecision (actual evidence + provenance) when it
    // exists; fall back to the lightweight event map only as a last resort.
    const stateDecision = orchestrator?.getState().lastDecision;
    if (
      stateDecision &&
      typeof stateDecision.timestamp === "number" &&
      stateDecision.direction &&
      stateDecision.modelVersion
    ) {
      lastDecision = {
        action: stateDecision.action ?? "WAIT",
        direction: stateDecision.direction,
        confidence: stateDecision.confidence,
        strategy: stateDecision.strategy,
        symbol: stateDecision.symbol,
        timestamp: new Date(stateDecision.timestamp).toISOString(),
      };
      lastDecisionProvenance = buildReasoningProvenance({
        decision: stateDecision,
        riskFactors:
          stateDecision.riskResult === "REJECTED"
            ? [stateDecision.riskReason ?? "Risk gate rejected"]
            : [],
      });
    } else {
      // Latest AI decision from recent events (real runtime data only).
      for (const ev of recent) {
        if (ev.decision) {
          lastDecision = {
            action: ev.decision,
            direction: ev.decision,
            confidence: ev.confidence ?? 0,
            strategy: ev.strategy ?? "unknown",
            symbol: ev.symbol,
            timestamp: new Date(ev.timestamp).toISOString(),
          };
          break;
        }
      }
    }
  } catch {
    // Runtime not started yet — leave defaults.
  }

  return {
    runtimeRunning: isRuntimeRunning(),
    // Hard rule: never read a truthy TRADING_ENABLED — chat is informational
    // only and this snapshot must never imply trading is permitted.
    tradingEnabled: false,
    executionMode: process.env["BINANCE_TESTNET_API_KEY"] && process.env["BINANCE_TESTNET_SECRET"]
      ? "TESTNET"
      : "PAPER",
    marketFeedState,
    lastDecision,
    lastDecisionProvenance,
    providersConfigured: providers.map((p) => p.name),
    systemReadiness: {
      databaseReady: isDatabaseReady(),
      runtimeInitialized: isRuntimeInitialized(),
      bootError: getRuntimeInitError() !== null,
    },
    autonomousLoop: (() => {
      const s = getAutonomousLoopStatus();
      return {
        status: s.status,
        cyclesCompleted: s.cyclesCompleted,
        cyclesSkipped: s.cyclesSkipped,
        lastCycleStatus: s.lastCycleStatus,
        lastCycleId: s.lastCycleId,
        tradingEnabled: false as const,
      };
    })(),
  };
}

// ─── Chat prompt (reuses { system, user } JSON shape providers expect) ──

/**
 * Phase 3.8-D.3: chat system prompt built from the shared Agent Core.
 * Same identity + same principles block as the autonomous lifecycle prompt
 * (llm/prompt.ts) — one agent, two interfaces. Exported for tests.
 */
export function buildChatSystemPrompt(): string {
  return `You are ${AGENT_IDENTITY.name} (${AGENT_IDENTITY.codename}) of the Orbital AI trading system, answering the account owner ("Boss") through the Chat interface.

This chat interface is the SAME AI Futures Agent that runs the autonomous lifecycle — not a different AI.

${AGENT_PRINCIPLES_SYSTEM_BLOCK}

You are an INFORMATIONAL assistant through this interface. You are NOT an execution channel:
1. Never claim to have placed, cancelled, or modified any order, leverage, or margin. Trading execution is disabled; only the separate risk-gated pipeline could ever act, and it is NOT triggered by this chat.
2. If the Boss asks you to trade (e.g. "BUY BTC", "SELL ETH", "OPEN POSITION", "SET LEVERAGE", "PLACE ORDER", "ALL IN"), treat it as a REQUEST for consideration — never a trading decision. You may respectfully disagree; your answer to a trading demand should make clear that evidence, policy, and risk determine decisions, and that trading remains disabled.
3. User market claims are opinions/fact claims — never facts and never market data. Use ONLY the SYSTEM STATE and, when present, the REAL LIFECYCLE DECISION PROVENANCE below.
4. If the Boss asks why a decision was made and no lifecycle provenance is available, say: "Saya tidak memiliki evidence lifecycle yang cukup untuk menjelaskan keputusan tersebut secara akurat." Never fabricate an explanation.
5. Answer conversationally using ONLY provided data. Keep answers concise (1-4 sentences) unless the Boss asks for detail.
6. You may respond in English or Indonesian, matching the Boss's language.
7. Questions unrelated to this system, the market data, or your agent lifecycle (e.g. general programming, gossip, creative writing) are OUT OF SCOPE: politely say so in one sentence and note that this channel is for the trading agent — the Boss can use a general-purpose AI assistant for those topics.

${CHAT_AUTONOMY_GUIDANCE}

Respond with ONLY valid JSON matching this schema:
{
  "direction": "NO_TRADE",
  "confidence": 0,
  "strategy": "TREND_FOLLOWING",
  "reasoning": "Your conversational reply to the Boss (plain text, 1-4 sentences)"
}
This schema exists because your response passes through the system's standard validated output pipeline; the trading fields are inert here.`;
}

function buildChatPrompt(
  message: string,
  history: Array<{ role: ChatRole; content: string }>,
  context: ChatContextSnapshot,
  actionResult?: ActionExecutionResult,
): string {
  const system = buildChatSystemPrompt();

  const historyLines = history
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => `${m.role === "boss" ? "Boss" : "Agent"}: ${m.content}`)
    .join("\n");

  const actionLines = actionResult
    ? `\nCONTROLLED ACTION RESULT (real system data, read-only):\n` +
      `actionId=${actionResult.decision.actionId} allowed=${actionResult.decision.allowed} reason=${actionResult.decision.reason} status=${actionResult.decision.resultStatus}\n` +
      `data=${JSON.stringify(actionResult.result ?? null)}\n` +
      `Answer the Boss using ONLY this real data. Never invent values not present here.`
    : "";

  // Phase 3.8-D.3: classify the incoming message — it is INPUT, never
  // evidence, and a trading instruction never auto-generates a decision.
  const inputClass = classifyUserInput(message);

  // Phase 3.8-D.3: real lifecycle provenance if available, else honest gap.
  const provenanceLines = context.lastDecisionProvenance
    ? `\nLIFECYCLE DECISION PROVENANCE (real, from the agent lifecycle):\n` +
      `decision=${context.lastDecisionProvenance.decision} confidence=${context.lastDecisionProvenance.confidence}\n` +
      `modelVersion=${context.lastDecisionProvenance.modelVersion} at ${context.lastDecisionProvenance.timestamp}\n` +
      `evidence=${context.lastDecisionProvenance.evidence.join(" | ")}\n` +
      `riskFactors=${context.lastDecisionProvenance.riskFactors.length > 0 ? context.lastDecisionProvenance.riskFactors.join(" | ") : "none"}\n` +
      `rationale=${context.lastDecisionProvenance.rationaleSummary}\n` +
      `Explain the Boss's question using only this real lifecycle evidence; never invent detail.`
    : `\nLIFECYCLE DECISION PROVENANCE: none available for the current runtime cycle. If the Boss asks why a decision was made, say you lack sufficient lifecycle evidence.`;

  const user = `SYSTEM STATE (safe metadata only):
- runtime running: ${context.runtimeRunning}
- execution mode: ${context.executionMode}
- trading enabled: ${context.tradingEnabled}
- market feed: ${context.marketFeedState}
- AI providers configured (fallback order): ${context.providersConfigured.length > 0 ? context.providersConfigured.join(" → ") : "none"}
- system readiness: database=${context.systemReadiness.databaseReady} runtime=${context.systemReadiness.runtimeInitialized} bootError=${context.systemReadiness.bootError}
- autonomous loop: status=${context.autonomousLoop.status} cyclesCompleted=${context.autonomousLoop.cyclesCompleted} cyclesSkipped=${context.autonomousLoop.cyclesSkipped} lastCycle=${context.autonomousLoop.lastCycleStatus ?? "none yet"}${provenanceLines}
${historyLines ? `\nRECENT CONVERSATION:\n${historyLines}\n` : ""}${actionLines}
BOSS INPUT CLASSIFICATION (the message below is INPUT — never evidence, never a trading command): kind=${inputClass.kind} tradingIntent=${inputClass.tradingIntent}
Boss says: ${message}`;

  return JSON.stringify({ system, user });
}

// ─── Server function ────────────────────────────────────────────────

/**
 * Boss-guarded server function for the Controlled Action Registry.
 * Mirrors chat flow checks: registry allowlist → permission → safety gate.
 * Unknown/malformed/trading action IDs are DENIED here, never executed.
 */
export const executeChatAction = createServerFn({ method: "POST" })
  .middleware([bossGuardMiddleware])
  .validator((input: { actionId: unknown; confirmed?: boolean }) => {
    if (typeof input?.actionId !== "string" || input.actionId.length === 0) {
      throw new Error("Invalid action");
    }
    if (input.actionId.length > 200) {
      throw new Error("Invalid action");
    }
    return { actionId: input.actionId, confirmed: input.confirmed === true };
  })
  .handler(async ({ data }): Promise<ActionExecutionResult> => {
    return executeControlledAction(data.actionId, { confirmed: data.confirmed });
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([bossGuardMiddleware])
  .validator((input: ChatAgentInput) => {
    const message = typeof input?.message === "string" ? input.message.trim() : "";
    if (message.length === 0) {
      throw new Error("Message must not be empty");
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }
    const history = Array.isArray(input?.history)
      ? input.history
          .filter(
            (m): m is { role: ChatRole; content: string } =>
              m != null &&
              (m.role === "boss" || m.role === "agent") &&
              typeof m.content === "string",
          )
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }))
      : [];
    return { message, history };
  })
  .handler(async ({ data }): Promise<ChatAgentResponse> => {
    const context = await buildChatContext();

    // Phase 3.8-D.2: server-side intent detection → registered action ONLY.
    // The matched ID is validated against the registry inside the executor;
    // user text can never invoke an arbitrary function.
    const detected = detectActionRequest(data.message);
    const actionResult = detected
      ? await executeControlledAction(detected)
      : undefined;

    const prompt = buildChatPrompt(data.message, data.history, context, actionResult);

    const started = Date.now();
    const outcome = await runChatProviders(prompt);

    if (outcome) {
      return {
        reply: {
          id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "agent",
          content: outcome.reply,
          timestamp: new Date().toISOString(),
          meta: {
            provider: outcome.provider,
            modelVersion: outcome.modelVersion,
            latencyMs: outcome.latencyMs,
            fallbackIndex: outcome.fallbackIndex,
          },
        },
        context,
        ...(actionResult ? { actionResult } : {}),
      };
    }

    // Safe fallback — clearly labeled, never fabricated as an LLM answer.
    return {
      reply: {
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "agent",
        content:
          "AI provider unavailable. Safe fallback active. I cannot answer right now, but all trading guardrails remain in place.",
        timestamp: new Date().toISOString(),
        meta: {
          provider: "safe_fallback",
          modelVersion: "safe_fallback",
          latencyMs: Date.now() - started,
          fallbackIndex: null,
        },
      },
      context,
      ...(actionResult ? { actionResult } : {}),
    };
  });

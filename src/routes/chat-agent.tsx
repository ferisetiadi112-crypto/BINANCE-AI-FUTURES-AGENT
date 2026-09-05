import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, SendHorizonal, Bot, User } from "lucide-react";
import { PageHeader, Panel, Tag } from "@/components/space/Panel";
import { sendAgentChat } from "@/api/client";

export const Route = createFileRoute("/chat-agent")({
  head: () => ({
    meta: [
      { title: "Chat Agent — Orbital AI Command Center" },
      {
        name: "description",
        content: "Direct communication with the AI Futures Agent. Read-only, boss-guarded.",
      },
    ],
  }),
  component: ChatAgent,
});

type ChatMsg = {
  id: string;
  role: "boss" | "agent";
  content: string;
  timestamp: string;
  meta?: {
    provider: string | null;
    modelVersion: string | null;
    latencyMs: number | null;
    fallbackIndex: number | null;
  };
  /** Phase 3.8-D.2: registry decision shown when a controlled action ran. */
  action?: { actionId: string; allowed: boolean; reason: string } | null;
};

const SUGGESTED_PROMPTS = [
  "Bagaimana kondisi agent saat ini?",
  "Apa status market feed?",
  "Jelaskan keputusan terakhir Agent.",
  "Apakah semua provider AI tersedia?",
  "Bagaimana kondisi risk engine?",
];

function metaLabel(meta: ChatMsg["meta"]): string | null {
  if (!meta) return null;
  if (meta.modelVersion === "safe_fallback") return "AI · SAFE FALLBACK";
  const name = meta.provider ? meta.provider.charAt(0).toUpperCase() + meta.provider.slice(1) : "AI";
  const fb = meta.fallbackIndex != null && meta.fallbackIndex > 0 ? `fallback #${meta.fallbackIndex} · ` : "";
  const ms = meta.latencyMs != null ? `${meta.latencyMs}ms` : "";
  return `AI · ${name}${ms ? ` · ${fb}${ms}` : ""}`;
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function ChatAgent() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    setError(null);
    const bossMsg: ChatMsg = {
      id: `boss-${Date.now()}`,
      role: "boss",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, bossMsg]);
    setInput("");
    setThinking(true);

    try {
      const res = await sendAgentChat(trimmed, history);
      setMessages((prev) => [
        ...prev,
        {
          ...res.reply,
          action: res.actionResult
            ? {
                actionId: res.actionResult.decision.actionId,
                allowed: res.actionResult.decision.allowed,
                reason: res.actionResult.decision.reason,
              }
            : null,
        },
      ]);
    } catch {
      // Safe error surface — never raw API errors, keys, or stack traces.
      setError("AI provider unavailable. Safe fallback active.");
    } finally {
      setThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col">
      <PageHeader
        eyebrow="Control · Chat Agent"
        title="Chat Agent"
        desc="Direct communication with AI Futures Agent — informational only, never an execution channel."
        right={<Tag tone="cyan">READ ONLY</Tag>}
      />

      <Panel
        title="Conversation"
        code="BOSS ONLY"
        glow
        className="flex min-h-[34rem] flex-col"
        bodyClassName="flex flex-1 flex-col p-0"
      >
        {/* Chat area */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !thinking ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-primary/40 bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div className="font-display text-lg font-semibold text-foreground">CHAT AGENT</div>
              <p className="max-w-sm font-mono text-xs text-muted-foreground">
                Talk directly with your AI Futures Agent.
              </p>
              <div className="mt-2 flex max-w-md flex-wrap justify-center gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => void send(p)}
                    className="rounded-sm border border-hairline bg-background/50 px-2.5 py-1.5 font-mono text-[0.68rem] text-foreground/75 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isBoss = m.role === "boss";
              const label = isBoss ? "BOSS" : "AI AGENT";
              return (
                <div key={m.id} className={`flex ${isBoss ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-md border px-3 py-2 sm:max-w-[70%] ${
                      isBoss
                        ? "border-primary/30 bg-primary/10"
                        : "border-hairline bg-surface-2/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {isBoss ? (
                        <User className="h-3 w-3 text-primary" />
                      ) : (
                        <Bot className="h-3 w-3 text-cyan-signal" />
                      )}
                      <span
                        className={`font-mono text-[0.6rem] uppercase tracking-[0.14em] ${
                          isBoss ? "text-primary" : "text-cyan-signal"
                        }`}
                      >
                        {label}
                      </span>
                      <span className="font-mono text-[0.6rem] text-muted-foreground">
                        {timeLabel(m.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-[0.78rem] leading-relaxed text-foreground/90">
                      {m.content}
                    </p>
                    {!isBoss && metaLabel(m.meta) && (
                      <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">
                        {metaLabel(m.meta)}
                      </div>
                    )}
                    {!isBoss && m.action && (
                      <div
                        className={`mt-1 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[0.58rem] ${
                          m.action.allowed
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-loss/40 bg-loss/10 text-loss"
                        }`}
                      >
                        <span className="uppercase tracking-[0.1em]">
                          action · {m.action.actionId} · {m.action.allowed ? "ALLOWED" : "DENIED"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {thinking && (
            <div className="flex justify-start">
              <div className="rounded-md border border-hairline bg-surface-2/60 px-3 py-2">
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-cyan-signal">
                  AI AGENT
                </div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground">
                  THINKING
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse [animation-delay:150ms]">●</span>
                  <span className="animate-pulse [animation-delay:300ms]">●</span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-2 rounded border border-loss/30 bg-loss/5 px-3 py-2 font-mono text-[0.7rem] text-loss">
            {error}
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-hairline p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tulis pesan kepada Agent..."
              rows={2}
              maxLength={2000}
              disabled={thinking}
              className="flex-1 resize-none rounded border border-hairline bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void send(input)}
              disabled={thinking || !input.trim()}
              className="flex items-center gap-1.5 rounded bg-primary/20 px-4 py-2 font-mono text-xs font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
            >
              <SendHorizonal className="h-3.5 w-3.5" />
              SEND
            </button>
          </div>
          <div className="mt-1.5 font-mono text-[0.6rem] text-muted-foreground">
            Enter to send · Shift+Enter for newline · Chat is informational only — it cannot place orders.
          </div>
        </div>
      </Panel>
    </div>
  );
}

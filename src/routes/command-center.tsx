import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Shield,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Lock,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import {
  fetchWalletStatus,
  fetchAuditTrail,
  walletTopUp,
  walletWithdraw,
  fetchTestnetStatus,
} from "@/api/client";

export const Route = createFileRoute("/command-center")({
  head: () => ({
    meta: [
      { title: "Command Center — Orbital AI Command Center" },
      {
        name: "description",
        content:
          "Sandbox wallet management, audit trail, and guardrail activity for the AI trading agent.",
      },
      {
        property: "og:title",
        content: "Command Center — Orbital AI Command Center",
      },
    ],
  }),
  component: CommandCenter,
});

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const severityIcon = (severity: string) => {
  switch (severity) {
    case "CRITICAL":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "ERROR":
      return <AlertTriangle className="h-4 w-4 text-loss" />;
    case "WARN":
      return <AlertTriangle className="h-4 w-4 text-amber-signal" />;
    default:
      return <Info className="h-4 w-4 text-primary/70" />;
  }
};

const eventTypeLabel = (type: string) => {
  switch (type) {
    case "TRADE_ALLOWED":
      return <Tag tone="gain">ALLOWED</Tag>;
    case "TRADE_BLOCKED":
      return <Tag tone="loss">BLOCKED</Tag>;
    case "INSUFFICIENT_FUNDS":
      return <Tag tone="loss">NO FUNDS</Tag>;
    case "DAILY_LIMIT_REACHED":
      return <Tag tone="warn">LIMIT</Tag>;
    case "MARKET_UNSTABLE":
      return <Tag tone="warn">UNSTABLE</Tag>;
    case "WALLET_MODIFIED":
      return <Tag tone="default">WALLET</Tag>;
    case "BALANCE_CHECK":
      return <Tag tone="default">CHECK</Tag>;
    default:
      return <Tag tone="default">{type}</Tag>;
  }
};

function CommandCenter() {
  const queryClient = useQueryClient();

  const { data: walletResponse, isLoading: walletLoading } = useQuery({
    queryKey: ["wallet-status"],
    queryFn: fetchWalletStatus,
    refetchInterval: 5000,
  });

  const { data: auditResponse, isLoading: auditLoading } = useQuery({
    queryKey: ["audit-trail"],
    queryFn: fetchAuditTrail,
    refetchInterval: 3000,
  });

  const topUpMutation = useMutation({
    mutationFn: ({ amount, note }: { amount: number; note: string }) =>
      walletTopUp(amount, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["audit-trail"] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: ({ amount, note }: { amount: number; note: string }) =>
      walletWithdraw(amount, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["audit-trail"] });
    },
  });

  const { data: testnetResponse } = useQuery({
    queryKey: ["testnet-status"],
    queryFn: fetchTestnetStatus,
    refetchInterval: 10_000,
  });

  const wallet = walletResponse?.data;
  const auditEvents = auditResponse?.data?.events || [];
  const testnet = testnetResponse?.data;

  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpNote, setTopUpNote] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");

  const handleTopUp = () => {
    const amt = parseFloat(topUpAmount);
    if (isNaN(amt) || amt <= 0) return;
    topUpMutation.mutate({ amount: amt, note: topUpNote || "Boss top-up" });
    setTopUpAmount("");
    setTopUpNote("");
  };

  const handleWithdraw = () => {
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0) return;
    withdrawMutation.mutate({
      amount: amt,
      note: withdrawNote || "Boss withdrawal",
    });
    setWithdrawAmount("");
    setWithdrawNote("");
  };

  // P7D-4.4: No full-page loading blocker

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="System · Command Center"
        title="Command Center"
        desc="Sandbox wallet management, guardrail activity, and audit trail. The AI agent has zero permission to modify wallet balances."
      />

      {(walletLoading || auditLoading) && !walletResponse && !auditResponse && (
        <div className="flex items-center gap-3 rounded-sm border border-primary/20 bg-primary/5 px-4 py-3 mb-3">
          <div className="pulse-dot h-3 w-3 rounded-full bg-primary" />
          <span className="font-mono text-xs text-muted-foreground">Initializing command center...</span>
        </div>
      )}
      {/* ─── Wallet Stats ──────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-4">
        <Stat
          label="Wallet Balance"
          value={wallet ? money(wallet.balance) : "$0.00"}
          sub={`Initial: ${wallet ? money(wallet.initialCapital) : "$5.00"}`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <Stat
          label="Total Top-Up"
          value={wallet ? money(wallet.totalTopUp) : "$0.00"}
          sub={`${wallet?.transactionCount ?? 0} transactions`}
          tone="gain"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <Stat
          label="Total Withdrawn"
          value={wallet ? money(wallet.totalWithdraw) : "$0.00"}
          sub={`Net: ${wallet ? money(wallet.netChange) : "$0.00"}`}
          tone="loss"
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <Stat
          label="AI Protection"
          value="ACTIVE"
          sub="AI cannot modify balance"
          tone="gain"
          icon={<Shield className="h-4 w-4" />}
        />
      </div>

      {/* ─── Testnet Status ──────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        <Stat
          label="Testnet"
          value={testnet?.configured ? (testnet?.connected ? "LIVE" : "OFFLINE") : "NOT CONFIGURED"}
          sub={testnet?.paperTrading ? "Paper mode — no real orders" : "Live testnet orders active"}
          tone={testnet?.connected ? "gain" : "warn"}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <Stat
          label="Testnet Balance"
          value={testnet?.balance ? money(testnet.balance) : "$0.00"}
          sub={`${testnet?.positions?.length ?? 0} open position(s)`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <Stat
          label="Unrealized PnL"
          value={testnet?.positions?.length ? money(testnet.positions.reduce((a: number, p: any) => a + p.unrealizedPnl, 0)) : "$0.00"}
          sub="From open positions"
          tone={testnet?.positions?.some((p: any) => p.unrealizedPnl < 0) ? "loss" : "gain"}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <Stat
          label="Realized PnL"
          value={(() => {
            // P7D-3-FIX-REALIZED-PNL-2: Three distinct states
            // SUCCESS + value=0  → "0.00 USDT" (real zero from Binance)
            // SUCCESS + value>0  → "+X.XX USDT" (profit)
            // SUCCESS + value<0  → "-X.XX USDT" (loss)
            // ERROR              → "Data unavailable" (Binance request failed)
            // UNAVAILABLE        → "Waiting for Binance data" (not connected)
            if (testnet?.realizedPnlStatus === "SUCCESS") {
              return money(testnet.realizedPnl ?? 0);
            }
            if (testnet?.realizedPnlStatus === "ERROR") {
              return "Data unavailable";
            }
            return "Waiting for Binance data";
          })()}
          sub={(() => {
            // P7D-3-FIX-REALIZED-PNL-2: Source label for each state
            if (testnet?.realizedPnlStatus === "SUCCESS") {
              return "Source: Binance Futures Testnet";
            }
            if (testnet?.realizedPnlStatus === "ERROR") {
              return "Binance request failed";
            }
            return "Waiting for Binance data";
          })()}
          tone={(() => {
            // P7D-3-FIX-REALIZED-PNL-2: Tone only valid when status=SUCCESS
            if (testnet?.realizedPnlStatus === "SUCCESS") {
              if ((testnet.realizedPnl ?? 0) > 0) return "gain";
              if ((testnet.realizedPnl ?? 0) < 0) return "loss";
              return "default";
            }
            return "default";
          })()}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ─── Wallet Controls (Boss-Only) ──────────────────── */}
        <Panel
          title="Sandbox Wallet — Boss Controls"
          code="BOSS ONLY"
          glow
        >
          <div className="space-y-4">
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono text-xs text-primary">
                  AI agent has ZERO permission to modify this balance.
                  Only the Boss (you) can top up or withdraw.
                </span>
              </div>
            </div>

            {/* Top-Up */}
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-foreground/70">
                <ArrowUpRight className="h-3.5 w-3.5 text-gain" />
                Top-Up
              </h3>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount (USDT)"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="flex-1 rounded border border-hairline bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                  min="0"
                  step="0.50"
                />
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={topUpNote}
                  onChange={(e) => setTopUpNote(e.target.value)}
                  className="flex-1 rounded border border-hairline bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                />
                <button
                  onClick={handleTopUp}
                  disabled={
                    topUpMutation.isPending || !topUpAmount || parseFloat(topUpAmount) <= 0
                  }
                  className="rounded bg-gain/20 px-4 py-1.5 font-mono text-xs font-medium text-gain hover:bg-gain/30 disabled:opacity-50"
                >
                  {topUpMutation.isPending ? "..." : "Top Up"}
                </button>
              </div>
            </div>

            {/* Withdraw */}
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-foreground/70">
                <ArrowDownRight className="h-3.5 w-3.5 text-loss" />
                Withdraw
              </h3>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount (USDT)"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="flex-1 rounded border border-hairline bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                  min="0"
                  step="0.50"
                />
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={withdrawNote}
                  onChange={(e) => setWithdrawNote(e.target.value)}
                  className="flex-1 rounded border border-hairline bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                />
                <button
                  onClick={handleWithdraw}
                  disabled={
                    withdrawMutation.isPending || !withdrawAmount || parseFloat(withdrawAmount) <= 0
                  }
                  className="rounded bg-loss/20 px-4 py-1.5 font-mono text-xs font-medium text-loss hover:bg-loss/30 disabled:opacity-50"
                >
                  {withdrawMutation.isPending ? "..." : "Withdraw"}
                </button>
              </div>
            </div>

            {(topUpMutation.isError || withdrawMutation.isError) && (
              <div className="rounded-md border border-loss/30 bg-loss/5 p-2 font-mono text-xs text-loss">
                {(topUpMutation.error as Error)?.message ||
                  (withdrawMutation.error as Error)?.message}
              </div>
            )}
          </div>
        </Panel>

        {/* ─── Risk Guardrails Summary ──────────────────────── */}
        <Panel title="Guardrail Configuration" code="PHASE 9D">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-hairline p-3">
                <div className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Initial Capital
                </div>
                <div className="mt-1 font-mono text-lg font-semibold text-foreground">
                  $5.00
                </div>
              </div>
              <div className="rounded border border-hairline p-3">
                <div className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Daily Profit Cap
                </div>
                <div className="mt-1 font-mono text-lg font-semibold text-gain">
                  +$0.50
                </div>
              </div>
              <div className="rounded border border-hairline p-3">
                <div className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Daily Loss Limit
                </div>
                <div className="mt-1 font-mono text-lg font-semibold text-loss">
                  -$0.50
                </div>
              </div>
              <div className="rounded border border-hairline p-3">
                <div className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Min Wallet Balance
                </div>
                <div className="mt-1 font-mono text-lg font-semibold text-amber-signal">
                  $0.50
                </div>
              </div>
            </div>

            <div className="rounded-md border border-hairline bg-background/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono text-xs font-medium text-foreground/80">
                  Guardrail Checks (per trade)
                </span>
              </div>
              <ul className="space-y-1 font-mono text-[0.7rem] text-muted-foreground">
                <li>• Daily loss limit (-$0.50)</li>
                <li>• Daily profit cap (+$0.50)</li>
                <li>• Decision freshness (&lt;5 min)</li>
                <li>• Data quality validation</li>
                <li>• Market regime safety</li>
                <li>• Position limit (max 3)</li>
                <li>• Duplicate decision detection</li>
                <li>• Confidence threshold (40%)</li>
                <li className="font-medium text-primary">
                  • Wallet balance minimum ($0.50)
                </li>
              </ul>
            </div>
          </div>
        </Panel>
      </div>

      {/* ─── Audit Trail & Activity Log ─────────────────────────── */}
      <div className="mt-4">
        <Panel title="Audit Trail & Activity Log" code="PHASE 9D">
          {auditEvents.length === 0 ? (
            <div className="py-8 text-center font-mono text-sm text-muted-foreground">
              No activity yet. Guardrail events and wallet transactions will
              appear here.
            </div>
          ) : (
            <div className="max-h-[32rem] space-y-2 overflow-y-auto">
              {auditEvents.map(
                (
                  event: {
                    id: number;
                    event_type: string;
                    severity: string;
                    message: string;
                    details: string;
                    balance_snapshot: number | null;
                    created_at: string;
                    source: string;
                  },
                  idx: number,
                ) => (
                  <div
                    key={`${event.source}-${event.id}-${idx}`}
                    className="flex items-start gap-3 rounded border border-hairline bg-background/30 p-3 transition-colors hover:bg-background/50"
                  >
                    <div className="mt-0.5 shrink-0">
                      {severityIcon(event.severity)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {eventTypeLabel(event.event_type)}
                        {event.source === "wallet" && (
                          <Tag tone="default">WALLET</Tag>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-xs text-foreground/80">
                        {event.message}
                      </p>
                      <div className="mt-1 flex items-center gap-3 font-mono text-[0.65rem] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                        {event.balance_snapshot !== null && (
                          <span>
                            Balance: {money(event.balance_snapshot)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

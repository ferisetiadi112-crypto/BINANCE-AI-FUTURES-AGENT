# Windows Persistent Runtime (Phase 3.8-A — Foundation)

A long-lived Node.js process that hosts the **existing** trading runtime
lifecycle (`startTradingRuntime → tick → orchestrator → feed → decision →
risk → executor`), independent of Vercel serverless lifecycle.

## Status separation (never inferred)

| Concept | Source | Meaning |
|---|---|---|
| Process status | heartbeat `status` | STARTING / RUNNING / STOPPING / STOPPED |
| Runtime status | `runtimeLoopAlive` | hosted tick loop ticked within 3×15s |
| Market data status | existing feed state | ONLINE / CONNECTING / STALE / OFFLINE (unchanged) |
| AI decision status | existing agent-status | real decisions only, never fabricated |
| Trading status | `tradingEnabled` | **always false in Phase 3.8-A** |

## Safety gate

The worker **refuses to start** when `TRADING_ENABLED=true` (throws at
startup). Phase 3.8-A proves persistence only — no order capability is added.

## Run on Windows

```powershell
# from the project root
npm run runtime:windows
```

Stop with Ctrl+C (SIGINT) or send SIGTERM — shutdown stops the scheduler,
tick loop, reconciliation timer, and feed (via existing `stopTradingRuntime`),
then exits with code 0.

## Configuration (no secrets committed)

| Env var | Default | Purpose |
|---|---|---|
| `RUNTIME_MODE` | `TESTNET` | `TESTNET` or `PAPER` |
| `TRADING_ENABLED` | unset/false | must stay false in this phase (gate) |
| `RUNTIME_HEARTBEAT_INTERVAL_MS` | `15000` | heartbeat period (min 1000) |

Existing `BINANCE_TESTNET_*` / `DATABASE_URL` envs continue to be read by the
existing backend modules only — never logged by the worker.

## Future (not in this phase)

- Windows Service registration (optional wrapper; no NSSM dependency added).
- Heartbeat reporting to Vercel (interface is the heartbeat JSON; production
  sync deliberately not enabled yet).
- Trading enablement behind the existing env gate + risk engine.

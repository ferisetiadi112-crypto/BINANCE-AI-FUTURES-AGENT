---
name: binance-agent-health-check
description: Verify that the Binance AI Futures Agent is genuinely connected to Binance Testnet in real time, receiving live account/market data, executing through the real Testnet path, and recording AI activity and memory correctly. Use this skill whenever validating system readiness, connectivity, runtime health, AI operation, or memory persistence.
---

# Binance Agent Health Check

This skill verifies that the Binance AI Futures Agent is actually functioning end-to-end.

The dashboard must never report a system as READY merely because configuration values exist.

## 1. Binance Testnet Connectivity

Verify the actual connection to Binance Testnet.

Required checks:

- Binance Testnet endpoint is reachable.
- API authentication succeeds.
- API key is valid.
- Account information can be retrieved.
- Server time can be retrieved.
- Market data can be retrieved.
- Futures account data can be retrieved when Futures Testnet is configured.
- The response must come from the live Testnet API request, not a simulated wallet.

Record:

- connection status
- environment
- last successful API request
- latency
- server timestamp
- local timestamp
- error if unavailable

### Connection States

Use explicit states:

- `CONNECTED`
- `DEGRADED`
- `DISCONNECTED`
- `NOT_CONFIGURED`
- `AUTH_FAILED`

Never convert an unknown state into CONNECTED.

## 2. Real-Time Testnet Verification

The system must periodically verify that Binance Testnet is still reachable.

A previous successful connection does not prove that the current connection is alive.

Every health check should verify current API communication.

The dashboard should show:

- Binance Testnet: LIVE / OFFLINE
- Last successful check
- API latency
- Last account synchronization
- Last market synchronization

If the last successful response is stale, the system must not display LIVE.

## 3. Account Balance Verification

Account balances must come from the actual Binance Testnet account.

Never fabricate:

- Spot balance
- Futures balance
- Margin balance
- Available balance
- Wallet balance
- Allocation

If Binance returns no balance:

display:

`—`

or:

`UNAVAILABLE`

Do not display `0` unless Binance actually reports zero.

## 4. Wallet Separation Verification

Binance wallets must be treated as separate sources.

At minimum distinguish:

- Spot
- Futures USDⓈ-M
- Futures COIN-M
- Margin
- Funding
- other supported wallet types

The agent must never assume that total Binance assets are available for Futures trading.

Spot balance must not automatically become Futures balance.

The system must never automatically transfer funds from Spot to Futures.

## 5. Effective Allocation Verification

For Futures trading:

effectiveAllocation = min(actualAvailableFuturesBalance, configuredMaximumAllocation)

Default maximum:

`10 USDT`

Examples:

Futures = 0 USDT
→ allocation = 0 USDT
→ trading blocked

Futures = 3 USDT
→ allocation = 3 USDT

Futures = 8 USDT
→ allocation = 8 USDT

Futures = 10 USDT
→ allocation = 10 USDT

Futures = 25 USDT
→ allocation = 10 USDT

Spot = 100 USDT and Futures = 0 USDT
→ allocation = 0 USDT

The system must never add Spot balance to Futures allocation.

## 6. Margin Mode Verification

Before any Futures execution:

- Query the actual Binance Futures position/order configuration.
- Verify margin mode.
- Only `ISOLATED` is permitted.
- `CROSS` must always be rejected.

If Cross Margin is detected:

`TRADING BLOCKED`

Do not automatically change Cross to Isolated unless a separately authorized mechanism explicitly permits that operation.

Never execute a trade while margin mode is unknown.

## 7. AI Runtime Verification

Verify that the AI agent is actually running.

A configured LLM provider is not proof that AI is functioning.

Verify:

- AI runtime is initialized.
- AI can receive an input.
- AI can produce a valid structured decision.
- Decision passes schema validation.
- Decision reaches the risk engine.
- Risk engine evaluates the decision.
- Execution layer receives the approved decision.

The health system should distinguish:

`AI_CONFIGURED`

from:

`AI_OPERATIONAL`

Only the latter means the AI has actually completed a successful runtime cycle.

## 8. Memory Verification

Verify that memory is actually functioning.

For every meaningful AI cycle:

1. Create an event.
2. Persist the event.
3. Retrieve the event.
4. Verify that the retrieved event matches the original event.

Test:

`WRITE → PERSIST → READ → VERIFY`

Memory must not be considered operational merely because the memory module is installed.

Track:

- memory write status
- memory read status
- persistence status
- last memory event
- memory timestamp
- memory identifier

If write succeeds but read fails:

`MEMORY_DEGRADED`

If memory cannot persist:

`MEMORY_OFFLINE`

## 9. Journal Verification

Every important system state must be journaled.

Examples:

- TESTNET_CONNECTED
- TESTNET_DISCONNECTED
- ACCOUNT_SYNCED
- BALANCE_UPDATED
- ALLOCATION_RECALCULATED
- MARGIN_MODE_VERIFIED
- CROSS_MARGIN_BLOCKED
- AI_STARTED
- AI_DECISION_CREATED
- AI_DECISION_REJECTED
- AI_DECISION_APPROVED
- MEMORY_WRITE
- MEMORY_READ
- TRADE_EXECUTED
- TRADE_REJECTED
- SAFETY_BLOCK

Journal entries must contain timestamp and relevant identifiers.

## 10. End-to-End Health Test

A complete health test should verify:

BINANCE TESTNET
↓
API CONNECTION
↓
ACCOUNT DATA
↓
FUTURES BALANCE
↓
EFFECTIVE ALLOCATION
↓
MARGIN MODE
↓
AI RUNTIME
↓
AI DECISION
↓
RISK ENGINE
↓
EXECUTION GATE
↓
JOURNAL
↓
MEMORY
↓
DASHBOARD

A failure at any critical stage must prevent the system from reporting:

`SYSTEM READY`

## 11. Dashboard Status

Use independent health indicators.

Example:

Binance Testnet     🟢 CONNECTED
Account Sync         🟢 LIVE
Futures Balance      🟢 VERIFIED
Allocation           🟢 $10.00
Margin Mode          🟢 ISOLATED
AI Runtime           🟢 OPERATIONAL
Memory               🟢 OPERATIONAL
Journal              🟢 OPERATIONAL
Trading              🟢 ARMED

If Futures balance is zero:

Futures Balance      🟢 VERIFIED — 0.00 USDT
Allocation           ⚪ 0.00 USDT
Trading              🔴 BLOCKED — NO FUTURES FUNDS

If Binance cannot be reached:

Binance Testnet     🔴 DISCONNECTED
Account Sync         🔴 UNAVAILABLE
Futures Balance      —
Allocation           —
Trading              🔴 BLOCKED

## 12. Fail-Closed Principle

When critical information cannot be verified:

DO NOT GUESS.

DO NOT FALL BACK TO:

- simulated wallet
- mock balance
- cached balance
- configured balance
- Spot balance
- arbitrary default balance

The system must fail closed.

Unknown balance = no trading.

Unknown margin mode = no trading.

Unknown Binance connection = no trading.

Unknown AI state = no trading.

Unknown memory state does not necessarily block analysis, but must prevent the system from claiming that memory is operational.

## 13. Health Status Must Be Evidence-Based

Never report:

`LIVE`

because configuration exists.

Never report:

`CONNECTED`

because the API key exists.

Never report:

`AI ACTIVE`

because the model is configured.

Never report:

`MEMORY ACTIVE`

because the memory service is installed.

Every status must be supported by a recent successful operation.

## Success Criteria

The system is considered fully operational only when:

1. Binance Testnet API responds successfully.
2. Account data is retrieved successfully.
3. Futures balance is retrieved from Binance.
4. Effective allocation is calculated from actual Futures balance.
5. Margin mode is verified as ISOLATED.
6. AI successfully completes a runtime cycle.
7. AI decision reaches the risk engine.
8. Memory successfully writes and reads an event.
9. Journal successfully records the cycle.
10. Dashboard reflects the actual current state.

If any critical requirement fails:

`SYSTEM NOT READY`
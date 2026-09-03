---
name: binance-testnet-safety
description: Mandatory safety and architecture rules for the Binance AI Futures Agent. Use before modifying trading, exchange, risk, wallet, allocation, margin, execution, dashboard, or testnet integration code.
---

# Binance Testnet Safety

## 1. Environment Boundary

This project is TESTNET ONLY.

Never introduce:
- Binance mainnet endpoints
- Mainnet trading
- Mainnet account access
- Mainnet credentials
- Production trading fallbacks

If Testnet connection fails:
DO NOT silently switch to PAPER mode when the operation is intended to execute Testnet.

The system must fail closed.

## 2. Binance Is the Source of Truth

For real Testnet operation:

- Binance Futures wallet is authoritative for Futures balance.
- Do not use simulated wallet balance as a substitute for Binance Futures balance.
- Do not calculate available trading capital from Spot balance.
- Do not assume wallet balances.
- If Binance data is unavailable, display unavailable/offline state.

## 3. Wallet Separation

The AI operates only on:

BINANCE TESTNET
└── Futures USDⓈ-M

The AI must NEVER:
- transfer funds from Spot to Futures
- transfer funds from Futures to Spot
- use Spot balance as trading capital
- use Alpha balance
- use Funding balance
- use Coin-M balance
- use Options balance

No automatic wallet transfer is allowed.

## 4. AI Capital Allocation

AI maximum allocation is:

min(Futures Available Balance, $10)

Examples:

Futures Available = $0
AI Allocation = $0

Futures Available = $3
AI Allocation = $3

Futures Available = $10
AI Allocation = $10

Futures Available = $50
AI Allocation = $10

Futures Available = $5,000
AI Allocation = $10

Never assume $10 is available.

$10 is a HARD CAP, not a guaranteed balance.

## 5. Margin Mode

AI trading MUST use:

ISOLATED

Never use:

CROSS

Before execution:
1. Verify the symbol margin mode.
2. Ensure isolated margin.
3. If isolated cannot be guaranteed, reject the trade.
4. Never silently execute using Cross margin.

## 6. Risk Limits

Existing project risk constraints must remain enforced:

- Maximum AI allocation: $10
- Maximum loss per trade: $1
- Maximum leverage: 20x
- Maximum positions: 1
- Daily loss limit: -$2
- Hard profit/session cap: +$2
- Session target: +$0.50

Do not weaken these limits without explicit project-level approval.

## 7. No Fake Data

Production/Testnet code must not:
- use Math.random() for market prices
- invent wallet balances
- invent positions
- invent orders
- invent PnL
- use hardcoded market prices as live values

If real data is unavailable:
show unavailable/offline/unknown.

## 8. Dashboard Truthfulness

Dashboard must reflect actual backend state.

Examples:

Binance unavailable:
BINANCE TESTNET — OFFLINE

Futures balance unavailable:
Wallet Balance — —

Futures balance = $0:
Wallet Balance — $0.00
AI Allocation — $0.00

Never display $10 allocation merely because the configured maximum is $10.

## 9. Execution Safety

Before placing an order, verify:

1. Testnet environment
2. Binance connectivity
3. Futures account availability
4. Futures available balance
5. Effective AI allocation
6. Symbol validity
7. Isolated margin
8. Leverage <= 20x
9. Position limit
10. Risk limits
11. Stop-loss protection
12. Take-profit configuration

Any failed safety check => NO TRADE.

## 10. Fail Closed

When uncertain:

NO TRADE.

When Binance is offline:

NO TRADE.

When balance cannot be verified:

NO TRADE.

When margin mode cannot be verified:

NO TRADE.

When credentials are invalid:

NO TRADE.

Never guess.

## 11. Change Discipline

Before modifying critical trading code:

- inspect existing architecture
- preserve existing risk controls
- run TypeScript checks
- run all tests
- run build
- run git diff --check
- audit for mainnet endpoints
- audit for secrets
- audit for fake/dummy production data

Do not modify unrelated P3/P4/P5 functionality unless required.

## 12. Required Audit Output

After implementation report:

- files changed
- tests
- TypeScript
- build
- security audit
- mainnet audit
- dummy-data audit
- risk audit
- wallet-separation audit
- margin-mode audit
- working-tree status
- commit SHA if committed
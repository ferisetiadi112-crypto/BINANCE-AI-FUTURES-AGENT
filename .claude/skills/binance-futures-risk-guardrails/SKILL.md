---
name: binance-futures-risk-guardrails
description: Enforce mandatory Binance Futures wallet separation, real-balance allocation, isolated-margin-only execution, and strict no-transfer/no-cross-margin safety rules. Use this skill whenever the agent reads Binance balances, calculates AI allocation, validates an order, selects margin mode, or executes a Futures trade.
---

# Binance Futures Risk Guardrails

## Tujuan

Skill ini adalah lapisan keselamatan WAJIB untuk seluruh sistem AI Binance Futures.

Agent HARUS menganggap saldo Binance yang nyata sebagai source of truth.

Agent TIDAK BOLEH mengarang, mengasumsikan, atau menggunakan saldo simulasi sebagai pengganti saldo Binance ketika data akun Binance tersedia.

---

# 1. WALLET HARUS DIPISAHKAN

Binance memiliki beberapa wallet/account balance yang berbeda, termasuk:

- Spot
- Margin
- Futures USDⓈ-M
- Futures COIN-M
- Options
- Funding
- Alpha
- Wallet/account lainnya yang tersedia

Saldo antar-wallet TIDAK boleh dianggap sebagai satu saldo yang bebas digunakan.

Khusus untuk Binance Futures:

AI hanya boleh menggunakan saldo yang benar-benar tersedia pada wallet Futures yang menjadi sumber eksekusi.

JANGAN mengambil saldo Spot untuk membiayai Futures secara otomatis.

JANGAN melakukan transfer Spot → Futures secara otomatis.

JANGAN melakukan transfer Funding → Futures secara otomatis.

JANGAN melakukan transfer antar-wallet untuk memenuhi allocation.

Jika Futures balance = 0:

effective allocation = 0

Walaupun Spot memiliki saldo besar.

---

# 2. BINANCE ADALAH SOURCE OF TRUTH

Semua keputusan allocation harus berdasarkan data aktual dari Binance.

Prioritas:

1. Real Binance Futures available balance
2. Real Binance Futures wallet/equity jika relevan
3. Open position dan margin yang sedang digunakan
4. Risk engine
5. AI decision

Jangan menggunakan:

- simulated wallet
- mock balance
- hardcoded balance
- paper balance
- asumsi saldo
- saldo Spot sebagai saldo Futures

sebagai pengganti saldo Futures aktual.

Jika data Binance belum tersedia atau gagal dibaca:

DO NOT GUESS.

Gunakan:

```text
walletBalance = unknown
availableBalance = unknown
effectiveAllocation = 0
execution = BLOCKED
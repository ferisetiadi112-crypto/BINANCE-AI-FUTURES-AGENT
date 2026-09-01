/**
 * Symbol Universe — BINANCE AI FUTURES AGENT v0.1
 */

import { systemConfigRepository } from "../repositories/system-config";

export type SymbolTier = "T1" | "T2" | "T3";

export type SymbolConfig = {
  symbol: string;
  name: string;
  enabled: boolean;
  minVolume: number;
  intervals: string[];
  tier: SymbolTier;
};

const DEFAULT_SYMBOLS: SymbolConfig[] = [
  // Tier 1 — High liquidity blue-chips
  { symbol: "BTCUSDT", name: "Bitcoin", enabled: true, minVolume: 1_000_000_000, intervals: ["15m", "1h", "4h"], tier: "T1" },
  { symbol: "ETHUSDT", name: "Ethereum", enabled: true, minVolume: 500_000_000, intervals: ["15m", "1h", "4h"], tier: "T1" },
  { symbol: "SOLUSDT", name: "Solana", enabled: true, minVolume: 200_000_000, intervals: ["15m", "1h", "4h"], tier: "T1" },
  { symbol: "BNBUSDT", name: "BNB", enabled: true, minVolume: 100_000_000, intervals: ["15m", "1h", "4h"], tier: "T1" },
  // Tier 2 — High-cap altcoins
  { symbol: "XRPUSDT", name: "XRP", enabled: true, minVolume: 100_000_000, intervals: ["15m", "1h", "4h"], tier: "T2" },
  { symbol: "DOGEUSDT", name: "Dogecoin", enabled: true, minVolume: 80_000_000, intervals: ["15m", "1h", "4h"], tier: "T2" },
  { symbol: "ADAUSDT", name: "Cardano", enabled: true, minVolume: 60_000_000, intervals: ["15m", "1h", "4h"], tier: "T2" },
  { symbol: "LINKUSDT", name: "Chainlink", enabled: true, minVolume: 50_000_000, intervals: ["15m", "1h", "4h"], tier: "T2" },
  // Tier 3 — Growth altcoins
  { symbol: "AVAXUSDT", name: "Avalanche", enabled: true, minVolume: 30_000_000, intervals: ["15m", "1h"], tier: "T3" },
  { symbol: "DOTUSDT", name: "Polkadot", enabled: true, minVolume: 25_000_000, intervals: ["15m", "1h"], tier: "T3" },
  { symbol: "NEARUSDT", name: "NEAR Protocol", enabled: true, minVolume: 20_000_000, intervals: ["15m", "1h"], tier: "T3" },
  { symbol: "APTUSDT", name: "Aptos", enabled: true, minVolume: 15_000_000, intervals: ["15m", "1h"], tier: "T3" },
];

let symbolCache: SymbolConfig[] | null = null;

export function getSymbolUniverse(): SymbolConfig[] {
  if (symbolCache) return symbolCache;
  const configStr = systemConfigRepository.get("symbol_universe");
  if (configStr) {
    try {
      symbolCache = JSON.parse(configStr) as SymbolConfig[];
      return symbolCache;
    } catch { /* fall through */ }
  }
  symbolCache = DEFAULT_SYMBOLS;
  return symbolCache;
}

export function getEnabledSymbols(): SymbolConfig[] {
  return getSymbolUniverse().filter(s => s.enabled);
}

export function getSymbolConfig(symbol: string): SymbolConfig | undefined {
  return getSymbolUniverse().find(s => s.symbol === symbol);
}

export function isSymbolEnabled(symbol: string): boolean {
  return getSymbolConfig(symbol)?.enabled ?? false;
}

export function getPrimarySymbol(): string {
  return getEnabledSymbols()[0]?.symbol || "BTCUSDT";
}

export function updateSymbolConfig(symbol: string, updates: { name?: string; enabled?: boolean; minVolume?: number; intervals?: string[]; tier?: SymbolTier }): void {
  const universe = getSymbolUniverse();
  const index = universe.findIndex(s => s.symbol === symbol);
  if (index >= 0) {
    const existing = universe[index]!;
    universe[index] = {
      symbol: existing.symbol,
      name: updates.name ?? existing.name,
      enabled: updates.enabled ?? existing.enabled,
      minVolume: updates.minVolume ?? existing.minVolume,
      intervals: updates.intervals ?? existing.intervals,
      tier: updates.tier ?? existing.tier,
    };
  } else {
    universe.push({
      symbol,
      name: symbol.replace("USDT", ""),
      enabled: true,
      minVolume: 100_000_000,
      intervals: ["15m", "1h"],
      tier: "T3",
      ...updates,
    });
  }
  systemConfigRepository.set("symbol_universe", JSON.stringify(universe));
  symbolCache = universe;
}

export function getSymbolCount(): { total: number; enabled: number } {
  const universe = getSymbolUniverse();
  return { total: universe.length, enabled: universe.filter(s => s.enabled).length };
}

export function getSymbolsByTier(tier: SymbolTier): SymbolConfig[] {
  return getEnabledSymbols().filter(s => s.tier === tier);
}

export function getTierCounts(): Record<SymbolTier, { total: number; enabled: number }> {
  const universe = getSymbolUniverse();
  const tiers: SymbolTier[] = ["T1", "T2", "T3"];
  const result: Record<SymbolTier, { total: number; enabled: number }> = {
    T1: { total: 0, enabled: 0 },
    T2: { total: 0, enabled: 0 },
    T3: { total: 0, enabled: 0 },
  };
  for (const s of universe) {
    const t = s.tier || "T3";
    result[t]!.total++;
    if (s.enabled) result[t]!.enabled++;
  }
  return result;
}

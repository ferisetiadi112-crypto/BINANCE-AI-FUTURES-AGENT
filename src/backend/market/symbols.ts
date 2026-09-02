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

/**
 * Synchronous version that uses cached data.
 * Use only when async is not possible (constructor, timer callbacks).
 * Falls back to defaults if cache is empty.
 */
export function getEnabledSymbolsSync(): SymbolConfig[] {
  if (symbolCache) return symbolCache.filter(s => s.enabled);
  return DEFAULT_SYMBOLS.filter(s => s.enabled);
}

export async function getSymbolUniverse(): Promise<SymbolConfig[]> {
  if (symbolCache) return symbolCache;
  const configStr = await systemConfigRepository.get("symbol_universe");
  if (configStr) {
    try {
      symbolCache = JSON.parse(configStr) as SymbolConfig[];
      return symbolCache;
    } catch { /* fall through */ }
  }
  symbolCache = DEFAULT_SYMBOLS;
  return symbolCache;
}

export async function getEnabledSymbols(): Promise<SymbolConfig[]> {
  const universe = await getSymbolUniverse();
  return universe.filter(s => s.enabled);
}

export async function getSymbolConfig(symbol: string): Promise<SymbolConfig | undefined> {
  const universe = await getSymbolUniverse();
  return universe.find(s => s.symbol === symbol);
}

export async function isSymbolEnabled(symbol: string): Promise<boolean> {
  const config = await getSymbolConfig(symbol);
  return config?.enabled ?? false;
}

export async function getPrimarySymbol(): Promise<string> {
  const enabled = await getEnabledSymbols();
  return enabled[0]?.symbol || "BTCUSDT";
}

export async function updateSymbolConfig(symbol: string, updates: { name?: string; enabled?: boolean; minVolume?: number; intervals?: string[]; tier?: SymbolTier }): Promise<void> {
  const universe = await getSymbolUniverse();
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
  await systemConfigRepository.set("symbol_universe", JSON.stringify(universe));
  symbolCache = universe;
}

export async function getSymbolCount(): Promise<{ total: number; enabled: number }> {
  const universe = await getSymbolUniverse();
  return { total: universe.length, enabled: universe.filter(s => s.enabled).length };
}

export async function getSymbolsByTier(tier: SymbolTier): Promise<SymbolConfig[]> {
  const enabled = await getEnabledSymbols();
  return enabled.filter(s => s.tier === tier);
}

export async function getTierCounts(): Promise<Record<SymbolTier, { total: number; enabled: number }>> {
  const universe = await getSymbolUniverse();
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

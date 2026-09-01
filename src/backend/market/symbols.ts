/**
 * Symbol Universe — BINANCE AI FUTURES AGENT v0.1
 */

import { systemConfigRepository } from "../repositories/system-config";

export type SymbolConfig = {
  symbol: string;
  name: string;
  enabled: boolean;
  minVolume: number;
  intervals: string[];
};

const DEFAULT_SYMBOLS: SymbolConfig[] = [
  { symbol: "BTCUSDT", name: "Bitcoin", enabled: true, minVolume: 1_000_000_000, intervals: ["15m", "1h", "4h"] },
  { symbol: "ETHUSDT", name: "Ethereum", enabled: true, minVolume: 500_000_000, intervals: ["15m", "1h", "4h"] },
  { symbol: "SOLUSDT", name: "Solana", enabled: true, minVolume: 200_000_000, intervals: ["15m", "1h", "4h"] },
  { symbol: "BNBUSDT", name: "BNB", enabled: true, minVolume: 100_000_000, intervals: ["15m", "1h", "4h"] },
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

export function updateSymbolConfig(symbol: string, updates: { name?: string; enabled?: boolean; minVolume?: number; intervals?: string[] }): void {
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
    };
  } else {
    universe.push({
      symbol,
      name: symbol.replace("USDT", ""),
      enabled: true,
      minVolume: 100_000_000,
      intervals: ["15m", "1h"],
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

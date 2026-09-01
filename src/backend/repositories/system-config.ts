import { getDatabase } from "../database";

export type SystemConfigRecord = {
  key: string;
  value: string;
  description: string;
  updated_at: string;
};

export const systemConfigRepository = {
  get(key: string): string | undefined {
    const result = getDatabase()
      .prepare("SELECT value FROM system_config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return result?.value;
  },

  getNumber(key: string, defaultValue: number): number {
    const value = this.get(key);
    return value !== undefined ? Number(value) : defaultValue;
  },

  getBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    return value === "true" || value === "1";
  },

  getAll(): SystemConfigRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM system_config ORDER BY key")
      .all() as SystemConfigRecord[];
  },

  set(key: string, value: string, description?: string): void {
    getDatabase().prepare(`
      INSERT OR REPLACE INTO system_config (key, value, description, updated_at)
      VALUES (?, ?, COALESCE(?, ''), datetime('now'))
    `).run(key, value, description || "");
  },

  getConfig(): {
    initialCapital: number;
    dailyProfitCap: number;
    dailyLossLimit: number;
    maxLeverage: number;
    paperTrading: boolean;
    tradingEnabled: boolean;
    binanceTestnet: boolean;
  } {
    return {
      initialCapital: this.getNumber("initial_capital", 5.0),
      dailyProfitCap: this.getNumber("daily_profit_cap", 0.5),
      dailyLossLimit: this.getNumber("daily_loss_limit", 0.5),
      maxLeverage: this.getNumber("max_leverage", 10),
      paperTrading: this.getBoolean("paper_trading", true),
      tradingEnabled: this.getBoolean("trading_enabled", false),
      binanceTestnet: this.getBoolean("binance_testnet", false),
    };
  },
};

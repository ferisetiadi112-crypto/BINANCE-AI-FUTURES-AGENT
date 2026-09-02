import { dbQueryOne, dbQuery, dbExecute } from "../database/adapter";

export type SystemConfigRecord = {
  key: string;
  value: string;
  description: string;
  updated_at: string;
};

export const systemConfigRepository = {
  async get(key: string): Promise<string | undefined> {
    const row = await dbQueryOne(
      "SELECT value FROM system_config WHERE key = $1",
      [key]
    );
    return row?.["value"] as string | undefined;
  },

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const value = await this.get(key);
    return value !== undefined ? Number(value) : defaultValue;
  },

  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) return defaultValue;
    return value === "true" || value === "1";
  },

  async getAll(): Promise<SystemConfigRecord[]> {
    const rows = await dbQuery("SELECT * FROM system_config ORDER BY key");
    return rows as unknown as SystemConfigRecord[];
  },

  async set(key: string, value: string, description?: string): Promise<void> {
    await dbExecute(
      `INSERT INTO system_config (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW()::TEXT)
       ON CONFLICT (key) DO UPDATE SET value = $2, description = $3, updated_at = NOW()::TEXT`,
      [key, value, description || ""]
    );
  },

  async getConfig(): Promise<{
    initialCapital: number;
    dailyProfitCap: number;
    dailyLossLimit: number;
    maxLeverage: number;
    paperTrading: boolean;
    tradingEnabled: boolean;
    binanceTestnet: boolean;
  }> {
    const rows = await dbQuery("SELECT * FROM system_config ORDER BY key");
    const map = new Map<string, string>();
    for (const r of rows) map.set(r["key"] as string, r["value"] as string);

    const num = (k: string, d: number) => {
      const v = map.get(k);
      return v !== undefined ? Number(v) : d;
    };
    const bool = (k: string, d: boolean) => {
      const v = map.get(k);
      if (v === undefined) return d;
      return v === "true" || v === "1";
    };

    return {
      initialCapital: num("initial_capital", 5.0),
      dailyProfitCap: num("daily_profit_cap", 0.5),
      dailyLossLimit: num("daily_loss_limit", 0.5),
      maxLeverage: num("max_leverage", 10),
      paperTrading: bool("paper_trading", true),
      tradingEnabled: bool("trading_enabled", false),
      binanceTestnet: bool("binance_testnet", false),
    };
  },
};

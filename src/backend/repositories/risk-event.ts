import { dbQueryOne, dbQuery } from "../database/adapter";

export type RiskEventRecord = {
  id: number;
  event_type: string;
  severity: string;
  message: string;
  details: string;
  created_at: string;
};

export const riskEventRepository = {
  async getRecent(limit = 20): Promise<RiskEventRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM risk_events ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return rows as unknown as RiskEventRecord[];
  },

  async getBySeverity(severity: string): Promise<RiskEventRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM risk_events WHERE severity = $1 ORDER BY created_at DESC",
      [severity]
    );
    return rows as unknown as RiskEventRecord[];
  },

  async count(): Promise<number> {
    const result = await dbQueryOne("SELECT COUNT(*) as count FROM risk_events") as { count: number } | undefined;
    return Number(result?.count ?? 0);
  },

  async getLatestCritical(): Promise<RiskEventRecord | undefined> {
    const row = await dbQueryOne(
      "SELECT * FROM risk_events WHERE severity IN ('ERROR', 'CRITICAL') ORDER BY created_at DESC LIMIT 1"
    );
    return row as RiskEventRecord | undefined;
  },
};

import { getDatabase } from "../database";

export type RiskEventRecord = {
  id: number;
  event_type: string;
  severity: string;
  message: string;
  details: string;
  created_at: string;
};

export const riskEventRepository = {
  getRecent(limit = 20): RiskEventRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM risk_events ORDER BY created_at DESC LIMIT ?")
      .all(limit) as RiskEventRecord[];
  },

  getBySeverity(severity: string): RiskEventRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM risk_events WHERE severity = ? ORDER BY created_at DESC")
      .all(severity) as RiskEventRecord[];
  },

  count(): number {
    const result = getDatabase().prepare("SELECT COUNT(*) as count FROM risk_events").get() as { count: number };
    return result.count;
  },

  getLatestCritical(): RiskEventRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM risk_events WHERE severity IN ('ERROR', 'CRITICAL') ORDER BY created_at DESC LIMIT 1")
      .get() as RiskEventRecord | undefined;
  },
};

import { dbQueryOne, dbQuery } from "../database/adapter";

export type AiExperienceRecord = {
  id: string;
  tag: string;
  title: string;
  confidence: number;
  impact: string;
  details: string;
  trade_ids: string;
  created_at: string;
};

export const aiExperienceRepository = {
  async getAll(): Promise<AiExperienceRecord[]> {
    const rows = await dbQuery("SELECT * FROM ai_experiences ORDER BY confidence DESC");
    return rows as unknown as AiExperienceRecord[];
  },

  async getByTag(tag: string): Promise<AiExperienceRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM ai_experiences WHERE tag = $1 ORDER BY confidence DESC",
      [tag]
    );
    return rows as unknown as AiExperienceRecord[];
  },

  async getById(id: string): Promise<AiExperienceRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM ai_experiences WHERE id = $1", [id]);
    return row as AiExperienceRecord | undefined;
  },

  async count(): Promise<number> {
    const result = await dbQueryOne("SELECT COUNT(*) as count FROM ai_experiences") as { count: number } | undefined;
    return Number(result?.count ?? 0);
  },
};

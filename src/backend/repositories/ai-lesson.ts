import { dbQueryOne, dbQuery } from "../database/adapter";

export type AiLessonRecord = {
  id: string;
  text: string;
  cycle: number;
  source_experience_ids: string;
  created_at: string;
};

export const aiLessonRepository = {
  async getAll(): Promise<AiLessonRecord[]> {
    const rows = await dbQuery("SELECT * FROM ai_lessons ORDER BY cycle DESC");
    return rows as unknown as AiLessonRecord[];
  },

  async getByCycle(cycle: number): Promise<AiLessonRecord | undefined> {
    const row = await dbQueryOne(
      "SELECT * FROM ai_lessons WHERE cycle = $1",
      [cycle]
    );
    return row as AiLessonRecord | undefined;
  },

  async count(): Promise<number> {
    const result = await dbQueryOne("SELECT COUNT(*) as count FROM ai_lessons") as { count: number } | undefined;
    return Number(result?.count ?? 0);
  },

  async getLatestCycle(): Promise<number> {
    const result = await dbQueryOne("SELECT MAX(cycle) as cycle FROM ai_lessons") as { cycle: number } | undefined;
    return Number(result?.cycle ?? 0);
  },
};

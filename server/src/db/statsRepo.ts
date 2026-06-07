import pool from './pool';

export interface StatsRecord {
  conditionId:   string;
  triggerCount:  number;
  lastTriggered: number | null; 
}

export const statsRepo = {
  async increment(conditionId: string, ts: number): Promise<void> {
    await pool.query(
      `INSERT INTO trigger_stats (condition_id, trigger_count, last_triggered)
       VALUES ($1, 1, $2)
       ON CONFLICT (condition_id) DO UPDATE
         SET trigger_count  = trigger_stats.trigger_count + 1,
             last_triggered = EXCLUDED.last_triggered`,
      [conditionId, new Date(ts)],
    );
  },

  async get(conditionId: string): Promise<StatsRecord | null> {
    const { rows } = await pool.query(
      `SELECT * FROM trigger_stats WHERE condition_id = $1`,
      [conditionId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      conditionId:   r.condition_id  as string,
      triggerCount:  r.trigger_count as number,
      lastTriggered: r.last_triggered
        ? new Date(r.last_triggered as string).getTime()
        : null,
    };
  },

  async getAll(): Promise<StatsRecord[]> {
    const { rows } = await pool.query(`SELECT * FROM trigger_stats`);
    return rows.map(r => ({
      conditionId:   r.condition_id  as string,
      triggerCount:  r.trigger_count as number,
      lastTriggered: r.last_triggered
        ? new Date(r.last_triggered as string).getTime()
        : null,
    }));
  },

  async delete(conditionId: string): Promise<void> {
    await pool.query(
      `DELETE FROM trigger_stats WHERE condition_id = $1`,
      [conditionId],
    );
  },
};
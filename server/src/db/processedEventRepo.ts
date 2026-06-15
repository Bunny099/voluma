import pool from './pool';

export const processedEventRepo = {
 
  async insertIfAbsent(conditionId: string, signature: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `INSERT INTO processed_events (condition_id, signature)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conditionId, signature],
    );
    return (rowCount ?? 0) > 0;
  },

  async cleanup(olderThanTs: number): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM processed_events WHERE created_at < $1`,
      [new Date(olderThanTs)],
    );
    return rowCount ?? 0;
  },
};
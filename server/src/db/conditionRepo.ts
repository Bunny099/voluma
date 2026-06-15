import pool               from './pool';
import { type Condition } from '../conditions/types';


function parseData(raw: unknown): Condition {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Condition;
}

export const conditionRepo = {
  async save(condition: Condition): Promise<void> {
    await pool.query(
      `INSERT INTO conditions (id, user_id, data, execution_count, created_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [condition.id, condition.userId, JSON.stringify(condition)],
    );
  },

  async get(id: string): Promise<Condition | null> {
    const { rows } = await pool.query(
      `SELECT data FROM conditions WHERE id = $1`,
      [id],
    );
    return rows[0] ? parseData(rows[0].data) : null;
  },

 
  async getByUserId(userId: string): Promise<Array<Condition & { executionCount: number }>> {
    const { rows } = await pool.query(
      `SELECT data, execution_count FROM conditions WHERE user_id = $1`,
      [userId],
    );
    return rows.map(r => ({
      ...parseData(r.data),
      executionCount: r.execution_count as number,
    }));
  },

  async getAll(): Promise<Condition[]> {
    const { rows } = await pool.query(`SELECT data FROM conditions`);
    return rows.map(r => parseData(r.data));
  },

  async delete(id: string): Promise<void> {
    await pool.query(`DELETE FROM conditions WHERE id = $1`, [id]);
  },

  async incrementExecutionCount(id: string): Promise<void> {
    await pool.query(
      `UPDATE conditions SET execution_count = execution_count + 1 WHERE id = $1`,
      [id],
    );
  },


  async incrementIfUnderLimit(id: string, limit: number): Promise<boolean> {
    const { rows } = await pool.query(
      `UPDATE conditions
       SET execution_count = execution_count + 1
       WHERE id = $1 AND execution_count < $2
       RETURNING execution_count`,
      [id, limit],
    );
    return rows.length > 0;
  },

  async getExecutionCount(id: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT execution_count FROM conditions WHERE id = $1`,
      [id],
    );
    return (rows[0]?.execution_count as number | undefined) ?? 0;
  },

 
  async getManyExecutionCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const { rows } = await pool.query(
      `SELECT id, execution_count FROM conditions WHERE id = ANY($1)`,
      [ids],
    );
    return new Map(rows.map(r => [r.id as string, r.execution_count as number]));
  },
};

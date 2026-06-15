import pool from './pool';

export interface PendingTx {
  txHash:       string;
  userId:       string;
  conditionId:  string | null;
  status:       'PENDING' | 'CONFIRMED' | 'FAILED';
  rawAmountIn:  number | null;
  inputMint:    string | null;
  outputMint:   string | null;
  failureReason: string | null;
  createdAt:    number;
  updatedAt:    number; 
  lastCheckedAt: number | null;
  confirmedAt: number | null;
  failedAt: number | null;
}

function toRecord(row: Record<string, unknown>): PendingTx {
  return {
    txHash:      row.tx_hash      as string,
    userId:      row.user_id      as string,
    conditionId: (row.condition_id as string | null) ?? null,
    status:      row.status       as 'PENDING' | 'CONFIRMED' | 'FAILED',
    rawAmountIn: row.raw_amount_in != null ? Number(row.raw_amount_in) : null,
    inputMint:   (row.input_mint  as string | null) ?? null,
    outputMint:  (row.output_mint as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdAt:   new Date(row.created_at as string).getTime(),
    updatedAt:   new Date(row.updated_at as string).getTime(),
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at as string).getTime() : null,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string).getTime() : null,
    failedAt: row.failed_at ? new Date(row.failed_at as string).getTime() : null,
  };
}

export const pendingTxRepo = {
  async insert(
    txHash:      string,
    userId:      string,
    conditionId: string | null,
    rawAmountIn: number | null,
    inputMint:   string | null,
    outputMint:  string | null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO pending_txs
         (tx_hash, user_id, condition_id, status, raw_amount_in, input_mint, output_mint)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [txHash, userId, conditionId, rawAmountIn, inputMint, outputMint],
    );
  },

  async updateConfirmed(txHash: string): Promise<void> {
    await pool.query(
      `UPDATE pending_txs
       SET status = 'CONFIRMED',
           updated_at = NOW(),
           last_checked_at = NOW(),
           confirmed_at = NOW(),
           failure_reason = NULL
       WHERE tx_hash = $1`,
      [txHash],
    );
  },

  async updateFailed(txHash: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE pending_txs
       SET status = 'FAILED',
           updated_at = NOW(),
           last_checked_at = NOW(),
           failed_at = NOW(),
           failure_reason = $2
       WHERE tx_hash = $1`,
      [txHash, reason],
    );
  },

  async markChecked(txHash: string): Promise<void> {
    await pool.query(
      `UPDATE pending_txs
       SET last_checked_at = NOW(),
           updated_at = NOW()
       WHERE tx_hash = $1`,
      [txHash],
    );
  },

  async getPending(limit = 50): Promise<PendingTx[]> {
    const { rows } = await pool.query(
      `SELECT * FROM pending_txs WHERE status = 'PENDING'
       ORDER BY created_at ASC LIMIT $1`,
      [limit],
    );
    return rows.map(r => toRecord(r as Record<string, unknown>));
  },

  async getByTxHash(txHash: string): Promise<PendingTx | null> {
    const { rows } = await pool.query(
      `SELECT * FROM pending_txs WHERE tx_hash = $1`,
      [txHash],
    );
    return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
  },

  async getByWallet(userId: string): Promise<PendingTx[]> {
    const { rows } = await pool.query(
      `SELECT * FROM pending_txs
       WHERE user_id = $1 AND status = 'PENDING'
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(r => toRecord(r as Record<string, unknown>));
  },

  async cleanup(olderThanTs: number): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM pending_txs
       WHERE created_at < $1 AND status != 'PENDING'`,
      [new Date(olderThanTs)],
    );
    return rowCount ?? 0;
  },
};

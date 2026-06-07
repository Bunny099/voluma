import { nanoid } from 'nanoid';
import pool from './pool';

export type WalletActivityType =
  | 'WALLET_CREATED'
  | 'WALLET_EXPORT_REQUESTED'
  | 'WITHDRAWAL_EXECUTED'
  | 'TRADE_EXECUTED';

export interface WalletActivityLog {
  id: string;
  userId: string;
  walletPublicKey: string;
  actionType: WalletActivityType;
  metadata: Record<string, unknown>;
  createdAt: number;
}

function toRecord(row: Record<string, unknown>): WalletActivityLog {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    walletPublicKey: row.wallet_public_key as string,
    actionType: row.action_type as WalletActivityType,
    metadata: (typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).getTime(),
  };
}

export const walletActivityRepo = {
  async insert(
    userId: string,
    walletPublicKey: string,
    actionType: WalletActivityType,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await pool.query(
      `INSERT INTO wallet_activity_logs
         (id, user_id, wallet_public_key, action_type, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [nanoid(), userId, walletPublicKey, actionType, JSON.stringify(metadata)],
    );
  },

  async getRecentByUser(userId: string, limit = 20): Promise<WalletActivityLog[]> {
    const { rows } = await pool.query(
      `SELECT * FROM wallet_activity_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows.map((row) => toRecord(row as Record<string, unknown>));
  },
};

import { nanoid } from 'nanoid';
import pool from './pool';

export type TradeExecutionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface TradeExecutionRecord {
  id: string;
  txHash: string | null;
  userId: string;
  conditionId: string | null;
  manual: boolean;
  direction: 'BUY' | 'SELL';
  inputMint: string;
  outputMint: string;
  rawAmountIn: number;
  quoteOutAmount: number | null;
  slippageBps: number;
  quotePriceImpactPct: number | null;
  routeSummary: unknown;
  status: TradeExecutionStatus;
  executionDurationMs: number | null;
  failureReason: string | null;
  rpcProvider: string | null;
  createdAt: number;
  updatedAt: number;
}

function toRecord(row: Record<string, unknown>): TradeExecutionRecord {
  return {
    id: row.id as string,
    txHash: row.tx_hash as string,
    userId: row.user_id as string,
    conditionId: (row.condition_id as string | null) ?? null,
    manual: Boolean(row.manual),
    direction: row.direction as 'BUY' | 'SELL',
    inputMint: row.input_mint as string,
    outputMint: row.output_mint as string,
    rawAmountIn: Number(row.raw_amount_in),
    quoteOutAmount: row.quote_out_amount != null ? Number(row.quote_out_amount) : null,
    slippageBps: Number(row.slippage_bps ?? 0),
    quotePriceImpactPct: row.quote_price_impact_pct != null ? Number(row.quote_price_impact_pct) : null,
    routeSummary: typeof row.route_summary === 'string' ? JSON.parse(row.route_summary) : row.route_summary,
    status: row.status as TradeExecutionStatus,
    executionDurationMs: row.execution_duration_ms != null ? Number(row.execution_duration_ms) : null,
    failureReason: (row.failure_reason as string | null) ?? null,
    rpcProvider: (row.rpc_provider as string | null) ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
  };
}

export interface TradeExecutionInsert {
  txHash: string | null;
  userId: string;
  conditionId: string | null;
  manual: boolean;
  direction: 'BUY' | 'SELL';
  inputMint: string;
  outputMint: string;
  rawAmountIn: number;
  quoteOutAmount: number | null;
  slippageBps: number;
  quotePriceImpactPct: number | null;
  routeSummary: unknown;
  status: TradeExecutionStatus;
  executionDurationMs: number | null;
  failureReason: string | null;
  rpcProvider: string | null;
}

export const tradeExecutionRepo = {
  async insert(record: TradeExecutionInsert): Promise<void> {
    await pool.query(
      `INSERT INTO trade_executions
         (id, tx_hash, user_id, condition_id, manual, direction, input_mint, output_mint,
          raw_amount_in, quote_out_amount, slippage_bps, quote_price_impact_pct,
          route_summary, status, execution_duration_ms, failure_reason, rpc_provider)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16, $17)
       ON CONFLICT (tx_hash) DO UPDATE SET
         status = EXCLUDED.status,
         execution_duration_ms = EXCLUDED.execution_duration_ms,
         failure_reason = EXCLUDED.failure_reason,
         quote_out_amount = EXCLUDED.quote_out_amount,
         quote_price_impact_pct = EXCLUDED.quote_price_impact_pct,
         route_summary = EXCLUDED.route_summary,
         rpc_provider = EXCLUDED.rpc_provider,
         updated_at = NOW()`,
      [
        nanoid(),
        record.txHash,
        record.userId,
        record.conditionId,
        record.manual,
        record.direction,
        record.inputMint,
        record.outputMint,
        record.rawAmountIn,
        record.quoteOutAmount,
        record.slippageBps,
        record.quotePriceImpactPct,
        JSON.stringify(record.routeSummary ?? null),
        record.status,
        record.executionDurationMs,
        record.failureReason,
        record.rpcProvider,
      ],
    );
  },

  async updateStatus(
    txHash: string,
    status: TradeExecutionStatus,
    updates: {
      executionDurationMs?: number | null;
      failureReason?: string | null;
    } = {},
  ): Promise<void> {
    await pool.query(
      `UPDATE trade_executions
       SET status = $2,
           execution_duration_ms = COALESCE($3, execution_duration_ms),
           failure_reason = COALESCE($4, failure_reason),
           confirmed_at = CASE WHEN $2 = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
           failed_at = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE failed_at END,
           updated_at = NOW()
       WHERE tx_hash = $1`,
      [txHash, status, updates.executionDurationMs ?? null, updates.failureReason ?? null],
    );
  },

  async getRecentByUser(userId: string, limit = 20): Promise<TradeExecutionRecord[]> {
    const { rows } = await pool.query(
      `SELECT * FROM trade_executions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows.map((row) => toRecord(row as Record<string, unknown>));
  },
};

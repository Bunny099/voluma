export type ConditionType =
  | 'WALLET_ACTIVITY'
  | 'SWAP_BURST'
  | 'TOKEN_VOLUME'
  | 'LARGE_TRANSFER';

export type ActionType = 'NOTIFY' | 'WEBHOOK' | 'LOG';

export interface ExecutionAction {
  type: ActionType;
  webhookUrl?: string;
}

export interface Condition {
  id: string;
  userId: string;
  name: string;
  type: ConditionType;
  enabled: boolean;
  // WALLET_ACTIVITY
  wallet?: string;
  transactionType?: 'BUY' | 'SELL' | 'TRANSFER' | 'ANY';
  minAmountSol?: number;
  // SWAP_BURST / TOKEN_VOLUME
  tokenMint?: string;
  minSwaps?: number;
  minVolumeSol?: number;
  windowSeconds?: number;
  // LARGE_TRANSFER
  minSol?: number;
  // Shared
  actions: ExecutionAction[];
  cooldownSeconds: number;
  createdAt: number;
}
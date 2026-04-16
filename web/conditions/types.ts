export type ConditionType =
  | 'WALLET_ACTIVITY'
  | 'SWAP_BURST'
  | 'TOKEN_VOLUME'
  | 'LARGE_TRANSFER';

export type ActionType = 'NOTIFY' | 'WEBHOOK' | 'LOG' | "TRADE";

export interface ExecutionAction {
  type: ActionType;
  webhookUrl?: string;
   tradeDirection?:   'BUY' | 'SELL';
  tradeTokenMint?:   string;
  tradeAmountSol?:   number;
  tradeSlippageBps?: number;
}

export interface Condition {
  id: string;
  userId: string;
  name: string;
  type: ConditionType;
  enabled: boolean;
  wallet?: string;
  transactionType?: 'BUY' | 'SELL' | 'TRANSFER' | 'ANY';
  minAmountSol?: number;
  tokenMint?: string;
  minSwaps?: number;
  minVolumeSol?: number;
  windowSeconds?: number;
  minSol?: number;
  actions: ExecutionAction[];
  cooldownSeconds: number;
  createdAt: number;
}


export interface ConditionWithStats extends Condition {
  triggerCount:  number;
  lastTriggered: number | null;
}
import { EventEmitter } from 'events';

export type ConfidenceLevel = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type EventDirection = 'BUY' | 'SELL' | 'TRANSFER' | 'SWAP' | 'UNKNOWN';

export interface NormalizedEvent {
  signature: string;
  timestamp: number;
  slot?: number;
  type: 'SWAP' | 'TRANSFER' | 'UNKNOWN';
  direction: EventDirection;
  wallet?: string;
  tokenMint?: string;
  tokenSymbol?: string;
  amount?: number;
  amountUi?: number;
  amountDecimals?: number;
  amountSol?: number;
  programId?: string;
  confidence: ConfidenceLevel;
  metadata?: Record<string, unknown>;
  rawLogs?: string;
}

export interface IngestionProvider extends EventEmitter {
  connect():    void;
  disconnect(): void;
  watchWallet?(wallet: string):    void;
  unwatchWallet?(wallet: string):  void;
}

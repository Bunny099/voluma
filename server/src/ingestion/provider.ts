import { EventEmitter } from 'events';

export interface NormalizedEvent {
  signature:   string;
  timestamp:   number;
  type:        'SWAP' | 'TRANSFER' | 'UNKNOWN';
  wallet?:     string;
  tokenMint?:  string;
  amount?:     number;
  programId?:  string;
  confidence:  'HIGH' | 'MEDIUM' | 'LOW';  
  rawLogs?:    string;
}

export interface IngestionProvider extends EventEmitter {
  connect():    void;
  disconnect(): void;
  watchWallet?(wallet: string):    void;
  unwatchWallet?(wallet: string):  void;
}
import { EventEmitter } from 'events';
import { type IngestionProvider } from './provider';

/**
 * STUB — Future implementation using Helius Yellowstone gRPC stream.
 *
 * Yellowstone delivers fully decoded transaction data (wallets, amounts,
 * token mints) at <100ms latency without any log parsing heuristics.
 * The rest of the system — condition engine, execution, WS broadcast —
 * requires zero changes because both providers implement IngestionProvider.
 */
export class YellowstoneProvider extends EventEmitter implements IngestionProvider {
  connect(): void {
    throw new Error(
      'YellowstoneProvider not yet implemented. ' +
      'Set INGESTION_PROVIDER=yellowstone and provide credentials.'
    );
  }

  disconnect(): void {}

  watchWallet(_wallet: string):   void {}
  unwatchWallet(_wallet: string): void {}
}
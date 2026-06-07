import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { TTLCache } from '../lib/ttl-cache';
import { RPCManager } from '../rpc/rpcManager';
import { enrichEventFromParsedTransaction } from './transaction-parser';
import { type IngestionProvider, type NormalizedEvent } from './provider';

const DEX_PROGRAMS = [
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
] as const;

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const KNOWN_PROGRAMS = new Set([
  ...DEX_PROGRAMS,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bR',
  'ComputeBudget111111111111111111111111111111',
]);

const PUBKEY_RE = /[A-HJ-NP-Za-km-z1-9]{43,44}/g;
const MINT_LOG_RE = /[Mm]int[:\s=]+([A-HJ-NP-Za-km-z1-9]{43,44})/;

const DEDUP_MAX = 12_000;
const DEDUP_CLEAN_MS = 4 * 60 * 1_000;
const PROCESS_DELAY_MS = 40;

interface SubscriptionDescriptor {
  kind: 'program' | 'wallet';
  key: string;
}

interface PendingNotification {
  descriptor: SubscriptionDescriptor;
  logs: string[];
  timer: ReturnType<typeof setTimeout>;
}

export class PublicRPCProvider extends EventEmitter implements IngestionProvider {
  private ws: WebSocket | null = null;
  private emitted = new Set<string>();
  private watchedWallets = new Set<string>();
  private trackedTokenMints = new Set<string>();
  private reconnectDelay = 1_000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private cleanInterval: ReturnType<typeof setInterval> | null = null;
  private currentProviderId: string | null = null;
  private readonly subscriptionRequests = new Map<string, SubscriptionDescriptor>();
  private readonly subscriptions = new Map<number, SubscriptionDescriptor>();
  private readonly walletSubscriptionIds = new Map<string, number>();
  private readonly pendingNotifications = new Map<string, PendingNotification>();
  private readonly enrichedCache = new TTLCache<string, NormalizedEvent>(30_000, 10_000);
  private watchLargeTransfers = false;

  constructor(
    private readonly rpcManager: RPCManager,
    private readonly resolveSymbol: (mint: string) => string,
  ) {
    super();
  }

  connect(): void {
    this.cleanInterval = setInterval(() => this.trimDedup(), DEDUP_CLEAN_MS);
    this.openWS();
  }

  disconnect(): void {
    this.ws?.close();
    this.stopPing();
    if (this.cleanInterval) {
      clearInterval(this.cleanInterval);
      this.cleanInterval = null;
    }

    for (const pending of this.pendingNotifications.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingNotifications.clear();
  }

  watchWallet(wallet: string): void {
    if (this.watchedWallets.has(wallet)) return;
    this.watchedWallets.add(wallet);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribeWallet(wallet);
    }
  }

  unwatchWallet(wallet: string): void {
    this.watchedWallets.delete(wallet);
    const subscriptionId = this.walletSubscriptionIds.get(wallet);
    if (subscriptionId !== undefined) {
      this.send({
        jsonrpc: '2.0',
        id: `unsub:${wallet.slice(0, 8)}`,
        method: 'logsUnsubscribe',
        params: [subscriptionId],
      });
      this.walletSubscriptionIds.delete(wallet);
      this.subscriptions.delete(subscriptionId);
    }
  }

  trackTokenMint(mint: string): void {
    this.trackedTokenMints.add(mint);
  }

  untrackTokenMint(mint: string): void {
    this.trackedTokenMints.delete(mint);
  }

  setWatchLargeTransfers(enabled: boolean): void {
    this.watchLargeTransfers = enabled;
  }

  private openWS(): void {
    const { url, provider } = this.rpcManager.getWsConnection();
    this.currentProviderId = provider.id;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.handleFailure('ws_open_failed');
      return;
    }

    this.ws.on('open', () => {
      this.reconnectDelay = 1_000;
      this.subscriptionRequests.clear();
      this.subscriptions.clear();
      this.walletSubscriptionIds.clear();
      this.startPing();
      this.subscribeBasePrograms();
      for (const wallet of this.watchedWallets) {
        this.subscribeWallet(wallet);
      }
      this.emit('connected');
    });

    this.ws.on('message', (raw: Buffer | string) => {
      this.handleMessage(typeof raw === 'string' ? raw : raw.toString());
    });

    this.ws.on('close', (code) => {
      this.stopPing();
      if (this.currentProviderId) {
        this.rpcManager.recordReconnect(this.currentProviderId);
        this.rpcManager.markProviderFailure(`ws_closed_${code}`, {
          providerId: this.currentProviderId,
        });
      }
      this.scheduleReconnect();
      this.emit('disconnected');
    });

    this.ws.on('error', () => {
      // close handler performs failover bookkeeping
    });
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.openWS(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  private subscribeBasePrograms(): void {
    for (const program of [...DEX_PROGRAMS, SYSTEM_PROGRAM]) {
      this.subscribeDescriptor({
        kind: 'program',
        key: program,
      });
    }
  }

  private subscribeWallet(wallet: string): void {
    this.subscribeDescriptor({
      kind: 'wallet',
      key: wallet,
    });
  }

  private subscribeDescriptor(descriptor: SubscriptionDescriptor): void {
    const requestId = `sub:${descriptor.kind}:${descriptor.key}`;
    this.subscriptionRequests.set(requestId, descriptor);
    this.send({
      jsonrpc: '2.0',
      id: requestId,
      method: 'logsSubscribe',
      params: [{ mentions: [descriptor.key] }, { commitment: 'confirmed' }],
    });
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.id && typeof msg.result === 'number') {
      const descriptor = this.subscriptionRequests.get(String(msg.id));
      if (!descriptor) return;
      this.subscriptions.set(msg.result, descriptor);
      if (descriptor.kind === 'wallet') {
        this.walletSubscriptionIds.set(descriptor.key, msg.result);
      }
      return;
    }

    if (msg.method !== 'logsNotification') return;

    const subscriptionId = msg.params?.subscription as number | undefined;
    const descriptor = subscriptionId !== undefined
      ? this.subscriptions.get(subscriptionId)
      : undefined;
    if (!descriptor) return;

    const value = msg.params?.result?.value;
    if (!value || value.err) return;

    const { signature, logs } = value as { signature: string; logs: string[] };
    const slot = msg.params?.result?.context?.slot as number | undefined;
    if (!signature || !Array.isArray(logs)) return;
    if (this.emitted.has(signature)) return;

    const existing = this.pendingNotifications.get(signature);
    if (existing) {
      if (priority(descriptor) > priority(existing.descriptor)) {
        existing.descriptor = descriptor;
        existing.logs = logs;
      }
      return;
    }

    const timer = setTimeout(() => {
      this.pendingNotifications.delete(signature);
      void this.processNotification(signature, logs, descriptor, slot);
    }, PROCESS_DELAY_MS);
    timer.unref?.();

    this.pendingNotifications.set(signature, {
      descriptor,
      logs,
      timer,
    });
  }

  private async processNotification(
    signature: string,
    logs: string[],
    descriptor: SubscriptionDescriptor,
    slot?: number,
  ): Promise<void> {
    if (this.emitted.has(signature)) return;
    this.emitted.add(signature);
    if (this.emitted.size > DEDUP_MAX) this.trimDedup();

    if (this.currentProviderId && slot !== undefined) {
      this.rpcManager.markProviderSuccess(slot, this.currentProviderId);
    }

    const baseEvent = this.parseHeuristic(signature, logs, descriptor, slot);
    if (!this.shouldEnrich(baseEvent, descriptor)) {
      this.emit('transaction', baseEvent);
      return;
    }

    const cached = this.enrichedCache.get(signature);
    if (cached) {
      this.emit('transaction', cached);
      return;
    }

    try {
      const transaction = await this.rpcManager.getHttpConnection().getParsedTransaction(
        signature,
        {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        },
      );

      if (!transaction) {
        this.emit('transaction', baseEvent);
        return;
      }

      if (this.currentProviderId) {
        this.rpcManager.markProviderSuccess(transaction.slot, this.currentProviderId);
      }

      const enriched = enrichEventFromParsedTransaction({
        signature,
        logs,
        baseEvent,
        transaction,
        watchedWallets: this.watchedWallets,
        preferredWallet: descriptor.kind === 'wallet' ? descriptor.key : undefined,
        providerId: this.currentProviderId ?? 'unknown',
        resolveSymbol: this.resolveSymbol,
      });

      this.enrichedCache.set(signature, enriched);
      this.emit('transaction', enriched);
    } catch (error: any) {
      this.handleFailure(error?.message ?? 'parsed_transaction_failed', {
        rateLimited: isRateLimitError(error),
      });
      this.emit('transaction', baseEvent);
    }
  }

  private shouldEnrich(
    event: NormalizedEvent,
    descriptor: SubscriptionDescriptor,
  ): boolean {
    if (descriptor.kind === 'wallet') return true;
    if (event.type === 'TRANSFER') return this.watchLargeTransfers;
    if (event.type !== 'SWAP') return false;

    if (!this.trackedTokenMints.size && !this.watchedWallets.size) {
      return false;
    }

    return !event.tokenMint || this.trackedTokenMints.has(event.tokenMint) || this.watchedWallets.size > 0;
  }

  private parseHeuristic(
    signature: string,
    logs: string[],
    descriptor: SubscriptionDescriptor,
    slot?: number,
  ): NormalizedEvent {
    const joined = logs.join('\n');

    let type: NormalizedEvent['type'] = 'UNKNOWN';
    let direction: NormalizedEvent['direction'] = 'UNKNOWN';
    let programId: string | undefined;

    for (const program of DEX_PROGRAMS) {
      if (joined.includes(program)) {
        type = 'SWAP';
        direction = 'SWAP';
        programId = program;
        break;
      }
    }

    if (type === 'UNKNOWN' && joined.includes(SYSTEM_PROGRAM)) {
      type = 'TRANSFER';
      direction = 'TRANSFER';
      programId = SYSTEM_PROGRAM;
    }

    const tokenMint = this.extractTokenMint(logs, joined);
    const amountMatch = joined.match(/amount[:\s]+(\d{1,})/i);
    const amount = amountMatch ? Number(amountMatch[1]) : undefined;

    return {
      signature,
      timestamp: Date.now(),
      slot,
      type,
      direction,
      wallet: descriptor.kind === 'wallet' ? descriptor.key : undefined,
      tokenMint,
      tokenSymbol: tokenMint ? this.resolveSymbol(tokenMint) : undefined,
      amount,
      programId,
      confidence: descriptor.kind === 'wallet'
        ? 'MEDIUM'
        : amount !== undefined
          ? 'MEDIUM'
          : 'LOW',
      rawLogs: joined,
      metadata: {
        source: 'log_heuristic',
        providerId: this.currentProviderId ?? 'unknown',
      },
    };
  }

  private extractTokenMint(logs: string[], joined: string): string | undefined {
    const mintPatternMatch = joined.match(MINT_LOG_RE);
    if (mintPatternMatch) {
      const candidate = mintPatternMatch[1]!;
      if (!KNOWN_PROGRAMS.has(candidate)) return candidate;
    }

    const freq = new Map<string, number>();
    for (const line of logs) {
      PUBKEY_RE.lastIndex = 0;
      for (const candidate of line.match(PUBKEY_RE) ?? []) {
        if (!KNOWN_PROGRAMS.has(candidate)) {
          freq.set(candidate, (freq.get(candidate) ?? 0) + 1);
        }
      }
    }

    let bestMint: string | undefined;
    let bestCount = 1;
    for (const [mint, count] of freq) {
      if (count > bestCount) {
        bestCount = count;
        bestMint = mint;
      }
    }

    if (!bestMint) {
      for (const line of logs) {
        PUBKEY_RE.lastIndex = 0;
        for (const candidate of line.match(PUBKEY_RE) ?? []) {
          if (!KNOWN_PROGRAMS.has(candidate)) {
            bestMint = candidate;
            break;
          }
        }
        if (bestMint) break;
      }
    }

    return bestMint;
  }

  private handleFailure(
    reason: string,
    options: { rateLimited?: boolean } = {},
  ): void {
    const previousProviderId = this.currentProviderId;
    const currentProvider = this.rpcManager.markProviderFailure(reason, {
      providerId: this.currentProviderId ?? undefined,
      rateLimited: options.rateLimited,
    });

    if (
      previousProviderId &&
      currentProvider.id !== previousProviderId &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      this.ws.close(1012, 'provider switch');
    }
  }

  private trimDedup(): void {
    const arr = [...this.emitted];
    this.emitted.clear();
    for (const signature of arr.slice(arr.length >>> 1)) {
      this.emitted.add(signature);
    }
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  const message = String((error as any)?.message ?? '');
  return message.includes('429') || message.toLowerCase().includes('rate');
}

function priority(descriptor: SubscriptionDescriptor): number {
  return descriptor.kind === 'wallet' ? 2 : 1;
}

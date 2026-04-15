import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { type IngestionProvider, type NormalizedEvent } from './provider';

const RPC_WSS = process.env.RPC_WSS ?? 'wss://api.mainnet-beta.solana.com';

const DEX_PROGRAMS = [
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
] as const;

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const PUBKEY_RE      = /[A-HJ-NP-Za-km-z1-9]{43,44}/g;
const DEDUP_MAX      = 12_000;
const DEDUP_CLEAN_MS = 4 * 60 * 1_000;

export class PublicRPCProvider extends EventEmitter implements IngestionProvider {
  private ws:            WebSocket | null = null;
  private dedup          = new Set<string>();
  private watchedWallets = new Set<string>();
  private reconnectDelay = 1_000;
  private pingInterval:  ReturnType<typeof setInterval> | null = null;
  private cleanInterval: ReturnType<typeof setInterval> | null = null;

  connect(): void {
    this.cleanInterval = setInterval(() => this.trimDedup(), DEDUP_CLEAN_MS);
    this.openWS();
  }

  disconnect(): void {
    this.ws?.close();
    if (this.pingInterval)  clearInterval(this.pingInterval);
    if (this.cleanInterval) clearInterval(this.cleanInterval);
  }

  watchWallet(wallet: string):   void { this.watchedWallets.add(wallet);    }
  unwatchWallet(wallet: string): void { this.watchedWallets.delete(wallet); }

  // ── WebSocket lifecycle ─────────────────────────────────────────────────

  private openWS(): void {
    try { this.ws = new WebSocket(RPC_WSS); } catch { this.scheduleReconnect(); return; }

    this.ws.on('open', () => {
      console.info('[Ingestion] Connected to', RPC_WSS);
      this.reconnectDelay = 1_000;
      this.startPing();
      this.subscribeAll();
      this.emit('connected');
    });

    this.ws.on('message', (raw: Buffer | string) => {
      this.handleMessage(typeof raw === 'string' ? raw : raw.toString());
    });

    this.ws.on('close', (code) => {
      this.stopPing();
      console.warn(`[Ingestion] WS closed (${code}) — reconnecting in ${this.reconnectDelay}ms`);
      this.scheduleReconnect();
      this.emit('disconnected');
    });

    this.ws.on('error', () => {
      // 'close' fires immediately after; reconnect happens there
    });
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.openWS(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  private subscribeAll(): void {
    for (const program of [...DEX_PROGRAMS, SYSTEM_PROGRAM]) {
      this.send({
        jsonrpc: '2.0',
        id:      `sub_${program.slice(0, 8)}`,
        method:  'logsSubscribe',
        params:  [{ mentions: [program] }, { commitment: 'confirmed' }],
      });
    }
  }

  // ── Message handling ────────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.id && typeof msg.result === 'number') return;
    if (msg.method !== 'logsNotification')        return;

    const value = msg.params?.result?.value;
    if (!value || value.err) return;

    const { signature, logs } = value as { signature: string; logs: string[] };
    if (!signature || !Array.isArray(logs)) return;

    if (this.dedup.has(signature)) return;
    this.dedup.add(signature);
    if (this.dedup.size > DEDUP_MAX) this.trimDedup();

    const event = this.parse(signature, logs);
    this.emit('transaction', event);
  }

  // ── Log parsing ─────────────────────────────────────────────────────────

  private parse(signature: string, logs: string[]): NormalizedEvent {
    const joined = logs.join('\n');

    // ── Type detection ──
    let type: NormalizedEvent['type'] = 'UNKNOWN';
    let programId: string | undefined;

    for (const prog of DEX_PROGRAMS) {
      if (joined.includes(prog)) { type = 'SWAP'; programId = prog; break; }
    }
    if (type === 'UNKNOWN' && joined.includes(SYSTEM_PROGRAM)) type = 'TRANSFER';

    // ── Wallet detection (multi-pass) ──
    let wallet:     string | undefined;
    let confidence: NormalizedEvent['confidence'] = 'LOW';

    if (this.watchedWallets.size > 0) {
      // Pass 1: exact pubkey match in log lines
      outer: for (const line of logs) {
        for (const candidate of (line.match(PUBKEY_RE) ?? [])) {
          if (this.watchedWallets.has(candidate)) {
            wallet     = candidate;
            confidence = 'HIGH';
            break outer;
          }
        }
      }

      // Pass 2: prefix heuristic (first 6 chars match)
      if (!wallet) {
        outer: for (const line of logs) {
          for (const candidate of (line.match(PUBKEY_RE) ?? [])) {
            for (const watched of this.watchedWallets) {
              if (candidate.slice(0, 6) === watched.slice(0, 6)) {
                wallet     = watched;
                confidence = 'MEDIUM';
                break outer;
              }
            }
          }
        }
      }
    }

    // ── Token mint: first pubkey that isn't a known program ──
    const knownPrograms = new Set([...DEX_PROGRAMS, SYSTEM_PROGRAM]);
    let tokenMint: string | undefined;
    for (const line of logs) {
      for (const c of (line.match(PUBKEY_RE) ?? [])) {
        if (!knownPrograms.has(c)) { tokenMint = c; break; }
      }
      if (tokenMint) break;
    }

    // ── Amount ──
    const amountMatch = joined.match(/amount[:\s]+(\d{4,})/i);
    const amount      = amountMatch ? Number(amountMatch[1]) : undefined;

    // Bump confidence if we found an amount but no wallet
    if (amount && confidence === 'LOW') confidence = 'MEDIUM';

    
    return {
      signature,
      timestamp: Date.now(),
      type,
      programId,
      wallet,
      tokenMint,
      amount,
      confidence,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private trimDedup(): void {
    const arr = [...this.dedup];
    this.dedup.clear();
    for (const sig of arr.slice(arr.length >>> 1)) this.dedup.add(sig);
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
  }
}
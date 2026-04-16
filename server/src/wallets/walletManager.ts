import { Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';

interface StoredWallet {
  userId:       string;
  publicKey:    string;
  encryptedKey: string; // AES-256-CBC hex
  iv:           string; // hex
  createdAt:    number;
}

// 32-byte key from env; padded/truncated if necessary
function getEncKey(): Buffer {
  const raw = process.env.WALLET_ENCRYPTION_KEY ?? 'voluma-default-enc-key-change!!';
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
}

const TRADE_CACHE_MAX = 5_000;

export class WalletManager {
  private wallets    = new Map<string, StoredWallet>();
  // "userId:conditionId:signature" → already-submitted trade guard
  private tradeCache = new Set<string>();

  // ── Wallet lifecycle ─────────────────────────────────────────────────────────

  createWallet(userId: string): { publicKey: string } {
    // Idempotent — return existing if already created
    const existing = this.wallets.get(userId);
    if (existing) return { publicKey: existing.publicKey };

    const keypair    = Keypair.generate();
    const secretKey  = Buffer.from(keypair.secretKey);
    const iv         = crypto.randomBytes(16);
    const encKey     = getEncKey();
    const cipher     = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    const encrypted  = Buffer.concat([cipher.update(secretKey), cipher.final()]);

    this.wallets.set(userId, {
      userId,
      publicKey:    keypair.publicKey.toBase58(),
      encryptedKey: encrypted.toString('hex'),
      iv:           iv.toString('hex'),
      createdAt:    Date.now(),
    });

    return { publicKey: keypair.publicKey.toBase58() };
  }

  getPublicKey(userId: string): string | null {
    return this.wallets.get(userId)?.publicKey ?? null;
  }

  getInfo(userId: string): { publicKey: string; createdAt: number } | null {
    const w = this.wallets.get(userId);
    if (!w) return null;
    return { publicKey: w.publicKey, createdAt: w.createdAt };
  }

  hasWallet(userId: string): boolean {
    return this.wallets.has(userId);
  }

  // Never expose this method to HTTP routes — only ExecutionEngine calls it
  getKeypair(userId: string): Keypair | null {
    const w = this.wallets.get(userId);
    if (!w) return null;

    try {
      const encKey    = getEncKey();
      const iv        = Buffer.from(w.iv, 'hex');
      const decipher  = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(w.encryptedKey, 'hex')),
        decipher.final(),
      ]);
      return Keypair.fromSecretKey(new Uint8Array(decrypted));
    } catch {
      console.error('[WalletManager] Decryption failed for userId:', userId);
      return null;
    }
  }

  // ── Trade dedup guard ─────────────────────────────────────────────────────────
  // Defense-in-depth: engine.ts already dedupes via fireCache,
  // but this ensures no double-trade even under unexpected re-delivery.

  markTradeSubmitted(key: string): boolean {
    if (this.tradeCache.has(key)) return false; // already submitted → block
    this.tradeCache.add(key);
    if (this.tradeCache.size > TRADE_CACHE_MAX) this.trimTradeCache();
    return true; // first submission → allow
  }

  private trimTradeCache(): void {
    const arr = [...this.tradeCache];
    this.tradeCache.clear();
    for (const k of arr.slice(arr.length >>> 1)) this.tradeCache.add(k);
  }
}
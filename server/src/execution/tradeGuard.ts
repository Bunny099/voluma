import { Connection, PublicKey } from '@solana/web3.js';

const FEE_BUFFER_SOL  = 0.005;    
const MAX_PER_MINUTE  = 5;
const LAMPORTS        = 1_000_000_000;
const BASE58_RE       = /^[A-HJ-NP-Za-km-z1-9]{32,44}$/;

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

// ── Token balance result ──────────────────────────────────────────────────────

export interface TokenBalanceResult {
  rawBalance: bigint;
  decimals:   number;
  uiBalance:  number;
}

// ── In-memory rate limiter ────────────────────────────────────────────────────

class RateLimiter {
  private readonly windowMs = 60_000;
  private readonly max: number;
  private readonly entries = new Map<string, number[]>();

  constructor(maxPerMin = MAX_PER_MINUTE) {
    this.max = maxPerMin;
    setInterval(() => this.cleanup(), 5 * 60_000).unref();
  }

  allow(userId: string): boolean {
    const now    = Date.now();
    const cutoff = now - this.windowMs;
    const times  = (this.entries.get(userId) ?? []).filter(t => t > cutoff);
    if (times.length >= this.max) return false;
    times.push(now);
    this.entries.set(userId, times);
    return true;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [id, times] of this.entries) {
      const fresh = times.filter(t => t > cutoff);
      fresh.length ? this.entries.set(id, fresh) : this.entries.delete(id);
    }
  }
}

// ── TradeGuard ────────────────────────────────────────────────────────────────

export class TradeGuard {
  private readonly limiter = new RateLimiter();

  constructor(private readonly connection: Connection) {}
  validateMint(mint: string): GuardResult {
    if (!BASE58_RE.test(mint)) {
      return {
        allowed: false,
        reason:  `Invalid token mint "${mint.slice(0, 20)}…" — must be base58 (32–44 chars)`,
      };
    }
    return { allowed: true };
  }

  
  async checkBalance(publicKey: PublicKey, amountSol: number): Promise<GuardResult> {
    try {
      const lamports   = await this.connection.getBalance(publicKey, 'confirmed');
      const balanceSol = lamports / LAMPORTS;
      const required   = amountSol + FEE_BUFFER_SOL;
      if (balanceSol < required) {
        return {
          allowed: false,
          reason:
            `Insufficient SOL balance: ${balanceSol.toFixed(4)} SOL available, ` +
            `${required.toFixed(4)} required (trade + ${FEE_BUFFER_SOL} SOL fees)`,
        };
      }
      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Balance check failed — RPC unavailable' };
    }
  }

 
  async getTokenBalance(
    publicKey: PublicKey,
    tokenMint: string,
  ): Promise<TokenBalanceResult | null> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      const accounts   = await this.connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: mintPubkey },
        'confirmed',
      );

      if (!accounts.value.length) return null;

      let best: TokenBalanceResult | null = null;
      for (const acct of accounts.value) {
        const info      = (acct.account.data as any).parsed?.info;
        const decimals  = info?.tokenAmount?.decimals as number;
        const uiBalance = info?.tokenAmount?.uiAmount  as number | null;
        const rawStr    = info?.tokenAmount?.amount    as string | undefined;

        if (decimals === undefined || uiBalance === null || uiBalance === undefined || !rawStr) continue;

        const rawBalance = BigInt(rawStr);
        if (!best || rawBalance > best.rawBalance) {
          best = { rawBalance, decimals, uiBalance };
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  async checkTokenBalance(
    publicKey:   PublicKey,
    tokenMint:   string,
    sellPercent: number, // 0 < sellPercent <= 100
  ): Promise<GuardResult & { rawSellAmount?: bigint; decimals?: number }> {
    if (sellPercent <= 0 || sellPercent > 100) {
      return { allowed: false, reason: `Sell percentage must be between 1 and 100, got ${sellPercent}` };
    }

    const result = await this.getTokenBalance(publicKey, tokenMint);

    if (!result || result.rawBalance === 0n) {
      return {
        allowed: false,
        reason:  `No token balance found for mint ${tokenMint.slice(0, 8)}… in this wallet`,
      };
    }

    const rawSellAmount = (result.rawBalance * BigInt(Math.floor(sellPercent * 100))) / 10000n;

    if (rawSellAmount === 0n) {
      return {
        allowed: false,
        reason:  `Sell amount too small: ${sellPercent}% of ${result.uiBalance} = 0 raw units`,
      };
    }

    return {
      allowed:       true,
      rawSellAmount,
      decimals:      result.decimals,
    };
  }

  /** Per-user trade rate limit: max 5 trades per minute */
  checkRateLimit(userId: string): GuardResult {
    if (!this.limiter.allow(userId)) {
      return {
        allowed: false,
        reason:  `Rate limit: max ${MAX_PER_MINUTE} trades per minute per user`,
      };
    }
    return { allowed: true };
  }
}
import axios from 'axios';
import { TTLCache } from '../lib/ttl-cache';

export interface TokenMetadata {
  mint: string;
  symbol: string;
  name?: string;
  decimals?: number;
}

const DEFAULTS = new Map<string, TokenMetadata>([
  ['So11111111111111111111111111111111111111112', { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 }],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6 }],
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 }],
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 }],
  ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9 }],
  ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'ETH', name: 'Ether (Portal)', decimals: 8 }],
]);

const JUPITER_TOKEN_LIST = 'https://api.jup.ag/tokens/v2/tag';

export class TokenRegistry {
  private readonly cache = new TTLCache<string, TokenMetadata>(24 * 60 * 60 * 1_000, 20_000);
  private loadedAt = 0;

  constructor(private readonly jupiterHeaders: Record<string, string>) {
    for (const [mint, meta] of DEFAULTS) {
      this.cache.set(mint, meta);
    }
  }

  async warm(): Promise<void> {
    if (Date.now() - this.loadedAt < 30 * 60 * 1_000) return;

    try {
      const { data } = await axios.get<Array<{
        id: string;
        symbol: string;
        name?: string;
        decimals?: number;
      }>>(JUPITER_TOKEN_LIST, {
        params: { query: 'verified' },
        headers: this.jupiterHeaders,
        timeout: 10_000,
      });

      for (const token of data) {
        if (!token.id || !token.symbol) continue;
        this.cache.set(token.id, {
          mint: token.id,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
        });
      }

      this.loadedAt = Date.now();
    } catch (error: any) {
      console.warn('[TokenRegistry] Warm failed:', error.message);
    }
  }

  get(mint: string): TokenMetadata | undefined {
    return this.cache.get(mint);
  }

  resolveSymbol(mint: string): string {
    return this.get(mint)?.symbol ?? `${mint.slice(0, 6)}...${mint.slice(-4)}`;
  }

  remember(meta: TokenMetadata): void {
    if (!meta.mint || !meta.symbol) return;
    this.cache.set(meta.mint, meta);
  }
}

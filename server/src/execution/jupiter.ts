import axios from 'axios';
import { TTLCache } from '../lib/ttl-cache';

const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP = 'https://api.jup.ag/swap/v1/swap';

const QUOTE_CACHE_TTL_MS = 4_000;
const QUOTE_MAX_AGE_MS = Number(process.env.JUPITER_QUOTE_MAX_AGE_MS ?? 12_000);
const MAX_PRICE_IMPACT_PCT = Number(process.env.JUPITER_MAX_PRICE_IMPACT_PCT ?? 25);

export interface JupiterRouteSummary {
  hops: string[];
  percent: number[];
}

export interface ValidatedQuote {
  fetchedAt: number;
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  outAmount: number;
  priceImpactPct: number | null;
  routeSummary: JupiterRouteSummary;
  quoteResponse: any;
}

export class JupiterService {
  private readonly quoteCache = new TTLCache<string, ValidatedQuote>(QUOTE_CACHE_TTL_MS, 500);

  constructor(private readonly headers: Record<string, string>) {}

  async getValidatedQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
  }): Promise<ValidatedQuote> {
    const cacheKey = [
      params.inputMint,
      params.outputMint,
      params.amount,
      params.slippageBps,
    ].join(':');

    return this.quoteCache.getOrSet(cacheKey, async () => {
      const data = await requestWithRetry(() =>
        axios.get(JUPITER_QUOTE, {
          params: {
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            slippageBps: params.slippageBps,
            swapMode: 'ExactIn',
          },
          headers: this.headers,
          timeout: 8_000,
        }).then((response) => response.data),
      );

      const outAmount = Number(data.outAmount ?? 0);
      if (!Number.isFinite(outAmount) || outAmount <= 0) {
        throw new Error('Jupiter quote returned no output amount');
      }

      const routePlan = Array.isArray(data.routePlan) ? data.routePlan : [];
      if (!routePlan.length) {
        throw new Error('Jupiter quote returned no route');
      }

      const priceImpactPct = data.priceImpactPct != null
        ? Number(data.priceImpactPct)
        : null;

      if (
        priceImpactPct !== null &&
        Number.isFinite(priceImpactPct) &&
        priceImpactPct > MAX_PRICE_IMPACT_PCT
      ) {
        throw new Error(`Rejected quote with price impact ${priceImpactPct.toFixed(2)}%`);
      }

      return {
        fetchedAt: Date.now(),
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps,
        outAmount,
        priceImpactPct,
        routeSummary: {
          hops: routePlan.map((route: any) => route.swapInfo?.label ?? route.swapInfo?.ammKey ?? 'unknown'),
          percent: routePlan.map((route: any) => Number(route.percent ?? 0)),
        },
        quoteResponse: data,
      };
    });
  }

  assertFresh(quote: ValidatedQuote): void {
    if (Date.now() - quote.fetchedAt > QUOTE_MAX_AGE_MS) {
      throw new Error('Quote became stale before execution');
    }
  }

  async buildSwapTransaction(
    quote: ValidatedQuote,
    userPublicKey: string,
  ): Promise<string> {
    this.assertFresh(quote);

    const response = await requestWithRetry(() =>
      axios.post(JUPITER_SWAP, {
        quoteResponse: quote.quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: 'auto',
        dynamicComputeUnitLimit: true,
      }, {
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
      }).then((result) => result.data),
    );

    if (!response?.swapTransaction) {
      throw new Error('Jupiter swap transaction missing from response');
    }

    return response.swapTransaction as string;
  }
}

async function requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (!isRetryable(error) || attempt >= 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true;
  return error.response.status === 429 || error.response.status >= 500;
}

import {
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import { RPCManager } from '../rpc/rpcManager';
import { JupiterService, type JupiterRouteSummary } from './jupiter';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const CONFIRM_TIMEOUT_MS = 30_000;

export interface TradeParams {
  direction: 'BUY' | 'SELL';
  tokenMint: string;
  rawAmountIn: number;
  slippageBps: number;
}

export interface TradeResult {
  success: boolean;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  txHash?: string;
  error?: string;
  inputMint: string;
  outputMint: string;
  amountIn: number;
  outAmount?: number;
  latencyMs: number;
  confirmErr?: string;
  quoteOutAmount?: number;
  priceImpactPct?: number | null;
  slippageBps: number;
  routeSummary?: JupiterRouteSummary;
  providerLabel?: string;
  quoteFetchedAt?: number;
}

interface ConfirmResult {
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  err?: string;
}

export class TradeExecutor {
  constructor(
    private readonly rpcManager: RPCManager,
    private readonly jupiterService: JupiterService,
  ) {}

  async executeTrade(keypair: Keypair, params: TradeParams): Promise<TradeResult> {
    const start = Date.now();
    const isBuy = params.direction === 'BUY';
    const inputMint = isBuy ? SOL_MINT : params.tokenMint;
    const outputMint = isBuy ? params.tokenMint : SOL_MINT;
    const provider = this.rpcManager.getCurrentProvider();

    try {
      const quote = await this.jupiterService.getValidatedQuote({
        inputMint,
        outputMint,
        amount: params.rawAmountIn,
        slippageBps: params.slippageBps,
      });

      this.jupiterService.assertFresh(quote);
      const swapTransaction = await this.jupiterService.buildSwapTransaction(
        quote,
        keypair.publicKey.toBase58(),
      );

      const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
      tx.sign([keypair]);

      let txHash: string;
      try {
        txHash = await this.rpcManager.getHttpConnection().sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: false,
            maxRetries: 0,
          },
        );
      } catch (error: any) {
        this.rpcManager.markProviderFailure(error?.message ?? 'send_failed');
        return {
          success: false,
          status: 'FAILED',
          error: error?.message ?? 'Trade send failed',
          inputMint,
          outputMint,
          amountIn: params.rawAmountIn,
          latencyMs: Date.now() - start,
          quoteOutAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          slippageBps: params.slippageBps,
          routeSummary: quote.routeSummary,
          providerLabel: provider.label,
          quoteFetchedAt: quote.fetchedAt,
        };
      }

      const confirm = await this.confirmWithTimeout(txHash);
      if (confirm.status === 'CONFIRMED') {
        this.rpcManager.markProviderSuccess(undefined, provider.id);
      }

      return {
        success: confirm.status !== 'FAILED',
        status: confirm.status,
        txHash,
        inputMint,
        outputMint,
        amountIn: params.rawAmountIn,
        outAmount: quote.outAmount,
        latencyMs: Date.now() - start,
        confirmErr: confirm.err,
        error: confirm.status === 'FAILED' ? confirm.err : undefined,
        quoteOutAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        slippageBps: params.slippageBps,
        routeSummary: quote.routeSummary,
        providerLabel: provider.label,
        quoteFetchedAt: quote.fetchedAt,
      };
    } catch (error: any) {
      const message =
        error?.response?.data?.error ??
        error?.response?.data?.message ??
        error?.message ??
        'Trade execution failed';

      return {
        success: false,
        status: 'FAILED',
        error: message,
        inputMint,
        outputMint,
        amountIn: params.rawAmountIn,
        latencyMs: Date.now() - start,
        slippageBps: params.slippageBps,
        providerLabel: provider.label,
      };
    }
  }

  private async confirmWithTimeout(txHash: string): Promise<ConfirmResult> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const status = await this.rpcManager.getHttpConnection().getSignatureStatus(txHash, {
          searchTransactionHistory: true,
        });

        const confirmation = status?.value?.confirmationStatus;
        if (confirmation === 'confirmed' || confirmation === 'finalized') {
          return { status: 'CONFIRMED' };
        }
        if (status?.value?.err) {
          return {
            status: 'FAILED',
            err: `On-chain failure: ${JSON.stringify(status.value.err)}`,
          };
        }
      } catch (error: any) {
        this.rpcManager.markProviderFailure(error?.message ?? 'confirm_status_failed');
      }

      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }

    return { status: 'PENDING', err: 'Confirmation timed out' };
  }
}

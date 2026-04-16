import axios from 'axios';
import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';

const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP  = 'https://quote-api.jup.ag/v6/swap';
const SOL_MINT      = 'So11111111111111111111111111111111111111112';
const LAMPORTS      = 1_000_000_000;

// How long to poll for confirmation
const CONFIRM_TIMEOUT_MS = 30_000;

export interface TradeParams {
  direction:   'BUY' | 'SELL';
  tokenMint:   string;
  amountSol:   number;    // BUY: SOL to spend; SELL: SOL to receive (ExactOut)
  slippageBps: number;    // default 100 = 1%
}

export interface TradeResult {
  success:   boolean;
  txHash?:   string;
  error?:    string;
  inputMint:  string;
  outputMint: string;
  amountIn:   number;   // lamports
  latencyMs:  number;
}

export class TradeExecutor {
  private connection: Connection;

  constructor() {
    const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpc, 'confirmed');
  }

  async executeTrade(keypair: Keypair, params: TradeParams): Promise<TradeResult> {
    const start = Date.now();

    // BUY  → ExactIn:  spend amountSol SOL, receive token
    // SELL → ExactOut: spend token,     receive amountSol SOL
    const isBuy      = params.direction === 'BUY';
    const inputMint  = isBuy ? SOL_MINT : params.tokenMint;
    const outputMint = isBuy ? params.tokenMint : SOL_MINT;
    const swapMode   = isBuy ? 'ExactIn' : 'ExactOut';
    const amountIn   = Math.floor(params.amountSol * LAMPORTS);

    try {
      // ── Step 1: Get quote ─────────────────────────────────────────────────
      const quoteRes = await axios.get(JUPITER_QUOTE, {
        params: {
          inputMint,
          outputMint,
          amount:      amountIn,
          slippageBps: params.slippageBps,
          swapMode,
        },
        timeout: 8_000,
      });

      const quoteResponse = quoteRes.data;

      // ── Step 2: Get serialized swap transaction from Jupiter ──────────────
      const swapRes = await axios.post(JUPITER_SWAP, {
        quoteResponse,
        userPublicKey:              keypair.publicKey.toBase58(),
        wrapAndUnwrapSol:           true,
        prioritizationFeeLamports:  'auto',
        dynamicComputeUnitLimit:    true,
      }, {
        timeout: 10_000,
        headers: { 'Content-Type': 'application/json' },
      });

      const { swapTransaction } = swapRes.data as { swapTransaction: string };

      // ── Step 3: Deserialize → sign ────────────────────────────────────────
      const txBuffer = Buffer.from(swapTransaction, 'base64');
      const tx       = VersionedTransaction.deserialize(txBuffer);
      tx.sign([keypair]);

      // ── Step 4: Send — point of no return (no retry after this) ──────────
      const txHash = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries:    0, // We handle confirmation ourselves
      });

      // ── Step 5: Confirm ───────────────────────────────────────────────────
      await this.confirmWithTimeout(txHash);

      return {
        success:   true,
        txHash,
        inputMint,
        outputMint,
        amountIn,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      // Classify the error clearly
      const message = err?.response?.data?.error
        ?? err?.response?.data?.message
        ?? err?.message
        ?? 'Trade execution failed';

      console.error('[TradeExecutor] Failed:', {
        direction: params.direction,
        tokenMint: params.tokenMint,
        error:     message,
      });

      return {
        success:   false,
        error:     message,
        inputMint,
        outputMint,
        amountIn,
        latencyMs: Date.now() - start,
      };
    }
  }

  private async confirmWithTimeout(txHash: string): Promise<void> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(txHash, {
        searchTransactionHistory: false,
      });

      const conf = status?.value?.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized') return;
      if (status?.value?.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
      }

      await new Promise(r => setTimeout(r, 1_200));
    }

    throw new Error(`Confirmation timeout after ${CONFIRM_TIMEOUT_MS / 1000}s — tx may still land: ${txHash}`);
  }
}
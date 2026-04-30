import axios from 'axios';
import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';

const JUPITER_QUOTE      = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP       = 'https://quote-api.jup.ag/v6/swap';
const SOL_MINT           = 'So11111111111111111111111111111111111111112';
const LAMPORTS           = 1_000_000_000;
const CONFIRM_TIMEOUT_MS = 30_000;

export interface TradeParams {
  direction:   'BUY' | 'SELL';
  tokenMint:   string;
  rawAmountIn: number;
  slippageBps: number;
}

export interface TradeResult {
  success:         boolean;
  txHash?:         string;
  error?:          string;
  inputMint:       string;
  outputMint:      string;
  amountIn:        number;
  outAmount?:      number;
  latencyMs:       number;
  pending?:        boolean;
  confirmErr?:     string;
}


interface ConfirmResult {
  confirmed: boolean;
  err?:     string;
}

export class TradeExecutor {
  constructor(private readonly connection: Connection) {}

  async executeTrade(keypair: Keypair, params: TradeParams): Promise<TradeResult> {
    const start      = Date.now();
    const isBuy      = params.direction === 'BUY';
    const inputMint  = isBuy ? SOL_MINT        : params.tokenMint;
    const outputMint = isBuy ? params.tokenMint : SOL_MINT;
    const swapMode = 'ExactIn';
    const amountIn = params.rawAmountIn;

    try {
    
      const { data: quoteResponse } = await axios.get(JUPITER_QUOTE, {
        params: {
          inputMint,
          outputMint,
          amount:      amountIn,
          slippageBps: params.slippageBps,
          swapMode,
        },
        timeout: 8_000,
      });

      
      const outAmount: number = Number(quoteResponse.outAmount ?? 0);

      
      const { data: { swapTransaction } } = await axios.post(JUPITER_SWAP, {
        quoteResponse,
        userPublicKey:             keypair.publicKey.toBase58(),
        wrapAndUnwrapSol:          true,
        prioritizationFeeLamports: 'auto',
        dynamicComputeUnitLimit:   true,
      }, { timeout: 10_000, headers: { 'Content-Type': 'application/json' } });

  
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
      tx.sign([keypair]);

      
      const txHash = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries:    0,
      });

      const confirm = await this.confirmWithTimeout(txHash);

      return {
        success:   true,  
        txHash,
        inputMint,
        outputMint,
        amountIn,
        outAmount,
        latencyMs: Date.now() - start,
        pending:   !confirm.confirmed,
        confirmErr: confirm.err,
      };
    } catch (err: any) {
      const message =
        err?.response?.data?.error ??
        err?.response?.data?.message ??
        err?.message ??
        'Trade execution failed';

      console.error('[TradeExecutor] Failed:', {
        direction: params.direction,
        tokenMint: params.tokenMint,
        amountIn,
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

  private async confirmWithTimeout(txHash: string): Promise<ConfirmResult> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(txHash, {
        searchTransactionHistory: false,
      });
      const conf = status?.value?.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized') return { confirmed: true };
      if (status?.value?.err)
        return { confirmed: false, err: `On-chain failure: ${JSON.stringify(status.value.err)}` };
      await new Promise(r => setTimeout(r, 1_200));
    }

    return { confirmed: false };
  }
}
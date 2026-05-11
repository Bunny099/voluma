import 'dotenv/config';
import Fastify from 'fastify';
import cors    from '@fastify/cors';
import axios   from 'axios';
import { createServer }       from 'http';
import { Connection, PublicKey } from '@solana/web3.js';
import { z }       from 'zod';
import { nanoid }  from 'nanoid';

import { PublicRPCProvider } from './ingestion/public-rpc-provider';
import { ConditionEngine }   from './conditions/engine';
import { ExecutionEngine }   from './execution/executor';
import { TradeExecutor }     from './execution/tradeExecutor';
import { TradeGuard }        from './execution/tradeGuard';
import { BroadcastServer }   from './ws/broadcast';
import { EventQueue }        from './queue/in-memory-queue';
import { WalletManager }     from './wallets/walletManager';
import { conditionRepo }     from './db/conditionRepo';
import { statsRepo }         from './db/statsRepo';
import { pendingTxRepo }     from './db/pendingTxRepo';
import { processedEventRepo } from './db/processedEventRepo';
import { type NormalizedEvent } from './ingestion/provider';
import { type Condition }       from './conditions/types';

// ── Startup validation ────────────────────────────────────────────────────────

const ENC_KEY = process.env.WALLET_ENCRYPTION_KEY ?? '';
if (ENC_KEY.length < 32) {
  console.error('FATAL: WALLET_ENCRYPTION_KEY must be ≥32 chars. Set it in server/.env');
  process.exit(1);
}

const JUPITER_API_KEY = process.env.JUPITER_API_KEY ?? '';
const JUPITER_HEADERS = JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {};
const JUPITER_TOKEN_LIST = 'https://api.jup.ag/tokens/v2/tag';
const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';
const symbolCache = new Map<string, string>([
  ['So11111111111111111111111111111111111111112',    'SOL'],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  'USDT'],
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK'],
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  'JUP'],
  ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  'mSOL'],
  ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',  'ETH'],
]);

async function loadJupiterTokenList(): Promise<void> {
  try {
    const { data } = await axios.get<{ id: string; symbol: string }[]>(
      JUPITER_TOKEN_LIST,
      {
        params:  { query: 'verified' },
        headers: JUPITER_HEADERS,
        timeout: 10_000,
      },
    );
    let loaded = 0;
    for (const t of data) {
      if (t.id && t.symbol && !symbolCache.has(t.id)) {
        symbolCache.set(t.id, t.symbol);
        loaded++;
      }
    }
    console.info(`[TokenList] Loaded ${loaded} symbols from Jupiter (total ${symbolCache.size})`);
  } catch (err: any) {
    console.warn('[TokenList] Failed to load Jupiter token list:', err.message);
  }
}


export function resolveSymbol(mint: string): string {
  const cached = symbolCache.get(mint);
  if (cached) return cached;
  // Fallback: first 6 chars + last 4 — better than "UNKNOWN"
  return `${mint.slice(0, 6)}…${mint.slice(-4)}`;
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const ActionSchema = z.object({
  type:             z.enum(['NOTIFY', 'WEBHOOK', 'LOG', 'TRADE']),
  webhookUrl:       z.string().url().optional(),
  tradeDirection:   z.enum(['BUY', 'SELL']).optional(),
  tradeTokenMint:   z.string().min(32).max(44).optional(),
  tradeAmountSol:   z.number().positive().max(100).optional(),
  tradeSellPercent: z.number().min(1).max(100).optional(),
  tradeSlippageBps: z.number().min(0).max(5000).optional(),
}).refine(
  a => {
    if (a.type !== 'TRADE') return true;
    if (!a.tradeDirection || !a.tradeTokenMint) return false;
    if (a.tradeDirection === 'BUY') return !!a.tradeAmountSol && a.tradeAmountSol > 0;
    return (!!a.tradeSellPercent && a.tradeSellPercent > 0) ||
           (!!a.tradeAmountSol   && a.tradeAmountSol >= 1 && a.tradeAmountSol <= 100);
  },
  {
    message:
      'TRADE requires tradeDirection + tradeTokenMint. ' +
      'BUY needs tradeAmountSol > 0. ' +
      'SELL needs tradeSellPercent (1–100).',
  },
);

const ConditionSchema = z.object({
  id:                     z.string().default(() => nanoid()),
  userId:                 z.string().min(1),
  name:                   z.string().min(1),
  type:                   z.enum(['WALLET_ACTIVITY', 'SWAP_BURST', 'TOKEN_VOLUME', 'LARGE_TRANSFER']),
  enabled:                z.boolean().default(true),
  wallet:                 z.string().optional(),
  transactionType:        z.enum(['BUY', 'SELL', 'TRANSFER', 'ANY']).optional(),
  minAmountSol:           z.number().optional(),
  tokenMint:              z.string().optional(),
  minSwaps:               z.number().optional(),
  minVolumeSol:           z.number().optional(),
  windowSeconds:          z.number().min(5).max(3600).optional(),
  minSol:                 z.number().optional(),
  actions:                z.array(ActionSchema).min(1),
  cooldownSeconds:        z.number().min(0).default(60),
  createdAt:              z.number().default(() => Date.now()),
  maxExecutions:          z.number().int().positive().optional(),
  allowRepeatedExecution: z.boolean().optional(),
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export async function bootstrap() {
  let droppedEvents    = 0;
  let totalEvents      = 0;
  let totalExecutions  = 0;
  let failedExecutions = 0;

  const conditionStore = new Map<string, Condition>();
  const watchedWallets = new Set<string>();
  const triggerStats   = new Map<string, { count: number; lastTriggered: number }>();

  const rpcUrl    = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const conditionEngine = new ConditionEngine();
  const walletManager   = new WalletManager(connection);
  const tradeExecutor   = new TradeExecutor(connection);
  const tradeGuard      = new TradeGuard(connection);

  const httpServer = createServer();
  const app = Fastify({
    logger: { level: 'warn' },
    serverFactory: (handler) => { httpServer.on('request', handler); return httpServer; },
  });

  await app.register(cors, {
    origin:         process.env.FRONTEND_URL ?? true,
    methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials:    true,
  });

  const broadcast = new BroadcastServer(httpServer);
  const executionEngine = new ExecutionEngine(
    (userId, payload) => {
      const p = payload as any;
      broadcast.sendToUser(userId, { type: 'TRIGGER', ...p });


      if (p.execution?.actions) {
        for (const action of p.execution.actions as any[]) {
          if (action.type !== 'TRADE') continue;
          if (action.status === 'success') {
            broadcast.sendToUser(userId, {
              type:        'TRADE_SUCCESS',
              conditionId: p.conditionId,
              txHash:      action.tradeResult?.txHash,
              inputMint:   action.tradeResult?.inputMint,
              outputMint:  action.tradeResult?.outputMint,
              amountIn:    action.tradeResult?.amountIn,
              latencyMs:   action.tradeResult?.latencyMs,
            });
          } else if (action.status === 'failed') {
            broadcast.sendToUser(userId, {
              type:        'TRADE_FAILED',
              conditionId: p.conditionId,
              error:       action.error ?? 'Trade failed',
              errorType:   action.errorType,
            });
          }
        }
      }
    },
    walletManager,
    tradeExecutor,
    tradeGuard,
  );

  for (const cond of conditionRepo.getAll()) {
    conditionStore.set(cond.id, cond);
    conditionEngine.load(cond);
    if (cond.wallet) watchedWallets.add(cond.wallet);
  }

  for (const s of statsRepo.getAll()) {
    triggerStats.set(s.conditionId, { count: s.triggerCount, lastTriggered: s.lastTriggered ?? 0 });
  }

  console.info(`[Startup] ${conditionStore.size} conditions, ${triggerStats.size} stat records loaded`);
  loadJupiterTokenList().catch(() => {});

  // ── Event queue ───────────────────────────────────────────────────────────

  const queue = new EventQueue<NormalizedEvent>(
    async (event) => {
      const matches = await conditionEngine.evaluate(event);
      if (!matches.length) return;

      for (const m of matches) {
        const prev = triggerStats.get(m.condition.id) ?? { count: 0, lastTriggered: 0 };
        triggerStats.set(m.condition.id, { count: prev.count + 1, lastTriggered: m.matchedAt });
        statsRepo.increment(m.condition.id, m.matchedAt);
      }

      const results = await executionEngine.execute(matches);
      for (const r of results) {
        totalExecutions  += r.summary.total;
        failedExecutions += r.summary.failed;
      }
    },
    5_000, 20,
  );


  async function checkPendingTxs(): Promise<void> {
    const pending = pendingTxRepo.getPending(50);
    for (const tx of pending) {
      const sig = await connection.getSignatureStatus(tx.txHash, {
        searchTransactionHistory: true,
      });
      const status = sig?.value?.confirmationStatus;
      const hasErr = !!sig?.value?.err;

      if (!hasErr && (status === 'finalized' || status === 'confirmed')) {
        pendingTxRepo.updateConfirmed(tx.txHash);
        if (tx.userId) {
          broadcast.sendToUser(tx.userId, {
            type:    'TRADE_CONFIRMED',
            txHash:  tx.txHash,
            inputMint:  tx.inputMint,
            outputMint: tx.outputMint,
            amountIn:   tx.rawAmountIn,
          });
        }
        console.info(`[PendingTx] Confirmed: ${tx.txHash}`);
      } else if (hasErr) {
        pendingTxRepo.updateFailed(tx.txHash);
        if (tx.userId) {
          broadcast.sendToUser(tx.userId, {
            type:      'TRADE_FAILED',
            txHash:    tx.txHash,
            error:     'Transaction failed on-chain',
            errorType: 'trade_error',
          });
        }
        console.warn(`[PendingTx] On-chain failure: ${tx.txHash}`);
      } else if (Date.now() - tx.createdAt > 5 * 60 * 1000) {
        pendingTxRepo.updateFailed(tx.txHash);
        if (tx.userId) {
          broadcast.sendToUser(tx.userId, {
            type:      'TRADE_FAILED',
            txHash:    tx.txHash,
            error:     'Transaction abandoned after 5-minute confirmation timeout',
            errorType: 'timeout',
          });
        }
        console.warn(`[PendingTx] Abandoned: ${tx.txHash}`);
      }
    }
  }

  setInterval(() => { checkPendingTxs().catch(e => console.error('[PendingTx]', e)); }, 15_000);

  function runCleanup(): void {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const fiveMinAgo  = Date.now() - 5 * 60 * 1000;
    const processedDeleted = processedEventRepo.cleanup(twoHoursAgo);
    const pendingDeleted  = pendingTxRepo.cleanup(fiveMinAgo);
    if (processedDeleted > 0 || pendingDeleted > 0) {
      console.info(`[Cleanup] Processed events: ${processedDeleted}, Pending txs: ${pendingDeleted} deleted`);
    }
  }

  runCleanup();
  setInterval(() => { runCleanup(); }, 30 * 60 * 1000);

  // ── Ingestion ─────────────────────────────────────────────────────────────

  const provider = new PublicRPCProvider();
  for (const wallet of watchedWallets) provider.watchWallet(wallet);
  provider.on('transaction', (event: NormalizedEvent) => {
    totalEvents++;
    setImmediate(() => {
      if (!queue.push(event)) {
        droppedEvents++;
        if (droppedEvents % 100 === 0)
          console.warn(`[Queue] DROPPED_EVENT total=${droppedEvents} queueDepth=${queue.depth}`);
      }
    });
    if (totalEvents % 20 === 0) {
      broadcast.broadcast({
        type: 'LIVE_EVENT', signature: event.signature,
        eventType: event.type, tokenMint: event.tokenMint, timestamp: event.timestamp,
      });
    }
  });

  provider.on('connected',    () => console.info('[Ingestion] Stream live'));
  provider.on('disconnected', () => console.warn('[Ingestion] Stream down — reconnecting'));
  provider.connect();

  // ── Wallet routes ─────────────────────────────────────────────────────────

  app.get<{ Params: { userId: string } }>('/wallet/:userId', async (req, reply) => {
    const info = await walletManager.getWalletInfo(req.params.userId);
    // Fix 4: enrich token symbols using the Jupiter-backed symbolCache
    if (info?.tokens) {
      for (const t of info.tokens) {
        if (t.symbol === 'UNKNOWN' || !t.symbol) {
          t.symbol = resolveSymbol(t.mint);
        }
      }
    }
    return reply.send(info);
  });

  app.post<{ Params: { userId: string } }>('/wallet/:userId/create', async (req, reply) => {
    return reply.code(201).send(walletManager.createWallet(req.params.userId));
  });

  app.post<{
    Params: { userId: string };
    Body:   { destinationAddress: string; amountSol: number };
  }>('/wallet/:userId/withdraw/sol', async (req, reply) => {
    const { userId } = req.params;
    const { destinationAddress, amountSol } = req.body ?? {};

    if (!destinationAddress || !amountSol || amountSol <= 0)
      return reply.code(400).send({ error: 'destinationAddress and amountSol (> 0) required' });

    try { new PublicKey(destinationAddress); }
    catch { return reply.code(400).send({ error: 'Invalid destination address' }); }

    const keypair = walletManager.getKeypair(userId);
    if (!keypair) return reply.code(404).send({ error: 'No trading wallet found' });

    const balCheck = await tradeGuard.checkBalance(keypair.publicKey, amountSol);
    if (!balCheck.allowed) return reply.code(400).send({ error: balCheck.reason });

    try {
      const result = await walletManager.withdrawSOL(userId, destinationAddress, amountSol);
      if (result.status === 'PENDING') {
        broadcast.sendToUser(userId, {
          type:      'TRADE_PENDING',
          txHash:    result.txHash,
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: destinationAddress,
          amountIn:  Math.floor(amountSol * 1_000_000_000),
          manual:    true,
        });
        return reply.code(202).send({ status: 'PENDING', txHash: result.txHash, message: 'Withdrawal submitted — awaiting confirmation' });
      }
      return reply.send(result);
    } catch (err: any) {
      return reply.code(500).send({ error: err.message ?? 'Withdrawal failed' });
    }
  });

  app.post<{
    Params: { userId: string };
    Body:   { destinationAddress: string; tokenMint: string; uiAmount: number };
  }>('/wallet/:userId/withdraw/token', async (req, reply) => {
    const { userId } = req.params;
    const { destinationAddress, tokenMint, uiAmount } = req.body ?? {};

    if (!destinationAddress || !tokenMint || !uiAmount || uiAmount <= 0)
      return reply.code(400).send({ error: 'destinationAddress, tokenMint, and uiAmount (> 0) required' });

    try { new PublicKey(destinationAddress); }
    catch { return reply.code(400).send({ error: 'Invalid destination address' }); }

    try { new PublicKey(tokenMint); }
    catch { return reply.code(400).send({ error: 'Invalid token mint address' }); }

    const keypair = walletManager.getKeypair(userId);
    if (!keypair) return reply.code(404).send({ error: 'No trading wallet found' });

    const tokenBal = await tradeGuard.getTokenBalance(keypair.publicKey, tokenMint);
    if (!tokenBal || tokenBal.uiBalance <= 0) {
      return reply.code(400).send({ error: `No balance for token ${tokenMint.slice(0, 8)}… in this wallet` });
    }
    if (uiAmount > tokenBal.uiBalance) {
      return reply.code(400).send({
        error: `Insufficient token balance: have ${tokenBal.uiBalance}, requested ${uiAmount}`,
      });
    }

    try {
      const result = await walletManager.withdrawToken(userId, destinationAddress, tokenMint, uiAmount);
      if (result.status === 'PENDING') {
        broadcast.sendToUser(userId, {
          type:      'TRADE_PENDING',
          txHash:    result.txHash,
          inputMint: tokenMint,
          outputMint: destinationAddress,
          amountIn:  0,  
          manual:    true,
        });
        return reply.code(202).send({ status: 'PENDING', txHash: result.txHash, message: 'Token withdrawal submitted — awaiting confirmation' });
      }
      return reply.send(result);
    } catch (err: any) {
      return reply.code(500).send({ error: err.message ?? 'Token withdrawal failed' });
    }
  });
  app.get<{
    Querystring: { inputMint: string; outputMint: string; amount: string; slippageBps?: string };
  }>('/trade/quote', async (req, reply) => {
    const { inputMint, outputMint, amount, slippageBps } = req.query;

    if (!inputMint || !outputMint || !amount)
      return reply.code(400).send({ error: 'inputMint, outputMint, and amount are required' });

    const rawAmount = parseInt(amount, 10);
    if (isNaN(rawAmount) || rawAmount <= 0)
      return reply.code(400).send({ error: 'amount must be a positive integer (raw units)' });

    try {
      const { data } = await axios.get(JUPITER_QUOTE, {
        params: {
          inputMint,
          outputMint,
          amount:      rawAmount,
          slippageBps: slippageBps ? parseInt(slippageBps, 10) : 100,
          swapMode:    'ExactIn',
        },
        headers: JUPITER_HEADERS,
        timeout: 8_000,
      });

      const outAmount = Number(data.outAmount ?? 0);

      if (!outAmount) {
        return reply.code(422).send({ error: 'Token not tradable / no liquidity on Jupiter' });
      }

      return reply.send({
        expectedOutput: outAmount,
        inputMint,
        outputMint,
        inAmount:       rawAmount,
        priceImpactPct: data.priceImpactPct ?? null,
      });
    } catch (err: any) {
      const jupiterErr =
        err?.response?.data?.error ??
        err?.response?.data?.message ??
        err?.message;
      if (err?.response?.status === 400) {
        return reply.code(422).send({ error: 'Token not tradable / no liquidity on Jupiter' });
      }
      return reply.code(502).send({ error: `Jupiter quote failed: ${jupiterErr}` });
    }
  });

  
  const LAMPORTS_PER_SOL = 1_000_000_000;

  app.post<{
    Body: {
      userId:    string;
      direction: 'BUY' | 'SELL';
      tokenMint: string;
      percent?:  number;   // SELL: percentage of balance (1-100)
      amountSol?: number;  // BUY: SOL amount to spend
      slippageBps?: number;
    };
  }>('/trade/manual', async (req, reply) => {
    const { userId, direction, tokenMint, percent, amountSol, slippageBps } = req.body ?? {};

    if (!userId || !direction || !tokenMint)
      return reply.code(400).send({ error: 'userId, direction, and tokenMint are required' });

    // Validate mint address format
    const mintCheck = tradeGuard.validateMint(tokenMint);
    if (!mintCheck.allowed)
      return reply.code(400).send({ error: mintCheck.reason });

    const keypair = walletManager.getKeypair(userId);
    if (!keypair) return reply.code(404).send({ error: 'No trading wallet found' });

    // Rate limit
    const rateCheck = tradeGuard.checkRateLimit(userId);
    if (!rateCheck.allowed) return reply.code(429).send({ error: rateCheck.reason });

    let rawAmountIn: number;

    if (direction === 'BUY') {
      if (!amountSol || amountSol <= 0)
        return reply.code(400).send({ error: 'BUY requires amountSol > 0' });

      const balCheck = await tradeGuard.checkBalance(keypair.publicKey, amountSol);
      if (!balCheck.allowed) return reply.code(400).send({ error: balCheck.reason });

      rawAmountIn = Math.floor(amountSol * LAMPORTS_PER_SOL);

    } else {
      // SELL
      if (!percent || percent < 1 || percent > 100)
        return reply.code(400).send({ error: 'SELL requires percent between 1 and 100' });

      const tokenCheck = await tradeGuard.checkTokenBalance(keypair.publicKey, tokenMint, percent);
      if (!tokenCheck.allowed) return reply.code(400).send({ error: tokenCheck.reason });

      rawAmountIn = Number(tokenCheck.rawSellAmount!);
    }

    // Token tradability check via Jupiter quote before executing
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const inputMint  = direction === 'BUY' ? SOL_MINT : tokenMint;
    const outputMint = direction === 'BUY' ? tokenMint : SOL_MINT;

    try {
      const { data: quoteData } = await axios.get(JUPITER_QUOTE, {
        params: { inputMint, outputMint, amount: rawAmountIn, slippageBps: slippageBps ?? 100, swapMode: 'ExactIn' },
        headers: JUPITER_HEADERS,
        timeout: 8_000,
      });
      if (!Number(quoteData.outAmount ?? 0)) {
        return reply.code(422).send({ error: 'Token not tradable / no liquidity on Jupiter' });
      }
    } catch (err: any) {
      if (err?.response?.status === 400) {
        return reply.code(422).send({ error: 'Token not tradable / no liquidity on Jupiter' });
      }
      return reply.code(502).send({ error: 'Jupiter quote check failed — try again' });
    }

    // Dedup guard
    const tradeKey = `manual:${userId}:${tokenMint}:${Date.now()}`;
    if (!walletManager.markTradeSubmitted(tradeKey))
      return reply.code(429).send({ error: 'Duplicate trade blocked' });

    const result = await tradeExecutor.executeTrade(keypair, {
      direction,
      tokenMint,
      rawAmountIn,
      slippageBps: slippageBps ?? 100,
    });

    if (!result.success) {
      broadcast.sendToUser(userId, {
        type:      'TRADE_FAILED',
        error:     result.error ?? 'Trade failed',
        errorType: 'trade_error',
        manual:    true,
      });
      return reply.code(500).send({ error: result.error ?? 'Trade failed' });
    }

    if (result.pending) {
      pendingTxRepo.insert(
        result.txHash!,
        userId,
        null,
        rawAmountIn,
        inputMint,
        outputMint,
      );
      broadcast.sendToUser(userId, {
        type:      'TRADE_PENDING',
        txHash:    result.txHash,
        inputMint: result.inputMint,
        outputMint: result.outputMint,
        amountIn:  result.amountIn,
        latencyMs: result.latencyMs,
        manual:    true,
      });
      return reply.code(202).send({
        status:   'PENDING',
        txHash:   result.txHash,
        message:  'Transaction submitted — awaiting confirmation',
      });
    }

    // Confirmed successfully
    broadcast.sendToUser(userId, {
      type:      'TRADE_SUCCESS',
      txHash:    result.txHash,
      inputMint: result.inputMint,
      outputMint: result.outputMint,
      amountIn:  result.amountIn,
      latencyMs: result.latencyMs,
      manual:    true,
    });

    return reply.send({
      txHash:    result.txHash,
      inputMint: result.inputMint,
      outputMint: result.outputMint,
      amountIn:  result.amountIn,
      outAmount: result.outAmount,
      latencyMs: result.latencyMs,
    });
  });

  // ── Condition routes ───────────────────────────────────────────────────────

  app.post('/conditions', async (req, reply) => {
    const parsed = ConditionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const cond = parsed.data as Condition;

    if (cond.actions.some(a => a.type === 'TRADE')) {
      if (!walletManager.hasWallet(cond.userId)) {
        return reply.code(400).send({
          error: 'A trading wallet is required before creating TRADE automations. Go to the Wallet tab and create one first.',
        });
      }

      for (const action of cond.actions) {
        if (action.type !== 'TRADE' || !action.tradeTokenMint) continue;

        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const LAMPORTS = 1_000_000_000;
        const testAmount = action.tradeDirection === 'BUY'
          ? Math.floor((action.tradeAmountSol ?? 0.001) * LAMPORTS)
          : 1_000_000; // small test amount for SELL validation

        const inputMint  = action.tradeDirection === 'BUY' ? SOL_MINT : action.tradeTokenMint;
        const outputMint = action.tradeDirection === 'BUY' ? action.tradeTokenMint : SOL_MINT;

        try {
          const { data } = await axios.get(JUPITER_QUOTE, {
            params: { inputMint, outputMint, amount: testAmount, slippageBps: 100, swapMode: 'ExactIn' },
            headers: JUPITER_HEADERS,
            timeout: 6_000,
          });
          if (!Number(data.outAmount ?? 0)) {
            return reply.code(400).send({ error: `Token ${action.tradeTokenMint.slice(0,8)}… is not tradable / has no liquidity on Jupiter` });
          }
        } catch (err: any) {
          if (err?.response?.status === 400) {
            return reply.code(400).send({ error: `Token ${action.tradeTokenMint.slice(0,8)}… is not tradable / has no liquidity on Jupiter` });
          }
          console.warn('[Conditions] Jupiter validation skipped (non-400):', err.message);
        }
      }
    }

    conditionRepo.save(cond);
    conditionStore.set(cond.id, cond);
    conditionEngine.load(cond);

    if (cond.wallet) {
      watchedWallets.add(cond.wallet);
      provider.watchWallet(cond.wallet);
    }

    return reply.code(201).send({ id: cond.id });
  });

  app.get<{ Params: { userId: string } }>('/conditions/:userId', async (req, reply) => {
    const conditions = [...conditionStore.values()]
      .filter(c => c.userId === req.params.userId)
      .map(c => {
        const s    = triggerStats.get(c.id);
        const exec = conditionRepo.getExecutionCount(c.id);
        return {
          ...c,
          triggerCount:   s?.count ?? 0,
          lastTriggered:  s?.lastTriggered ?? null,
          executionCount: exec,
        };
      });
    return reply.send(conditions);
  });

  app.delete<{ Params: { id: string } }>('/conditions/:id', async (req, reply) => {
    const cond = conditionStore.get(req.params.id);
    if (!cond) return reply.code(404).send({ error: 'not found' });

    conditionRepo.delete(req.params.id);
    statsRepo.delete(req.params.id);
    conditionEngine.unload(req.params.id);
    conditionStore.delete(req.params.id);
    triggerStats.delete(req.params.id);

    if (cond.wallet) {
      const stillNeeded = [...conditionStore.values()].some(c => c.wallet === cond.wallet);
      if (!stillNeeded) { watchedWallets.delete(cond.wallet); provider.unwatchWallet(cond.wallet); }
    }

    return reply.send({ ok: true });
  });

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/conditions/:id/toggle', async (req, reply) => {
      const cond = conditionStore.get(req.params.id);
      if (!cond) return reply.code(404).send({ error: 'not found' });
      cond.enabled = req.body.enabled;
      conditionRepo.save(cond);
      conditionEngine.unload(cond.id);
      conditionEngine.load(cond);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: { url?: string } }>('/webhook/test', async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url) return reply.code(400).send({ error: 'url required' });
    const start = Date.now();
    try {
      const res = await axios.post(url, {
        test: true, source: 'voluma', timestamp: Date.now(),
        explanation: { reason: 'Test delivery from Voluma', confidence: 'HIGH' },
      }, { timeout: 5_000, validateStatus: () => true });
      return reply.send({ success: res.status < 400, statusCode: res.status, durationMs: Date.now() - start });
    } catch (err: any) {
      return reply.send({ success: false, durationMs: Date.now() - start, error: err.message });
    }
  });

  app.get('/stats', async (_req, reply) => {
    const successRate = totalExecutions > 0
      ? +((totalExecutions - failedExecutions) / totalExecutions).toFixed(4)
      : 1;

    return reply.send({
      queueDepth:       queue.depth,
      queueInFlight:    queue.inFlight,
      activeConditions: conditionStore.size,
      watchedWallets:   watchedWallets.size,
      wsConnections:    broadcast.connectionCount,
      uptimeSeconds:    Math.floor(process.uptime()),
      totalEvents,
      droppedEvents,
      dropRate:         totalEvents ? +(droppedEvents / totalEvents).toFixed(4) : 0,
      totalExecutions,
      failedExecutions,
      tradeSuccessRate: successRate,
    });
  });

  // ── Start ─────────────────────────────────────────────────────────────────

  await app.ready();
  const port = Number(process.env.PORT ?? 3001);
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', resolve);
    httpServer.once('error', reject);
  });

  console.log(`Voluma running on :${port}`);
}

bootstrap().catch(err => { console.error('Fatal:', err); process.exit(1); });

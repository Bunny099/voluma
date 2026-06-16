import 'dotenv/config';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors    from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import axios   from 'axios';
import { createServer }        from 'http';
import { PublicKey } from '@solana/web3.js';
import { z }       from 'zod';
import { nanoid }  from 'nanoid';

import pool                    from './db/pool';
import { RPCManager, type RPCProviderConfig } from './rpc/rpcManager';
import { PublicRPCProvider }   from './ingestion/public-rpc-provider';
import { ConditionEngine }     from './conditions/engine';
import { ExecutionEngine }     from './execution/executor';
import { TradeExecutor }       from './execution/tradeExecutor';
import { TradeGuard }          from './execution/tradeGuard';
import { JupiterService }      from './execution/jupiter';
import { BroadcastServer }     from './ws/broadcast';
import { EventQueue }          from './queue/in-memory-queue';
import { WalletManager }       from './wallets/walletManager';
import { SensitiveActionManager } from './security/sensitiveActionManager';
import { TokenRegistry }       from './tokens/tokenRegistry';
import { conditionRepo }       from './db/conditionRepo';
import { statsRepo }           from './db/statsRepo';
import { pendingTxRepo }       from './db/pendingTxRepo';
import { processedEventRepo }  from './db/processedEventRepo';
import { tradeExecutionRepo }  from './db/tradeExecutionRepo';
import { walletActivityRepo }  from './db/walletActivityRepo';
import { type NormalizedEvent } from './ingestion/provider';
import { type Condition }       from './conditions/types';

declare module 'fastify' {
  interface FastifyRequest { userId: string; }
}

// ── Startup validation ────────────────────────────────────────────────────────

const ENC_KEY = process.env.WALLET_ENCRYPTION_KEY ?? '';
if (ENC_KEY.length < 32) {
  console.error('FATAL: WALLET_ENCRYPTION_KEY must be >=32 chars. Set it in server/.env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Set it in server/.env');
  process.exit(1);
}
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 16) {
  console.error('FATAL: BETTER_AUTH_SECRET must be set and >=16 chars. Set it in server/.env');
  process.exit(1);
}

// ── Jupiter ───────────────────────────────────────────────────────────────────

const JUPITER_API_KEY = process.env.JUPITER_API_KEY ?? '';
const JUPITER_HEADERS: Record<string, string> = JUPITER_API_KEY
  ? { 'x-api-key': JUPITER_API_KEY }
  : {};
const tokenRegistry = new TokenRegistry(JUPITER_HEADERS);

export function resolveSymbol(mint: string): string {
  return tokenRegistry.resolveSymbol(mint);
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ActionSchema = z.object({
  type:             z.enum(['NOTIFY', 'WEBHOOK', 'LOG', 'TRADE']),
  webhookUrl:       z.string().url().optional(),
  tradeDirection:   z.enum(['BUY', 'SELL']).optional(),
  tradeTokenMint:   z.string().min(32).max(44).optional(),
  tradeAmountSol:   z.number().positive().max(100).optional(),
  tradeSellPercent: z.number().min(1).max(100).optional(),
  tradeSlippageBps: z.number().min(0).max(5000).optional(),
}).refine(a => {
  if (a.type !== 'TRADE') return true;
  if (!a.tradeDirection || !a.tradeTokenMint) return false;
  if (a.tradeDirection === 'BUY') return !!a.tradeAmountSol && a.tradeAmountSol > 0;
  return (!!a.tradeSellPercent && a.tradeSellPercent > 0) || (!!a.tradeAmountSol && a.tradeAmountSol >= 1 && a.tradeAmountSol <= 100);
}, { message: 'TRADE: direction + mint required; BUY needs amountSol; SELL needs sellPercent.' });

const ConditionSchema = z.object({
  id:                     z.string().default(() => nanoid()),
  userId:                 z.string().min(1),
  name:                   z.string().min(1),
  type:                   z.enum(['WALLET_ACTIVITY', 'SWAP_BURST', 'TOKEN_VOLUME', 'LARGE_TRANSFER']),
  enabled:                z.boolean().default(true),
  wallet:                 z.string().optional(),
  transactionType:        z.enum(['BUY', 'SELL', 'SWAP', 'TRANSFER', 'ANY']).optional(),
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


const _sessionCache = new Map<string, { userId: string; cachedAt: number }>();
const SESSION_CACHE_TTL = 60_000; 

// Periodically prune expired cache entries (every 5 minutes)
setInterval(() => {
  const cutoff = Date.now() - SESSION_CACHE_TTL;
  for (const [token, entry] of _sessionCache) {
    if (entry.cachedAt < cutoff) _sessionCache.delete(token);
  }
}, 5 * 60_000).unref();

async function lookupSession(token: string): Promise<string | null> {

  const cached = _sessionCache.get(token);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL) {
    return cached.userId;
  }
  if (cached) _sessionCache.delete(token); 

 
  try {
    const { rows } = await pool.query(
      'SELECT * FROM session WHERE token = $1',
      [token],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    const userId    = (row.userId    ?? row.user_id)    as string | undefined;
    const expiresAt = (row.expiresAt ?? row.expires_at) as string | Date | undefined;
    if (!userId) return null;
    if (expiresAt && new Date(expiresAt) <= new Date()) return null;

    
    _sessionCache.set(token, { userId, cachedAt: Date.now() });
    return userId;
  } catch (err: any) {
    console.error('[Auth] Session lookup failed:', err.message);
    return null;
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw   = request.headers.authorization;
  const token = raw?.startsWith('Bearer ') ? raw.slice(7).trim() : undefined;
  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized — missing Bearer token' });
  }
  const userId = await lookupSession(token);
  if (!userId) {
    return reply.code(401).send({ error: 'Unauthorized — invalid or expired session' });
  }
  request.userId = userId;
}

function buildRpcProviders(): RPCProviderConfig[] {
  const publicHttp = 'https://api.mainnet-beta.solana.com';
  const publicWs = 'wss://api.mainnet-beta.solana.com';

  const providers: RPCProviderConfig[] = [];
  const heliusKey = process.env.HELIUS_API_KEY ?? '';
  if (heliusKey) {
    providers.push({
      id: 'helius-primary',
      label: 'Helius Primary',
      httpUrl: process.env.HELIUS_RPC_HTTP_URL ?? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
      wsUrl: process.env.HELIUS_RPC_WS_URL ?? `wss://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
    });
  }

  const secondaryHeliusKey = process.env.SECONDARY_HELIUS_API_KEY ?? '';
  const secondaryHttp = process.env.SECONDARY_RPC_HTTP_URL
    ?? (secondaryHeliusKey ? `https://mainnet.helius-rpc.com/?api-key=${secondaryHeliusKey}` : process.env.SOLANA_RPC_URL);
  const secondaryWs = process.env.SECONDARY_RPC_WS_URL
    ?? (secondaryHeliusKey ? `wss://mainnet.helius-rpc.com/?api-key=${secondaryHeliusKey}` : process.env.RPC_WSS);
  if (secondaryHttp && secondaryWs) {
    providers.push({
      id: 'secondary',
      label: process.env.SECONDARY_RPC_LABEL
        ?? (secondaryHeliusKey ? 'Helius Secondary' : 'Secondary RPC'),
      httpUrl: secondaryHttp,
      wsUrl: secondaryWs,
    });
  }

  providers.push({
    id: 'public',
    label: 'Solana Public RPC',
    httpUrl: publicHttp,
    wsUrl: publicWs,
  });

  return providers;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
export async function bootstrap() {
  let droppedEvents = 0, totalEvents = 0, totalExecutions = 0, failedExecutions = 0, pendingExecutions = 0;
  let lastDropAt: number | null = null;

  const conditionStore = new Map<string, Condition>();
  const watchedWallets = new Set<string>();
  const trackedTokenRefs = new Map<string, number>();
  const triggerStats   = new Map<string, { count: number; lastTriggered: number }>();
  let largeTransferConditionCount = 0;

  const rpcManager = new RPCManager(buildRpcProviders());
  const conditionEngine = new ConditionEngine();
  const jupiterService  = new JupiterService(JUPITER_HEADERS);
  const walletManager   = new WalletManager(rpcManager, resolveSymbol);
  const tradeExecutor   = new TradeExecutor(rpcManager, jupiterService);
  const tradeGuard      = new TradeGuard(rpcManager);
  const sensitiveActions = new SensitiveActionManager();
  const provider = new PublicRPCProvider(rpcManager, resolveSymbol);

  const registerConditionTracking = (condition: Condition) => {
    if (!condition.enabled) return;

    if (condition.wallet) {
      watchedWallets.add(condition.wallet);
      provider.watchWallet(condition.wallet);
    }

    if (condition.tokenMint) {
      const next = (trackedTokenRefs.get(condition.tokenMint) ?? 0) + 1;
      trackedTokenRefs.set(condition.tokenMint, next);
      if (next === 1) provider.trackTokenMint(condition.tokenMint);
    }

    if (condition.type === 'LARGE_TRANSFER') {
      largeTransferConditionCount += 1;
      provider.setWatchLargeTransfers(largeTransferConditionCount > 0);
    }
  };

  const unregisterConditionTracking = (condition: Condition) => {
    if (condition.wallet) {
      const stillNeeded = [...conditionStore.values()].some((item) =>
        item.id !== condition.id && item.wallet === condition.wallet,
      );
      if (!stillNeeded) {
        watchedWallets.delete(condition.wallet);
        provider.unwatchWallet(condition.wallet);
      }
    }

    if (condition.tokenMint) {
      const current = trackedTokenRefs.get(condition.tokenMint) ?? 0;
      if (current <= 1) {
        trackedTokenRefs.delete(condition.tokenMint);
        provider.untrackTokenMint(condition.tokenMint);
      } else {
        trackedTokenRefs.set(condition.tokenMint, current - 1);
      }
    }

    if (condition.type === 'LARGE_TRANSFER') {
      largeTransferConditionCount = Math.max(0, largeTransferConditionCount - 1);
      provider.setWatchLargeTransfers(largeTransferConditionCount > 0);
    }
  };

  const httpServer = createServer();
  const app = Fastify({
    logger: { level: 'warn' },
    serverFactory: (handler) => { httpServer.on('request', handler); return httpServer; },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = (process.env.FRONTEND_URL ?? 'http://localhost:3000').split(',').map(s => s.trim());
      allowed.push('http://localhost:3000');
      if (!origin || allowed.some(a => origin.startsWith(a))) {
        cb(null, true);
      } else {
        cb(new Error(`CORS: origin ${origin} not allowed`), false);
      }
    },
    methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials:    true,
  });

  await app.register(rateLimit, {
    global:   false,
    max:      60,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.userId ?? request.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests — please slow down',
    }),
  });

  const broadcast = new BroadcastServer(httpServer);
  const executionEngine = new ExecutionEngine(
    (userId, payload) => {
      const p = payload as any;
      broadcast.sendToUser(userId, { type: 'TRIGGER', ...p });
      if (p.execution?.actions) {
        for (const action of p.execution.actions as any[]) {
          if (action.type !== 'TRADE') continue;
          if (action.status === 'pending') {
            broadcast.sendToUser(userId, {
              type: 'TRADE_PENDING',
              conditionId: p.conditionId,
              txHash: action.tradeResult?.txHash,
              inputMint: action.tradeResult?.inputMint,
              outputMint: action.tradeResult?.outputMint,
              amountIn: action.tradeResult?.amountIn,
              latencyMs: action.tradeResult?.latencyMs,
              quoteOutAmount: action.tradeResult?.quoteOutAmount,
              slippageBps: action.tradeResult?.slippageBps,
              priceImpactPct: action.tradeResult?.priceImpactPct,
              routeSummary: action.tradeResult?.routeSummary,
            });
          } else if (action.status === 'success') {
            broadcast.sendToUser(userId, {
              type: 'TRADE_CONFIRMED',
              conditionId: p.conditionId,
              txHash: action.tradeResult?.txHash,
              inputMint: action.tradeResult?.inputMint,
              outputMint: action.tradeResult?.outputMint,
              amountIn: action.tradeResult?.amountIn,
              latencyMs: action.tradeResult?.latencyMs,
              quoteOutAmount: action.tradeResult?.quoteOutAmount,
              slippageBps: action.tradeResult?.slippageBps,
              priceImpactPct: action.tradeResult?.priceImpactPct,
              routeSummary: action.tradeResult?.routeSummary,
            });
          } else if (action.status === 'failed') {
            broadcast.sendToUser(userId, {
              type: 'TRADE_FAILED',
              conditionId: p.conditionId,
              txHash: action.tradeResult?.txHash,
              error: action.error ?? action.tradeResult?.failureReason ?? 'Trade failed',
              errorType: action.errorType,
            });
          }
        }
      }
    },
    walletManager, tradeExecutor, tradeGuard,
  );

  // ── Startup load ──────────────────────────────────────────────────────────
  await walletManager.initialize();

 
  try {
    await pool.query('SELECT 1');
    console.info('[Startup] Database connection verified');
  } catch (err: any) {
    console.error('[Startup] FATAL: Cannot reach database:', err.message);
    console.error('[Startup] Check DATABASE_URL in server/.env');
    process.exit(1);
  }

  const allConditions = await conditionRepo.getAll();
  for (const cond of allConditions) {
    conditionStore.set(cond.id, cond);
    conditionEngine.load(cond);
    registerConditionTracking(cond);
  }
  const allStats = await statsRepo.getAll();
  for (const s of allStats) {
    triggerStats.set(s.conditionId, { count: s.triggerCount, lastTriggered: s.lastTriggered ?? 0 });
  }
  console.info(`[Startup] ${conditionStore.size} conditions, ${triggerStats.size} stat records loaded`);
  tokenRegistry.warm().catch(() => {});

  // ── Event queue ───────────────────────────────────────────────────────────
  const queue = new EventQueue<NormalizedEvent>(async (event) => {
    const matches = await conditionEngine.evaluate(event);
    if (!matches.length) return;
    for (const m of matches) {
      const prev = triggerStats.get(m.condition.id) ?? { count: 0, lastTriggered: 0 };
      triggerStats.set(m.condition.id, { count: prev.count + 1, lastTriggered: m.matchedAt });
      statsRepo.increment(m.condition.id, m.matchedAt).catch(e => console.error('[Queue] statsRepo:', e));
    }
    const results = await executionEngine.execute(matches);
    for (const r of results) {
      totalExecutions += r.summary.total;
      failedExecutions += r.summary.failed;
      pendingExecutions += r.summary.pending;
    }
  }, 5_000, 20);

  // ── Pending tx checker ────────────────────────────────────────────────────
  async function checkPendingTxs(): Promise<void> {
    const pending = await pendingTxRepo.getPending(50);
    for (const tx of pending) {
      try {
        const sig = await rpcManager.getHttpConnection().getSignatureStatus(tx.txHash, {
          searchTransactionHistory: true,
        });
        await pendingTxRepo.markChecked(tx.txHash);
        const status = sig?.value?.confirmationStatus;
        const hasErr = !!sig?.value?.err;
        if (!hasErr && (status === 'finalized' || status === 'confirmed')) {
          await pendingTxRepo.updateConfirmed(tx.txHash);
          await tradeExecutionRepo.updateStatus(tx.txHash, 'CONFIRMED');
          if (tx.conditionId) pendingExecutions = Math.max(0, pendingExecutions - 1);
          walletManager.invalidateWallet(tx.userId);
          if (tx.userId) {
            broadcast.sendToUser(tx.userId, {
              type: 'TRADE_CONFIRMED',
              txHash: tx.txHash,
              inputMint: tx.inputMint,
              outputMint: tx.outputMint,
              amountIn: tx.rawAmountIn,
            });
          }
          console.info(`[PendingTx] Confirmed: ${tx.txHash}`);
        } else if (hasErr) {
          const reason = `Transaction failed on-chain: ${JSON.stringify(sig?.value?.err)}`;
          await pendingTxRepo.updateFailed(tx.txHash, reason);
          await tradeExecutionRepo.updateStatus(tx.txHash, 'FAILED', { failureReason: reason });
          if (tx.conditionId) pendingExecutions = Math.max(0, pendingExecutions - 1);
          walletManager.invalidateWallet(tx.userId);
          if (tx.userId) {
            broadcast.sendToUser(tx.userId, {
              type: 'TRADE_FAILED',
              txHash: tx.txHash,
              error: reason,
              errorType: 'trade_error',
            });
          }
        } else if (Date.now() - tx.createdAt > 5 * 60 * 1000) {
          const reason = 'Abandoned after 5 min';
          await pendingTxRepo.updateFailed(tx.txHash, reason);
          await tradeExecutionRepo.updateStatus(tx.txHash, 'FAILED', { failureReason: reason });
          if (tx.conditionId) pendingExecutions = Math.max(0, pendingExecutions - 1);
          walletManager.invalidateWallet(tx.userId);
          if (tx.userId) {
            broadcast.sendToUser(tx.userId, {
              type: 'TRADE_FAILED',
              txHash: tx.txHash,
              error: reason,
              errorType: 'timeout',
            });
          }
        }
      } catch (e) { console.error('[PendingTx] Error:', tx.txHash, e); }
    }
  }
  setInterval(() => { checkPendingTxs().catch(e => console.error('[PendingTx]', e)); }, 15_000);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  async function runCleanup(): Promise<void> {
    const now = Date.now();
    const [processedResult, pendingResult] = await Promise.allSettled([
      processedEventRepo.cleanup(now - 2 * 60 * 60 * 1000),
      pendingTxRepo.cleanup(now - 24 * 60 * 60 * 1000),
    ]);
    if (processedResult.status === 'rejected') {
      console.warn('[Cleanup] processed_events failed:', processedResult.reason);
    }
    if (pendingResult.status === 'rejected') {
      console.warn('[Cleanup] pending_txs failed:', pendingResult.reason);
    }
    const p = processedResult.status === 'fulfilled' ? processedResult.value : 0;
    const t = pendingResult.status === 'fulfilled' ? pendingResult.value : 0;
    if (p > 0 || t > 0) console.info(`[Cleanup] events:${p} txs:${t}`);
  }
  runCleanup().catch(e => console.error('[Cleanup]', e));
  setInterval(() => { runCleanup().catch(e => console.error('[Cleanup]', e)); }, 30 * 60 * 1000);

  // ── Ingestion ─────────────────────────────────────────────────────────────
  const broadcastSystemStatus = () => {
    broadcast.broadcast({
      type: 'SYSTEM_STATUS',
      timestamp: Date.now(),
      rpc: rpcManager.getHealthSnapshot(),
    });
  };

  rpcManager.on('providerChanged', broadcastSystemStatus);
  rpcManager.on('health', broadcastSystemStatus);
  provider.on('transaction', (event: NormalizedEvent) => {
    totalEvents++;
    setImmediate(() => {
      if (!queue.push(event)) {
        droppedEvents++;
        lastDropAt = Date.now();
        if (droppedEvents % 100 === 0) {
          console.warn(`[Queue] HIGH DROP RATE total=${droppedEvents} depth=${queue.depth} inFlight=${queue.inFlight}`);
        }
      }
    });
    if (totalEvents % 5 === 0) {
      broadcast.broadcast({
        type: 'LIVE_EVENT',
        signature: event.signature,
        eventType: event.type,
        direction: event.direction,
        tokenMint: event.tokenMint,
        tokenSymbol: event.tokenSymbol,
        amountUi: event.amountUi,
        amountSol: event.amountSol,
        confidence: event.confidence,
        timestamp: event.timestamp,
      });
    }
  });
  provider.on('connected', () => {
    console.info('[Ingestion] Stream live');
    broadcastSystemStatus();
  });
  provider.on('disconnected', () => {
    console.warn('[Ingestion] Stream down — reconnecting');
    broadcastSystemStatus();
  });
  provider.connect();

  // ── Wallet routes ─────────────────────────────────────────────────────────
  app.get<{ Params: { userId: string } }>('/wallet/:userId', { preHandler: authMiddleware }, async (req, reply) => {
    if (req.params.userId !== req.userId) {
      return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
    }
    const info = await walletManager.getWalletInfo(req.userId);
    if (info?.tokens) { for (const t of info.tokens) { if (!t.symbol || t.symbol === 'UNKNOWN') t.symbol = resolveSymbol(t.mint); } }
    return reply.send(info);
  });

  app.post<{ Params: { userId: string } }>('/wallet/:userId/create', { preHandler: authMiddleware, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (req.params.userId !== req.userId) {
      return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
    }
    return reply.code(201).send(await walletManager.createWallet(req.userId));
  });

  app.post<{ Params: { userId: string }; Body: { action: 'EXPORT_WALLET' | 'WITHDRAW_SOL' | 'WITHDRAW_TOKEN' } }>(
    '/wallet/:userId/security/verify', { preHandler: authMiddleware }, async (req, reply) => {
      if (req.params.userId !== req.userId) {
        return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
      }
      const action = req.body?.action;
      if (!action) return reply.code(400).send({ error: 'action required' });
      return reply.send(sensitiveActions.issue(req.userId, action));
    },
  );

  app.post<{ Params: { userId: string }; Body: { verificationToken?: string; confirmText?: string } }>(
    '/wallet/:userId/export', { preHandler: authMiddleware, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req, reply) => {
      if (req.params.userId !== req.userId) {
        return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
      }
      if ((req.body?.confirmText ?? '').trim().toUpperCase() !== 'EXPORT') {
        return reply.code(400).send({ error: 'Type EXPORT to confirm wallet export' });
      }
      const verified = sensitiveActions.consume(
        req.userId,
        'EXPORT_WALLET',
        req.body?.verificationToken,
      );
      if (!verified) {
        return reply.code(401).send({ error: 'Session verification required before export' });
      }

      try {
        const exported = await walletManager.exportWallet(req.userId);
        await walletActivityRepo.insert(req.userId, exported.publicKey, 'WALLET_EXPORT_REQUESTED', {
          format: 'private_key_base58',
        });
        return reply.send(exported);
      } catch (error: any) {
        console.error('[Export] Wallet export error:', error);
        return reply.code(500).send({ error: 'Wallet export failed — please try again' });
      }
    },
  );

  app.post<{ Params: { userId: string }; Body: { destinationAddress: string; amountSol: number; verificationToken?: string; confirmText?: string } }>(
    '/wallet/:userId/withdraw/sol', { preHandler: authMiddleware, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (req.params.userId !== req.userId) {
        return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
      }
      const { destinationAddress, amountSol, verificationToken, confirmText } = req.body ?? {};
      if (!destinationAddress || !amountSol || amountSol <= 0) return reply.code(400).send({ error: 'destinationAddress and amountSol required' });
      if ((confirmText ?? '').trim().toUpperCase() !== 'WITHDRAW') return reply.code(400).send({ error: 'Type WITHDRAW to confirm this action' });
      if (!sensitiveActions.consume(req.userId, 'WITHDRAW_SOL', verificationToken)) {
        return reply.code(401).send({ error: 'Session verification required before withdrawal' });
      }
      try { new PublicKey(destinationAddress); } catch { return reply.code(400).send({ error: 'Invalid destination address' }); }
      const keypair = walletManager.getKeypair(req.userId);
      if (!keypair) return reply.code(404).send({ error: 'No trading wallet found' });
      const balCheck = await tradeGuard.checkBalance(keypair.publicKey, amountSol);
      if (!balCheck.allowed) return reply.code(400).send({ error: balCheck.reason });
      try {
        const result = await walletManager.withdrawSOL(req.userId, destinationAddress, amountSol);
        await walletActivityRepo.insert(req.userId, keypair.publicKey.toBase58(), 'WITHDRAWAL_EXECUTED', {
          txHash: result.txHash,
          status: result.status,
          destinationAddress,
          amountSol,
          asset: 'SOL',
        });
        if (result.status === 'PENDING') {
          broadcast.sendToUser(req.userId, {
            type: 'TRADE_PENDING',
            txHash: result.txHash,
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: destinationAddress,
            amountIn: Math.floor(amountSol * 1e9),
            manual: true,
          });
          return reply.code(202).send({ status: 'PENDING', txHash: result.txHash });
        }
        broadcast.sendToUser(req.userId, {
          type: 'TRADE_CONFIRMED',
          txHash: result.txHash,
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: destinationAddress,
          amountIn: Math.floor(amountSol * 1e9),
          manual: true,
        });
        return reply.send({ ...result, status: 'CONFIRMED' });
      } catch (err: any) {
        console.error('[Withdraw SOL] Error:', err.message);
        return reply.code(500).send({ error: 'Withdrawal failed — please try again' });
      }
    },
  );

  app.post<{ Params: { userId: string }; Body: { destinationAddress: string; tokenMint: string; uiAmount: number; verificationToken?: string; confirmText?: string } }>(
    '/wallet/:userId/withdraw/token', { preHandler: authMiddleware, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (req.params.userId !== req.userId) {
        return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
      }
      const { destinationAddress, tokenMint, uiAmount, verificationToken, confirmText } = req.body ?? {};
      if (!destinationAddress || !tokenMint || !uiAmount || uiAmount <= 0) return reply.code(400).send({ error: 'destinationAddress, tokenMint, and uiAmount required' });
      if ((confirmText ?? '').trim().toUpperCase() !== 'WITHDRAW') return reply.code(400).send({ error: 'Type WITHDRAW to confirm this action' });
      if (!sensitiveActions.consume(req.userId, 'WITHDRAW_TOKEN', verificationToken)) {
        return reply.code(401).send({ error: 'Session verification required before withdrawal' });
      }
      try { new PublicKey(destinationAddress); } catch { return reply.code(400).send({ error: 'Invalid destination address' }); }
      try { new PublicKey(tokenMint); } catch { return reply.code(400).send({ error: 'Invalid token mint' }); }
      const keypair = walletManager.getKeypair(req.userId);
      if (!keypair) return reply.code(404).send({ error: 'No trading wallet found' });
      const tokenBal = await tradeGuard.getTokenBalance(keypair.publicKey, tokenMint);
      if (!tokenBal || tokenBal.uiBalance <= 0) return reply.code(400).send({ error: `No balance for ${tokenMint.slice(0,8)}...` });
      if (uiAmount > tokenBal.uiBalance) return reply.code(400).send({ error: `Insufficient: have ${tokenBal.uiBalance}` });
      try {
        const result = await walletManager.withdrawToken(req.userId, destinationAddress, tokenMint, uiAmount);
        await walletActivityRepo.insert(req.userId, keypair.publicKey.toBase58(), 'WITHDRAWAL_EXECUTED', {
          txHash: result.txHash,
          status: result.status,
          destinationAddress,
          uiAmount,
          tokenMint,
          asset: 'TOKEN',
        });
        if (result.status === 'PENDING') {
          broadcast.sendToUser(req.userId, {
            type: 'TRADE_PENDING',
            txHash: result.txHash,
            inputMint: tokenMint,
            outputMint: destinationAddress,
            amountIn: 0,
            manual: true,
          });
          return reply.code(202).send({ status: 'PENDING', txHash: result.txHash });
        }
        broadcast.sendToUser(req.userId, {
          type: 'TRADE_CONFIRMED',
          txHash: result.txHash,
          inputMint: tokenMint,
          outputMint: destinationAddress,
          amountIn: 0,
          manual: true,
        });
        return reply.send({ ...result, status: 'CONFIRMED' });
      } catch (err: any) {
        console.error('[Withdraw Token] Error:', err.message);
        return reply.code(500).send({ error: 'Token withdrawal failed — please try again' });
      }
    },
  );

  // ── Trade routes ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { inputMint: string; outputMint: string; amount: string; slippageBps?: string } }>(
    '/trade/quote', async (req, reply) => {
      const { inputMint, outputMint, amount, slippageBps } = req.query;
      if (!inputMint || !outputMint || !amount) return reply.code(400).send({ error: 'inputMint, outputMint, amount required' });
      const rawAmount = parseInt(amount, 10);
      if (isNaN(rawAmount) || rawAmount <= 0) return reply.code(400).send({ error: 'amount must be positive integer' });
      try {
        const quote = await jupiterService.getValidatedQuote({
          inputMint,
          outputMint,
          amount: rawAmount,
          slippageBps: slippageBps ? parseInt(slippageBps, 10) : 100,
        });
        return reply.send({
          expectedOutput: quote.outAmount,
          inputMint,
          outputMint,
          inAmount: rawAmount,
          priceImpactPct: quote.priceImpactPct ?? null,
          routeSummary: quote.routeSummary,
        });
      } catch (err: any) {
        if (err?.response?.status === 400) return reply.code(422).send({ error: 'Token not tradable / no liquidity' });
        const message = err?.response?.data?.error ?? err?.message ?? 'Quote failed';
        return reply.code(502).send({ error: `Jupiter quote failed: ${message}` });
      }
    },
  );

  const LAMPORTS_PER_SOL = 1_000_000_000;

  app.post<{ Body: { direction: 'BUY' | 'SELL'; tokenMint: string; percent?: number; amountSol?: number; slippageBps?: number } }>(
    '/trade/manual', { preHandler: authMiddleware }, async (req, reply) => {
      const { direction, tokenMint, percent, amountSol, slippageBps } = req.body ?? {};
      const userId = req.userId;
      if (!direction || !tokenMint) return reply.code(400).send({ error: 'direction and tokenMint required' });
      const mintCheck = tradeGuard.validateMint(tokenMint);
      if (!mintCheck.allowed) return reply.code(400).send({ error: mintCheck.reason });
      const keypair = walletManager.getKeypair(userId);
      if (!keypair) return reply.code(404).send({ error: 'No trading wallet found' });
      const rateCheck = tradeGuard.checkRateLimit(userId);
      if (!rateCheck.allowed) return reply.code(429).send({ error: rateCheck.reason });
      let rawAmountIn: number;
      if (direction === 'BUY') {
        if (!amountSol || amountSol <= 0) return reply.code(400).send({ error: 'BUY requires amountSol > 0' });
        const balCheck = await tradeGuard.checkBalance(keypair.publicKey, amountSol);
        if (!balCheck.allowed) return reply.code(400).send({ error: balCheck.reason });
        rawAmountIn = Math.floor(amountSol * LAMPORTS_PER_SOL);
      } else {
        if (!percent || percent < 1 || percent > 100) return reply.code(400).send({ error: 'SELL requires percent 1-100' });
        const tokenCheck = await tradeGuard.checkTokenBalance(keypair.publicKey, tokenMint, percent);
        if (!tokenCheck.allowed) return reply.code(400).send({ error: tokenCheck.reason });
        rawAmountIn = Number(tokenCheck.rawSellAmount!);
      }
      try {
        await jupiterService.getValidatedQuote({
          inputMint: direction === 'BUY'
            ? 'So11111111111111111111111111111111111111112'
            : tokenMint,
          outputMint: direction === 'BUY'
            ? tokenMint
            : 'So11111111111111111111111111111111111111112',
          amount: rawAmountIn,
          slippageBps: slippageBps ?? 100,
        });
      } catch (err: any) {
        if (err?.response?.status === 400) return reply.code(422).send({ error: 'Token not tradable / no liquidity' });
        return reply.code(502).send({ error: err?.message ?? 'Jupiter quote check failed' });
      }
      const tradeKey = `manual:${userId}:${tokenMint}:${Date.now()}`;
      if (!walletManager.markTradeSubmitted(tradeKey)) return reply.code(429).send({ error: 'Duplicate trade blocked' });
      const result = await tradeExecutor.executeTrade(keypair, { direction, tokenMint, rawAmountIn, slippageBps: slippageBps ?? 100 });
      await tradeExecutionRepo.insert({
        txHash: result.txHash ?? null,
        userId,
        conditionId: null,
        manual: true,
        direction,
        inputMint: result.inputMint,
        outputMint: result.outputMint,
        rawAmountIn: result.amountIn,
        quoteOutAmount: result.quoteOutAmount ?? result.outAmount ?? null,
        slippageBps: result.slippageBps,
        quotePriceImpactPct: result.priceImpactPct ?? null,
        routeSummary: result.routeSummary ?? null,
        status: result.status,
        executionDurationMs: result.latencyMs,
        failureReason: result.error ?? result.confirmErr ?? null,
        rpcProvider: result.providerLabel ?? null,
      });
      if (result.txHash) {
        await walletActivityRepo.insert(userId, keypair.publicKey.toBase58(), 'TRADE_EXECUTED', {
          txHash: result.txHash,
          status: result.status,
          direction,
          tokenMint,
          rawAmountIn,
          quoteOutAmount: result.quoteOutAmount ?? result.outAmount ?? null,
          priceImpactPct: result.priceImpactPct ?? null,
          slippageBps: result.slippageBps,
          manual: true,
        });
      }
      walletManager.invalidateWallet(userId);
      if (!result.success && result.status === 'FAILED') {
        broadcast.sendToUser(userId, { type: 'TRADE_FAILED', error: result.error ?? 'Trade failed', errorType: 'trade_error', manual: true, txHash: result.txHash });
        return reply.code(500).send({ error: result.error ?? 'Trade failed' });
      }
      if (result.status === 'PENDING' && result.txHash) {
        await pendingTxRepo.insert(result.txHash, userId, null, rawAmountIn, result.inputMint, result.outputMint);
        broadcast.sendToUser(userId, {
          type: 'TRADE_PENDING',
          txHash: result.txHash,
          inputMint: result.inputMint,
          outputMint: result.outputMint,
          amountIn: result.amountIn,
          latencyMs: result.latencyMs,
          quoteOutAmount: result.quoteOutAmount,
          slippageBps: result.slippageBps,
          priceImpactPct: result.priceImpactPct,
          routeSummary: result.routeSummary,
          manual: true,
        });
        return reply.code(202).send({ status: 'PENDING', txHash: result.txHash });
      }
      if (result.txHash) {
        broadcast.sendToUser(userId, {
          type: 'TRADE_CONFIRMED',
          txHash: result.txHash,
          inputMint: result.inputMint,
          outputMint: result.outputMint,
          amountIn: result.amountIn,
          latencyMs: result.latencyMs,
          quoteOutAmount: result.quoteOutAmount,
          slippageBps: result.slippageBps,
          priceImpactPct: result.priceImpactPct,
          routeSummary: result.routeSummary,
          manual: true,
        });
      }
      return reply.send({
        status: 'CONFIRMED',
        txHash: result.txHash,
        inputMint: result.inputMint,
        outputMint: result.outputMint,
        amountIn: result.amountIn,
        outAmount: result.outAmount,
        latencyMs: result.latencyMs,
      });
    },
  );

  // ── Condition routes ──────────────────────────────────────────────────────
  app.post('/conditions', { preHandler: authMiddleware }, async (req, reply) => {
    const parsed = ConditionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const cond = { ...parsed.data, userId: req.userId } as Condition;
    if (cond.actions.some(a => a.type === 'TRADE')) {
      if (!walletManager.hasWallet(req.userId)) return reply.code(400).send({ error: 'Create a trading wallet first (Wallet tab).' });
      for (const action of cond.actions) {
        if (action.type !== 'TRADE' || !action.tradeTokenMint) continue;
        const SOL = 'So11111111111111111111111111111111111111112';
        const amt = action.tradeDirection === 'BUY' ? Math.floor((action.tradeAmountSol ?? 0.001) * 1e9) : 1_000_000;
        const im  = action.tradeDirection === 'BUY' ? SOL : action.tradeTokenMint;
        const om  = action.tradeDirection === 'BUY' ? action.tradeTokenMint : SOL;
        try {
          await jupiterService.getValidatedQuote({
            inputMint: im,
            outputMint: om,
            amount: amt,
            slippageBps: action.tradeSlippageBps ?? 100,
          });
        } catch (err: any) {
          if (err?.response?.status === 400) return reply.code(400).send({ error: `Token ${action.tradeTokenMint.slice(0,8)}... not tradable on Jupiter` });
          console.warn('[Conditions] Jupiter check skipped:', err.message);
        }
      }
    }
    await conditionRepo.save(cond);
    conditionStore.set(cond.id, cond);
    conditionEngine.load(cond);
    registerConditionTracking(cond);
    return reply.code(201).send({ id: cond.id });
  });

  app.get<{ Params: { userId: string } }>('/conditions/:userId', { preHandler: authMiddleware }, async (req, reply) => {
    const userConditions = [...conditionStore.values()].filter(c => c.userId === req.userId);
    const execCounts = await conditionRepo.getManyExecutionCounts(userConditions.map(c => c.id));
    return reply.send(userConditions.map(c => {
      const s = triggerStats.get(c.id);
      return { ...c, triggerCount: s?.count ?? 0, lastTriggered: s?.lastTriggered ?? null, executionCount: execCounts.get(c.id) ?? 0 };
    }));
  });

  app.get<{ Params: { userId: string } }>(
    '/trades/:userId', { preHandler: authMiddleware }, async (req, reply) => {
      if (req.params.userId !== req.userId) {
        return reply.code(403).send({ error: 'Forbidden — user ID mismatch' });
      }
      const trades = await tradeExecutionRepo.getRecentByUser(req.userId, 50);
      return reply.send(trades);
    },
  );

  app.delete<{ Params: { id: string } }>('/conditions/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const cond = conditionStore.get(req.params.id);
    if (!cond) return reply.code(404).send({ error: 'not found' });
    if (cond.userId !== req.userId) return reply.code(403).send({ error: 'forbidden' });
    await conditionRepo.delete(req.params.id);
    await statsRepo.delete(req.params.id);
    conditionEngine.unload(req.params.id);
    conditionStore.delete(req.params.id);
    triggerStats.delete(req.params.id);
    unregisterConditionTracking(cond);
    return reply.send({ ok: true });
  });

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/conditions/:id/toggle', { preHandler: authMiddleware }, async (req, reply) => {
      const cond = conditionStore.get(req.params.id);
      if (!cond) return reply.code(404).send({ error: 'not found' });
      if (cond.userId !== req.userId) return reply.code(403).send({ error: 'forbidden' });
      if (cond.enabled && !req.body.enabled) {
        unregisterConditionTracking(cond);
      } else if (!cond.enabled && req.body.enabled) {
        registerConditionTracking({ ...cond, enabled: true });
      }
      cond.enabled = req.body.enabled;
      await conditionRepo.save(cond);
      conditionEngine.unload(cond.id);
      conditionEngine.load(cond);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: { url?: string } }>('/webhook/test', { preHandler: authMiddleware, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url) return reply.code(400).send({ error: 'url required' });
    // SSRF protection — block internal/private URLs
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return reply.code(400).send({ error: 'Only http/https webhook URLs are allowed' });
      }
      const h = parsed.hostname.toLowerCase();
      const isPrivate = h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) || /^192\.168\./.test(h) || h.endsWith('.local');
      if (isPrivate) {
        return reply.code(400).send({ error: 'Internal/private URLs are not allowed as webhook targets' });
      }
    } catch {
      return reply.code(400).send({ error: 'Invalid webhook URL' });
    }
    const start = Date.now();
    try {
      const res = await axios.post(url, { test: true, source: 'voluma', timestamp: Date.now() }, { timeout: 5_000, validateStatus: () => true });
      return reply.send({ success: res.status < 400, statusCode: res.status, durationMs: Date.now() - start });
    } catch (err: any) { return reply.send({ success: false, durationMs: Date.now() - start, error: err.message }); }
  });

  app.get('/', async () => {
  return {
    service: 'Voluma API',
    status: 'ok',
    uptime: process.uptime(),
  };
});

  app.get('/health', async (_req, reply) => {
    return reply.send({
      status:        'ok',
      uptime:        Math.floor(process.uptime()),
      timestamp:     new Date().toISOString(),
      wsConnections: broadcast.connectionCount,
      queueDepth:    queue.depth,
    });
  });

  app.get('/stats', async (_req, reply) => {
    const settledExecutions = Math.max(0, totalExecutions - pendingExecutions);
    const sr = settledExecutions > 0
      ? +((settledExecutions - failedExecutions) / settledExecutions).toFixed(4)
      : 1;
    return reply.send({
      queueDepth: queue.depth,
      queueInFlight: queue.inFlight,
      activeConditions: conditionStore.size,
      watchedWallets: watchedWallets.size,
      wsConnections: broadcast.connectionCount,
      uptimeSeconds: Math.floor(process.uptime()),
      totalEvents,
      droppedEvents,
      lastDropAt,
      queueHealthy: !lastDropAt || Date.now() - lastDropAt > 60_000,
      dropRate: totalEvents ? +(droppedEvents / totalEvents).toFixed(4) : 0,
      totalExecutions,
      failedExecutions,
      pendingExecutions,
      tradeSuccessRate: sr,
      rpc: rpcManager.getHealthSnapshot(),
    });
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  await app.ready();
  const port = Number(process.env.PORT ?? 3001);
  await new Promise<void>((resolve, reject) => { httpServer.listen(port, '0.0.0.0', resolve); httpServer.once('error', reject); });
  console.log(`Voluma server running on :${port}`);

  const shutdown = async (signal: string) => {
    console.info(`[Shutdown] ${signal} — draining queue (depth=${queue.depth})...`);
    provider.disconnect();
    const deadline = Date.now() + 10_000;
    while (queue.depth > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (queue.depth > 0) console.warn(`[Shutdown] Queue not empty (${queue.depth}) — exiting anyway`);
    await pool.end();
    console.info('[Shutdown] Clean exit');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch(err => { console.error('Fatal:', err); process.exit(1); });

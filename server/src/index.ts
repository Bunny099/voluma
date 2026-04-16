import Fastify from 'fastify';
import cors    from '@fastify/cors';
import axios   from 'axios';
import { createServer }   from 'http';
import { Connection }     from '@solana/web3.js';
import { z }              from 'zod';
import { nanoid }         from 'nanoid';

import { PublicRPCProvider } from './ingestion/public-rpc-provider';
import { ConditionEngine }   from './conditions/engine';
import { ExecutionEngine }   from './execution/executor';
import { TradeExecutor }     from './execution/tradeExecutor';
import { BroadcastServer }   from './ws/broadcast';
import { EventQueue }        from './queue/in-memory-queue';
import { WalletManager }     from './wallets/walletManager';
import { type NormalizedEvent } from './ingestion/provider';
import { type Condition }       from './conditions/types';

// ─── Zod schema ────────────────────────────────────────────────────────────────
const ActionSchema = z.object({
  type:             z.enum(['NOTIFY', 'WEBHOOK', 'LOG', 'TRADE']),
  webhookUrl:       z.string().url().optional(),
  tradeDirection:   z.enum(['BUY', 'SELL']).optional(),
  tradeTokenMint:   z.string().min(32).optional(),
  tradeAmountSol:   z.number().positive().max(100).optional(), // cap at 100 SOL for safety
  tradeSlippageBps: z.number().min(0).max(5000).optional(),
}).refine(
  a => a.type !== 'TRADE' || (a.tradeDirection && a.tradeTokenMint && a.tradeAmountSol),
  { message: 'TRADE action requires tradeDirection, tradeTokenMint, and tradeAmountSol' },
);

const ConditionSchema = z.object({
  id:              z.string().default(() => nanoid()),
  userId:          z.string().min(1),
  name:            z.string().min(1),
  type:            z.enum(['WALLET_ACTIVITY', 'SWAP_BURST', 'TOKEN_VOLUME', 'LARGE_TRANSFER']),
  enabled:         z.boolean().default(true),
  wallet:          z.string().optional(),
  transactionType: z.enum(['BUY', 'SELL', 'TRANSFER', 'ANY']).optional(),
  minAmountSol:    z.number().optional(),
  tokenMint:       z.string().optional(),
  minSwaps:        z.number().optional(),
  minVolumeSol:    z.number().optional(),
  windowSeconds:   z.number().min(5).max(3600).optional(),
  minSol:          z.number().optional(),
  actions:         z.array(ActionSchema).min(1),
  cooldownSeconds: z.number().min(0).default(60),
  createdAt:       z.number().default(() => Date.now()),
});

// ─── Bootstrap ─────────────────────────────────────────────────────────────────
export async function bootstrap() {
  let droppedEvents = 0;
  let totalEvents   = 0;

  const conditionStore = new Map<string, Condition>();
  const watchedWallets = new Set<string>();
  const triggerStats   = new Map<string, { count: number; lastTriggered: number }>();

  const conditionEngine = new ConditionEngine();
  const walletManager   = new WalletManager();
  const tradeExecutor   = new TradeExecutor();

  // ── HTTP + WS servers ─────────────────────────────────────────────────────────
  const httpServer = createServer();
  const app = Fastify({
    logger: { level: 'warn' },
    serverFactory: (handler) => { httpServer.on('request', handler); return httpServer; },
  });

  await app.register(cors, {
    origin:         process.env.FRONTEND_URL ?? true,
    methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials:    true,
  });

  const broadcast = new BroadcastServer(httpServer);

  const executionEngine = new ExecutionEngine(
    (userId, payload) => broadcast.sendToUser(userId, { type: 'TRIGGER', ...(payload as object) }),
    walletManager,
    tradeExecutor,
  );

  const queue = new EventQueue<NormalizedEvent>(
    async (event) => {
      const matches = await conditionEngine.evaluate(event);
      if (!matches.length) return;
      for (const m of matches) {
        const prev = triggerStats.get(m.condition.id) ?? { count: 0, lastTriggered: 0 };
        triggerStats.set(m.condition.id, { count: prev.count + 1, lastTriggered: m.matchedAt });
      }
      await executionEngine.execute(matches);
    },
    5_000,
    20,
  );

  // ── Ingestion ──────────────────────────────────────────────────────────────────
  const provider = new PublicRPCProvider();
  provider.on('transaction', (event: NormalizedEvent) => {
    totalEvents++;
    setImmediate(() => { if (!queue.push(event)) droppedEvents++; });
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

  // ── Wallet routes ──────────────────────────────────────────────────────────────

  app.get<{ Params: { userId: string } }>('/wallet/:userId', async (req, reply) => {
    const info = walletManager.getInfo(req.params.userId);
    if (!info) return reply.send(null);

    // Fetch SOL balance from RPC
    try {
      const connection = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com');
      const { PublicKey } = await import('@solana/web3.js');
      const lamports   = await connection.getBalance(new PublicKey(info.publicKey));
      return reply.send({ ...info, balanceSol: lamports / 1_000_000_000 });
    } catch {
      return reply.send({ ...info, balanceSol: null });
    }
  });

  app.post<{ Params: { userId: string } }>('/wallet/:userId/create', async (req, reply) => {
    const result = walletManager.createWallet(req.params.userId);
    return reply.code(201).send(result);
  });

  // ── Condition routes ───────────────────────────────────────────────────────────

  app.post('/conditions', async (req, reply) => {
    const parsed = ConditionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const cond = parsed.data as Condition;

    // Warn if TRADE action but no wallet yet — still allow creation
    if (cond.actions.some(a => a.type === 'TRADE') && !walletManager.hasWallet(cond.userId)) {
      console.warn(`[Conditions] TRADE action created but no wallet for userId=${cond.userId}`);
    }

    conditionStore.set(cond.id, cond);
    conditionEngine.load(cond);
    if (cond.wallet) { watchedWallets.add(cond.wallet); provider.watchWallet(cond.wallet); }

    return reply.code(201).send({ id: cond.id });
  });

  app.get<{ Params: { userId: string } }>('/conditions/:userId', async (req, reply) => {
    const conditions = [...conditionStore.values()]
      .filter(c => c.userId === req.params.userId)
      .map(c => {
        const s = triggerStats.get(c.id);
        return { ...c, triggerCount: s?.count ?? 0, lastTriggered: s?.lastTriggered ?? null };
      });
    return reply.send(conditions);
  });

  app.delete<{ Params: { id: string } }>('/conditions/:id', async (req, reply) => {
    const cond = conditionStore.get(req.params.id);
    if (!cond) return reply.code(404).send({ error: 'not found' });
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
      conditionEngine.unload(cond.id);
      conditionEngine.load(cond);
      return reply.send({ ok: true });
    },
  );

  // ── Webhook test endpoint ──────────────────────────────────────────────────────
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

  // ── Stats ──────────────────────────────────────────────────────────────────────
  app.get('/stats', async (_req, reply) => {
    return reply.send({
      queueDepth:       queue.depth,
      queueInFlight:    queue.inFlight,
      activeConditions: conditionStore.size,
      watchedWallets:   watchedWallets.size,
      wsConnections:    broadcast.connectionCount,
      uptimeSeconds:    Math.floor(process.uptime()),
      totalEvents,
      droppedEvents,
      dropRate: totalEvents ? droppedEvents / totalEvents : 0,
    });
  });

  // ── Start ──────────────────────────────────────────────────────────────────────
  await app.ready();
  const port = Number(process.env.PORT ?? 3001);
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', resolve);
    httpServer.once('error', reject);
  });
  console.log(`Voluma running on :${port}`);
}

bootstrap().catch(err => { console.error('Fatal:', err); process.exit(1); });
import axios from 'axios';
import { type MatchResult }      from '../conditions/engine';
import { type ExecutionAction }  from '../conditions/types';
import { type WalletManager }    from '../wallets/walletManager';
import { type TradeExecutor }    from './tradeExecutor';
import { type TradeGuard }       from './tradeGuard';
import { conditionRepo }         from '../db/conditionRepo';
import { pendingTxRepo }         from '../db/pendingTxRepo';
import { processedEventRepo }    from '../db/processedEventRepo';
import { tradeExecutionRepo }    from '../db/tradeExecutionRepo';
import { walletActivityRepo }    from '../db/walletActivityRepo';

type UserNotifyFn = (userId: string, payload: unknown) => void;

export type ErrorType =
  | 'timeout' | 'network' | 'bad_request' | 'server_error'
  | 'invalid_url' | 'trade_error' | 'no_wallet' | 'guard_rejected' | 'no_balance';

export interface TradeResultPayload {
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  txHash?: string;
  inputMint: string;
  outputMint: string;
  amountIn: number;
  outAmount?: number;
  quoteOutAmount?: number;
  priceImpactPct?: number | null;
  slippageBps?: number;
  routeSummary?: unknown;
  providerLabel?: string;
  failureReason?: string;
  latencyMs: number;
}

export interface ActionResult {
  type:            string;
  status:          'success' | 'pending' | 'failed' | 'skipped';
  attempts:        number;
  durationMs:      number;
  error?:          string;
  errorType?:      ErrorType;
  responseStatus?: number;
  tradeResult?:    TradeResultPayload;
}

export interface ExecutionSummary {
  total: number;
  success: number;
  pending: number;
  failed: number;
}

export interface ExecutionResult {
  conditionId: string;
  matchedAt:   number;
  actions:     ActionResult[];
  summary:     ExecutionSummary;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function makeDeliveryId(match: MatchResult): string {
  return `${match.condition.id.slice(0, 8)}-${match.event.signature.slice(0, 8)}-${match.matchedAt}`;
}

function tradeErr(message: string, type: ErrorType = 'trade_error'): Error {
  return Object.assign(new Error(message), { _errorType: type });
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export class ExecutionEngine {
  private readonly walletLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly notify:        UserNotifyFn,
    private readonly walletManager: WalletManager,
    private readonly tradeExecutor: TradeExecutor,
    private readonly tradeGuard:    TradeGuard,
  ) {}

  async execute(matches: MatchResult[]): Promise<ExecutionResult[]> {
    return Promise.all(matches.map(m => this.executeMatch(m)));
  }

  private async executeMatch(match: MatchResult): Promise<ExecutionResult> {

    const isNew = await processedEventRepo.insertIfAbsent(
      match.condition.id,
      match.event.signature,
    );
    if (!isNew) {
      console.warn(
        `[Executor] Duplicate delivery skipped: ${match.condition.id}:${match.event.signature}`,
      );
      return {
        conditionId: match.condition.id,
        matchedAt:   match.matchedAt,
        actions:     [],
        summary:     { total: 0, success: 0, pending: 0, failed: 0 },
      };
    }

    const deliveryId    = makeDeliveryId(match);
    const actionResults: ActionResult[] = [];

    for (const action of match.condition.actions) {
      if (action.type === 'NOTIFY') continue;
      const maxAttempts = action.type === 'TRADE' ? 1 : 3;
      actionResults.push(await this.dispatchWithRetry(match, action, maxAttempts, deliveryId));
    }

    const hasNotify    = match.condition.actions.some(a => a.type === 'NOTIFY');
    const notifyResult: ActionResult = {
      type: 'NOTIFY', status: 'success', attempts: 1, durationMs: 0,
    };
    const clientActions = hasNotify ? [...actionResults, notifyResult] : actionResults;

    const t0 = Date.now();
    this.notify(match.condition.userId, {
      conditionId:   match.condition.id,
      conditionName: match.condition.name,
      conditionType: match.condition.type,
      signature:     match.event.signature,
      eventType:     match.event.type,
      direction:     match.event.direction,
      wallet:        match.event.wallet,
      tokenMint:     match.event.tokenMint,
      tokenSymbol:   match.event.tokenSymbol,
      amount:        match.event.amount,
      amountUi:      match.event.amountUi,
      amountSol:     match.event.amountSol,
      matchedAt:     match.matchedAt,
      explanation:   match.explanation,
      execution:     { deliveryId, actions: clientActions, summary: buildSummary(clientActions) },
    });

    if (hasNotify) {
      actionResults.push({ type: 'NOTIFY', status: 'success', attempts: 1, durationMs: Date.now() - t0 });
    }

    return {
      conditionId: match.condition.id,
      matchedAt:   match.matchedAt,
      actions:     actionResults,
      summary:     buildSummary(actionResults),
    };
  }

  private async dispatchWithRetry(
    match:       MatchResult,
    action:      ExecutionAction,
    maxAttempts: number,
    deliveryId:  string,
  ): Promise<ActionResult> {
    const start = Date.now();
    const type  = action.type;

    if (type === 'WEBHOOK') {
      if (!action.webhookUrl) return { type, status: 'skipped', attempts: 0, durationMs: 0 };
      if (!isValidUrl(action.webhookUrl))
        return { type, status: 'failed', attempts: 0, durationMs: 0, error: 'Invalid webhook URL', errorType: 'invalid_url' };
    }

    let lastError:   string    = 'Unknown error';
    let lastErrType: ErrorType = 'network';
    let lastStatus:  number | undefined;
    let tradeResult: TradeResultPayload | undefined;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        const result = await this.dispatch(match, action, deliveryId, attempt);
        tradeResult  = result.tradeResult;
        const actionStatus = tradeResult?.status === 'PENDING' ? 'pending' : 'success';
        console.info(`[Executor] SUCCESS type=${type} cond=${match.condition.id} attempt=${attempt} ${Date.now() - start}ms status=${actionStatus}`);
        return { type, status: actionStatus, attempts, durationMs: Date.now() - start, tradeResult };
      } catch (err) {
        const cls   = classifyError(err);
        lastError   = cls.message;
        lastErrType = cls.errorType;
        lastStatus  = cls.responseStatus;
        const retry = isRetryable(err);
        console.warn(`[Executor] FAIL type=${type} attempt=${attempt}/${maxAttempts} err=${lastErrType} retry=${retry} cond=${match.condition.id}`);
        if (!retry || attempt === maxAttempts) break;
        await sleep(500 * Math.pow(2, attempt - 1));
      }
    }

    console.error(`[Executor] PERMANENT_FAIL type=${type} cond=${match.condition.id} deliveryId=${deliveryId} err=${lastError}`);
    return {
      type,
      status:         'failed',
      attempts,
      durationMs:     Date.now() - start,
      error:          lastError,
      errorType:      lastErrType,
      responseStatus: lastStatus,
    };
  }

  private async dispatch(
    match:      MatchResult,
    action:     ExecutionAction,
    deliveryId: string,
    attempt:    number,
  ): Promise<{ tradeResult?: TradeResultPayload }> {
    const base = {
      conditionId:   match.condition.id,
      conditionName: match.condition.name,
      conditionType: match.condition.type,
      signature:     match.event.signature,
      eventType:     match.event.type,
      direction:     match.event.direction,
      wallet:        match.event.wallet,
      tokenMint:     match.event.tokenMint,
      tokenSymbol:   match.event.tokenSymbol,
      amount:        match.event.amount,
      amountUi:      match.event.amountUi,
      amountSol:     match.event.amountSol,
      matchedAt:     match.matchedAt,
      explanation:   match.explanation,
      deliveryId, attempt, timestamp: Date.now(),
    };

    switch (action.type) {
      case 'WEBHOOK':
        await axios.post(action.webhookUrl!, base, {
          timeout: 5_000,
          headers: {
            'Content-Type':             'application/json',
            'X-Voluma-Idempotency-Key': `${match.condition.id}:${match.event.signature}`,
            'X-Voluma-Delivery-Id':     deliveryId,
            'X-Voluma-Attempt':         String(attempt),
          },
        });
        return {};

      case 'LOG':
        console.log('[Trigger]', JSON.stringify({
          condition:   match.condition.name,
          explanation: match.explanation.reason,
          signature:   match.event.signature,
        }));
        return {};

      case 'TRADE': {
        const { tradeDirection, tradeTokenMint, tradeAmountSol, tradeSellPercent, tradeSlippageBps } = action;

        if (!tradeDirection || !tradeTokenMint)
          throw tradeErr('TRADE action missing tradeDirection or tradeTokenMint');

        const keypair = this.walletManager.getKeypair(match.condition.userId);
        if (!keypair) throw tradeErr('No trading wallet — create one in the Wallet tab', 'no_wallet');

        const walletId = keypair.publicKey.toBase58();
        const prevLock = this.walletLocks.get(walletId) ?? Promise.resolve();

        let execResult: { tradeResult?: TradeResultPayload } | null = null;
        let lockError: unknown = null;

        const nextLock = prevLock.then(async () => {
          try {
            const rateCheck = this.tradeGuard.checkRateLimit(match.condition.userId);
            if (!rateCheck.allowed) throw tradeErr(rateCheck.reason!, 'guard_rejected');

            const mintCheck = this.tradeGuard.validateMint(tradeTokenMint);
            if (!mintCheck.allowed) throw tradeErr(mintCheck.reason!, 'trade_error');

            const effectiveMax = match.condition.allowRepeatedExecution === false
              ? 1
              : match.condition.maxExecutions;
            if (effectiveMax !== undefined) {
              const allowed = await conditionRepo.incrementIfUnderLimit(
                match.condition.id,
                effectiveMax,
              );
              if (!allowed)
                throw tradeErr(`Execution limit reached (${effectiveMax}/${effectiveMax})`, 'guard_rejected');
            }

            const tradeKey = `${match.condition.id}:${match.event.signature}`;
            if (!this.walletManager.markTradeSubmitted(tradeKey))
              throw tradeErr('Duplicate trade blocked');

            let rawAmountIn: number;

            if (tradeDirection === 'BUY') {
              if (!tradeAmountSol || tradeAmountSol <= 0)
                throw tradeErr('BUY requires tradeAmountSol > 0');

              const balCheck = await this.tradeGuard.checkBalance(keypair.publicKey, tradeAmountSol);
              if (!balCheck.allowed) throw tradeErr(balCheck.reason!, 'no_balance');

              rawAmountIn = Math.floor(tradeAmountSol * LAMPORTS_PER_SOL);
            } else {
              const sellPct = (tradeSellPercent && tradeSellPercent > 0)
                ? tradeSellPercent
                : (tradeAmountSol && tradeAmountSol >= 1 && tradeAmountSol <= 100)
                  ? tradeAmountSol
                  : null;

              if (!sellPct) throw tradeErr('SELL requires tradeSellPercent (1–100)');

              const tokenCheck = await this.tradeGuard.checkTokenBalance(
                keypair.publicKey, tradeTokenMint, sellPct,
              );
              if (!tokenCheck.allowed) throw tradeErr(tokenCheck.reason!, 'no_balance');
              rawAmountIn = Number(tokenCheck.rawSellAmount!);

              console.info(
                `[Executor] SELL ${sellPct}% of token ${tradeTokenMint.slice(0, 8)} ` +
                `= ${rawAmountIn} raw units (decimals=${tokenCheck.decimals})`,
              );
            }

            const result = await this.tradeExecutor.executeTrade(keypair, {
              direction:   tradeDirection,
              tokenMint:   tradeTokenMint,
              rawAmountIn,
              slippageBps: tradeSlippageBps ?? 100,
            });

            await tradeExecutionRepo.insert({
              txHash: result.txHash ?? null,
              userId: match.condition.userId,
              conditionId: match.condition.id,
              manual: false,
              direction: tradeDirection,
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
              await walletActivityRepo.insert(match.condition.userId, walletId, 'TRADE_EXECUTED', {
                txHash: result.txHash,
                status: result.status,
                direction: tradeDirection,
                inputMint: result.inputMint,
                outputMint: result.outputMint,
                rawAmountIn: result.amountIn,
                quoteOutAmount: result.quoteOutAmount ?? result.outAmount ?? null,
                priceImpactPct: result.priceImpactPct ?? null,
                slippageBps: result.slippageBps,
              });
            }

            if (!result.success && result.status === 'FAILED') {
              throw tradeErr(result.error ?? 'Trade failed on Jupiter');
            }

            if (effectiveMax === undefined) {
              await conditionRepo.incrementExecutionCount(match.condition.id);
            }

            if (result.status === 'PENDING' && result.txHash) {
              await pendingTxRepo.insert(
                result.txHash,
                match.condition.userId,
                match.condition.id,
                result.amountIn,
                result.inputMint,
                result.outputMint,
              );
            }

            this.walletManager.invalidateWallet(match.condition.userId);

            execResult = {
              tradeResult: {
                status: result.status,
                txHash: result.txHash,
                inputMint: result.inputMint,
                outputMint: result.outputMint,
                amountIn: result.amountIn,
                outAmount: result.outAmount,
                quoteOutAmount: result.quoteOutAmount,
                priceImpactPct: result.priceImpactPct ?? null,
                slippageBps: result.slippageBps,
                routeSummary: result.routeSummary,
                providerLabel: result.providerLabel,
                failureReason: result.error ?? result.confirmErr,
                latencyMs: result.latencyMs,
              },
            };
          } catch (e) {
            lockError = e;
            throw e;
          }
        }).catch(e => {
         
          if (!lockError) lockError = e;
          console.error('[Executor] Wallet lock error for', walletId, e);
        });

        this.walletLocks.set(walletId, nextLock);
        await nextLock;
        if (this.walletLocks.get(walletId) === nextLock) {
          this.walletLocks.delete(walletId);
        }

       
        if (lockError) throw lockError;
        if (!execResult) throw tradeErr('Wallet lock assertion failed');
        return execResult;
      }

      default:
        console.warn('[Executor] Unknown action type:', action.type);
        return {};
    }
  }
}

function buildSummary(actions: ActionResult[]): ExecutionSummary {
  return {
    total: actions.length,
    success: actions.filter(a => a.status === 'success').length,
    pending: actions.filter(a => a.status === 'pending').length,
    failed: actions.filter(a => a.status === 'failed').length,
  };
}

function isRetryable(err: unknown): boolean {
  const t = (err as any)?._errorType as ErrorType | undefined;
  if (t === 'trade_error' || t === 'no_wallet' || t === 'guard_rejected' || t === 'no_balance')
    return false;
  if (!axios.isAxiosError(err)) return true;
  if (!err.response) return true;
  const s = err.response.status;
  return s === 429 || s >= 500;
}

function classifyError(err: unknown): { errorType: ErrorType; message: string; responseStatus?: number } {
  const custom = (err as any)?._errorType as ErrorType | undefined;
  if (custom) return { errorType: custom, message: (err as Error).message };
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      const timeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.message.includes('timeout');
      return { errorType: timeout ? 'timeout' : 'network', message: err.message };
    }
    const s = err.response.status;
    if (s >= 400 && s < 500) return { errorType: 'bad_request',  message: `HTTP ${s}`, responseStatus: s };
    if (s >= 500)            return { errorType: 'server_error', message: `HTTP ${s}`, responseStatus: s };
  }
  return { errorType: 'network', message: String(err) };
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^::1$/.test(h) ||
    /^fc[0-9a-f]{2}:/i.test(h) ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  );
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (isPrivateHost(parsed.hostname)) return false; 
    return true;
  } catch {
    return false;
  }
}

import axios from 'axios';
import { type MatchResult }    from '../conditions/engine';
import { type ExecutionAction } from '../conditions/types';
import { type WalletManager }  from '../wallets/walletManager';
import { type TradeExecutor }  from './tradeExecutor';

type UserNotifyFn = (userId: string, payload: unknown) => void;

export type ErrorType =
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'server_error'
  | 'invalid_url'
  | 'trade_error'
  | 'no_wallet';

export interface TradeResultPayload {
  txHash?:    string;
  inputMint:  string;
  outputMint: string;
  amountIn:   number;
  latencyMs:  number;
}

export interface ActionResult {
  type:            string;
  status:          'success' | 'failed' | 'skipped';
  attempts:        number;
  durationMs:      number;
  error?:          string;
  errorType?:      ErrorType;
  responseStatus?: number;
  tradeResult?:    TradeResultPayload; // only set when type === 'TRADE'
}

export interface ExecutionSummary {
  total:   number;
  success: number;
  failed:  number;
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

export class ExecutionEngine {
  constructor(
    private readonly notify:        UserNotifyFn,
    private readonly walletManager: WalletManager,
    private readonly tradeExecutor: TradeExecutor,
  ) {}

  async execute(matches: MatchResult[]): Promise<ExecutionResult[]> {
    return Promise.all(matches.map(m => this.executeMatch(m)));
  }

  private async executeMatch(match: MatchResult): Promise<ExecutionResult> {
    const deliveryId    = makeDeliveryId(match);
    const actionResults: ActionResult[] = [];

    // Execute WEBHOOK + LOG + TRADE first; NOTIFY last (embeds results)
    for (const action of match.condition.actions) {
      if (action.type === 'NOTIFY') continue;

      // TRADE: single attempt only — retrying a signed+sent tx risks duplication
      const maxAttempts = action.type === 'TRADE' ? 1 : 3;
      actionResults.push(
        await this.dispatchWithRetry(match, action, maxAttempts, deliveryId),
      );
    }

    // NOTIFY last — carries complete execution context
    const hasNotify = match.condition.actions.some(a => a.type === 'NOTIFY');
    if (hasNotify) {
      const notifyResult: ActionResult = { type: 'NOTIFY', status: 'success', attempts: 1, durationMs: 0 };
      const allForClient = [...actionResults, notifyResult];
      const t0 = Date.now();

      this.notify(match.condition.userId, {
        conditionId:   match.condition.id,
        conditionName: match.condition.name,
        conditionType: match.condition.type,
        signature:     match.event.signature,
        eventType:     match.event.type,
        wallet:        match.event.wallet,
        tokenMint:     match.event.tokenMint,
        amount:        match.event.amount,
        matchedAt:     match.matchedAt,
        explanation:   match.explanation,
        execution: {
          deliveryId,
          actions: allForClient,
          summary: buildSummary(allForClient),
        },
      });

      actionResults.push({ type: 'NOTIFY', status: 'success', attempts: 1, durationMs: Date.now() - t0 });
    }

    return {
      conditionId: match.condition.id,
      matchedAt:   match.matchedAt,
      actions:     actionResults,
      summary:     buildSummary(actionResults),
    };
  }

  // ── Retry wrapper ──────────────────────────────────────────────────────────────

  private async dispatchWithRetry(
    match:       MatchResult,
    action:      ExecutionAction,
    maxAttempts: number,
    deliveryId:  string,
  ): Promise<ActionResult> {
    const start = Date.now();
    const type  = action.type;

    // Fast-fail: invalid webhook URL
    if (type === 'WEBHOOK') {
      if (!action.webhookUrl) {
        return { type, status: 'skipped', attempts: 0, durationMs: 0 };
      }
      if (!isValidUrl(action.webhookUrl)) {
        return { type, status: 'failed', attempts: 0, durationMs: 0, error: 'Invalid webhook URL', errorType: 'invalid_url' };
      }
    }

    let lastError:    string             = 'Unknown error';
    let lastErrType:  ErrorType          = 'network';
    let lastStatus:   number | undefined;
    let tradeResult:  TradeResultPayload | undefined;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        const result = await this.dispatch(match, action, deliveryId, attempt);
        tradeResult  = result.tradeResult;

        console.info(
          `[Executor] SUCCESS type=${type} cond=${match.condition.id}` +
          ` sig=${match.event.signature.slice(0, 12)} attempt=${attempt} ${Date.now() - start}ms`,
        );

        return { type, status: 'success', attempts, durationMs: Date.now() - start, tradeResult };
      } catch (err) {
        const cls   = classifyError(err);
        lastError   = cls.message;
        lastErrType = cls.errorType;
        lastStatus  = cls.responseStatus;

        const retryable = isRetryable(err);
        console.warn(
          `[Executor] FAIL type=${type} attempt=${attempt}/${maxAttempts}` +
          ` err=${lastErrType} retryable=${retryable} cond=${match.condition.id}`,
        );

        if (!retryable || attempt === maxAttempts) break;
        await sleep(500 * Math.pow(2, attempt - 1));
      }
    }

    console.error(
      `[Executor] PERMANENT_FAIL type=${type} cond=${match.condition.id}` +
      ` deliveryId=${deliveryId} err=${lastError}`,
    );

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

  // ── Core dispatch (throws on failure) ─────────────────────────────────────────

  private async dispatch(
    match:      MatchResult,
    action:     ExecutionAction,
    deliveryId: string,
    attempt:    number,
  ): Promise<{ tradeResult?: TradeResultPayload }> {
    const basePayload = {
      conditionId:   match.condition.id,
      conditionName: match.condition.name,
      conditionType: match.condition.type,
      signature:     match.event.signature,
      eventType:     match.event.type,
      wallet:        match.event.wallet,
      tokenMint:     match.event.tokenMint,
      amount:        match.event.amount,
      matchedAt:     match.matchedAt,
      explanation:   match.explanation,
      deliveryId,
      attempt,
      timestamp: Date.now(),
    };

    switch (action.type) {
      case 'WEBHOOK':
        await axios.post(action.webhookUrl!, basePayload, {
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
          deliveryId,
        }));
        return {};

      case 'TRADE': {
        if (!action.tradeDirection || !action.tradeTokenMint || !action.tradeAmountSol) {
          throw Object.assign(new Error('TRADE action missing required fields'), { _errorType: 'trade_error' as ErrorType });
        }

        const keypair = this.walletManager.getKeypair(match.condition.userId);
        if (!keypair) {
          throw Object.assign(
            new Error('No trading wallet found. Create one in the Wallet tab.'),
            { _errorType: 'no_wallet' as ErrorType },
          );
        }

        // Dedup guard: prevent double-trade for same (condition + event)
        const tradeKey = `${match.condition.id}:${match.event.signature}`;
        const allowed  = this.walletManager.markTradeSubmitted(tradeKey);
        if (!allowed) {
          throw Object.assign(
            new Error('Duplicate trade blocked — already submitted for this event'),
            { _errorType: 'trade_error' as ErrorType },
          );
        }

        const result = await this.tradeExecutor.executeTrade(keypair, {
          direction:   action.tradeDirection,
          tokenMint:   action.tradeTokenMint,
          amountSol:   action.tradeAmountSol,
          slippageBps: action.tradeSlippageBps ?? 100,
        });

        if (!result.success) {
          throw Object.assign(
            new Error(result.error ?? 'Trade failed'),
            { _errorType: 'trade_error' as ErrorType },
          );
        }

        return {
          tradeResult: {
            txHash:    result.txHash,
            inputMint:  result.inputMint,
            outputMint: result.outputMint,
            amountIn:   result.amountIn,
            latencyMs:  result.latencyMs,
          },
        };
      }

      default:
        console.warn('[Executor] Unknown action type:', action.type);
        return {};
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function buildSummary(actions: ActionResult[]): ExecutionSummary {
  return {
    total:   actions.length,
    success: actions.filter(a => a.status === 'success').length,
    failed:  actions.filter(a => a.status === 'failed').length,
  };
}

// Do NOT retry after sendRawTransaction (point of no return for trades).
// TRADE has maxAttempts=1 so this never runs for trades, but kept for clarity.
function isRetryable(err: unknown): boolean {
  if ((err as any)?._errorType === 'trade_error') return false;
  if ((err as any)?._errorType === 'no_wallet')   return false;
  if (!axios.isAxiosError(err))                   return true;
  if (!err.response)                              return true;
  const s = err.response.status;
  return s === 429 || s >= 500;
}

function classifyError(err: unknown): { errorType: ErrorType; message: string; responseStatus?: number } {
  const custom = (err as any)?._errorType as ErrorType | undefined;
  if (custom) return { errorType: custom, message: (err as Error).message };

  if (axios.isAxiosError(err)) {
    if (!err.response) {
      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
                        err.message.toLowerCase().includes('timeout');
      return { errorType: isTimeout ? 'timeout' : 'network', message: err.message };
    }
    const s = err.response.status;
    if (s >= 400 && s < 500) return { errorType: 'bad_request',  message: `HTTP ${s}`, responseStatus: s };
    if (s >= 500)            return { errorType: 'server_error', message: `HTTP ${s}`, responseStatus: s };
  }
  return { errorType: 'network', message: String(err) };
}

function isValidUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
}
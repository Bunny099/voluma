import axios from 'axios';
import { type MatchResult } from '../conditions/engine';

type UserNotifyFn = (userId: string, payload: unknown) => void;

export type ErrorType =
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'server_error'
  | 'invalid_url';

export interface ActionResult {
  type:            string;
  status:          'success' | 'failed' | 'skipped';
  attempts:        number;
  durationMs:      number;
  error?:          string;
  errorType?:      ErrorType;
  responseStatus?: number;
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
  constructor(private readonly notify: UserNotifyFn) {}

  async execute(matches: MatchResult[]): Promise<ExecutionResult[]> {
    return Promise.all(matches.map(m => this.executeMatch(m)));
  }

  private async executeMatch(match: MatchResult): Promise<ExecutionResult> {
    const deliveryId = makeDeliveryId(match);
    const actionResults: ActionResult[] = [];

    for (const action of match.condition.actions) {
      if (action.type !== 'NOTIFY') {
        actionResults.push(
          await this.dispatchWithRetry(match, action.type, action.webhookUrl, 3, deliveryId),
        );
      }
    }

    const hasNotify = match.condition.actions.some(a => a.type === 'NOTIFY');
    if (hasNotify) {
      const notifyStart   = Date.now();
      const notifyResult: ActionResult = { type: 'NOTIFY', status: 'success', attempts: 1, durationMs: 0 };
      const allForClient  = [...actionResults, notifyResult];

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

      actionResults.push({
        type:       'NOTIFY',
        status:     'success',
        attempts:   1,
        durationMs: Date.now() - notifyStart,
      });
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
    type:        string,
    webhookUrl:  string | undefined,
    maxAttempts: number,
    deliveryId:  string,
  ): Promise<ActionResult> {
    const start = Date.now();

    if (type === 'WEBHOOK') {
      if (!webhookUrl) {
        return { type, status: 'skipped', attempts: 0, durationMs: 0 };
      }
      if (!isValidWebhookUrl(webhookUrl)) {
        console.warn(
          `[Executor] INVALID_URL conditionId=${match.condition.id} url=${webhookUrl}`,
        );
        return {
          type,
          status:    'failed',
          attempts:  0,
          durationMs: 0,
          error:     'Invalid webhook URL — must start with http:// or https://',
          errorType: 'invalid_url',
        };
      }
    }

    let lastError:          string          = 'Unknown error';
    let lastErrorType:      ErrorType       = 'network';
    let lastResponseStatus: number | undefined;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        await this.dispatch(match, type, webhookUrl, deliveryId, attempt);

        console.info(
          `[Executor] SUCCESS type=${type} conditionId=${match.condition.id}` +
          ` sig=${match.event.signature.slice(0, 12)} deliveryId=${deliveryId}` +
          ` attempts=${attempt} duration=${Date.now() - start}ms`,
        );

        return { type, status: 'success', attempts, durationMs: Date.now() - start };
      } catch (err) {
        const cls      = classifyError(err);
        lastError          = cls.message;
        lastErrorType      = cls.errorType;
        lastResponseStatus = cls.responseStatus;

        const retryable = isRetryable(err);
        console.warn(
          `[Executor] ATTEMPT_FAILED type=${type} attempt=${attempt}/${maxAttempts}` +
          ` errorType=${lastErrorType} retryable=${retryable}` +
          ` conditionId=${match.condition.id} sig=${match.event.signature.slice(0, 12)}`,
        );

        if (!retryable || attempt === maxAttempts) break;
        await sleep(500 * Math.pow(2, attempt - 1)); // 500ms, 1s, 2s
      }
    }

    console.error(
      `[Executor] FAILURE type=${type} conditionId=${match.condition.id}` +
      ` sig=${match.event.signature.slice(0, 12)} deliveryId=${deliveryId}` +
      ` errorType=${lastErrorType} error=${lastError}`,
    );

    return {
      type,
      status:         'failed',
      attempts,
      durationMs:     Date.now() - start,
      error:          lastError,
      errorType:      lastErrorType,
      responseStatus: lastResponseStatus,
    };
  }

  // ── Core dispatch (throws on failure — retry wrapper catches) ────────────────

  private async dispatch(
    match:      MatchResult,
    type:       string,
    webhookUrl: string | undefined,
    deliveryId: string,
    attempt:    number,
  ): Promise<void> {
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

    switch (type) {
      case 'WEBHOOK':
        if (!webhookUrl) return;
        await axios.post(webhookUrl, basePayload, {
          timeout: 5_000,
          headers: {
            'Content-Type':             'application/json',
            'X-Voluma-Idempotency-Key': `${match.condition.id}:${match.event.signature}`,
            'X-Voluma-Delivery-Id':     deliveryId,
            'X-Voluma-Attempt':         String(attempt),
          },
        });
        break;

      case 'LOG':
        console.log('[Trigger]', JSON.stringify({
          condition:   match.condition.name,
          type:        match.condition.type,
          explanation: match.explanation.reason,
          signature:   match.event.signature,
          deliveryId,
        }));
        break;

      default:
        console.warn('[Executor] Unknown action type:', type);
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

function isRetryable(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return true;  
  if (!err.response)            return true;  
  const s = err.response.status;
  return s === 429 || s >= 500;
}

function classifyError(err: unknown): {
  errorType: ErrorType; message: string; responseStatus?: number;
} {
  if (axios.isAxiosError(err)) {
    if (
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT'   ||
      err.message.toLowerCase().includes('timeout')
    ) return { errorType: 'timeout', message: 'Request timed out after 5s' };

    if (!err.response) return { errorType: 'network', message: err.message || 'Network error' };

    const s = err.response.status;
    if (s >= 400 && s < 500) return { errorType: 'bad_request',  message: `HTTP ${s}`, responseStatus: s };
    if (s >= 500)            return { errorType: 'server_error', message: `HTTP ${s}`, responseStatus: s };
  }
  return { errorType: 'network', message: String(err) };
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
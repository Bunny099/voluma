import { type Condition } from '../conditions/types';
import { type NormalizedEvent } from '../ingestion/provider';

export interface TriggerExplanation {
  reason:        string;
  matchedFields: string[];
  confidence:    'HIGH' | 'MEDIUM' | 'LOW';
  details:       Record<string, unknown>;
}

export interface MatchResult {
  condition:   Condition;
  event:       NormalizedEvent;
  matchedAt:   number;
  explanation: TriggerExplanation;
}

interface EvalResult {
  matched:      boolean;
  explanation?: TriggerExplanation;
}

interface VolumeEntry { ts: number; amount: number; }

const CLEANUP_INTERVAL_MS = 2 * 60 * 1_000;
const MAX_WINDOW_ENTRIES  = 10_000;
const FIRE_CACHE_MAX      = 10_000;


const DEBUG_MINT = process.env.DEBUG_MINT_MATCHING === 'true';

export class ConditionEngine {
  // ── Inverted indexes ────────────────────────────────────────────────────────
  private walletIdx      = new Map<string, Set<string>>();
  private tokenIdx       = new Map<string, Set<string>>();
  private globalBurst    = new Set<string>();
  private swapTokenConds = new Set<string>();
  private conditions     = new Map<string, Condition>();

  // ── State ───────────────────────────────────────────────────────────────────
  private cooldowns      = new Map<string, number>();
  private swapCounts     = new Map<string, number[]>();
  private volumes        = new Map<string, VolumeEntry[]>();
  private aboveThreshold = new Map<string, boolean>();
  private fireCache      = new Set<string>();

  constructor() {
    setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS).unref();
  }

  // ── Index management ─────────────────────────────────────────────────────────

  load(condition: Condition): void {
    this.conditions.set(condition.id, condition);

    if (condition.wallet) {
      getOrCreate(this.walletIdx, condition.wallet).add(condition.id);
    }
    if (condition.type === 'SWAP_BURST' || condition.type === 'TOKEN_VOLUME') {
      if (condition.tokenMint) {    
        getOrCreate(this.tokenIdx, condition.tokenMint).add(condition.id);
        this.swapTokenConds.add(condition.id);
      } else {
        this.globalBurst.add(condition.id);
      }
    }
   
  }

  unload(conditionId: string): void {
    const cond = this.conditions.get(conditionId);
    if (!cond) return;
    this.conditions.delete(conditionId);
    cond.wallet    && this.walletIdx.get(cond.wallet)?.delete(conditionId);
    cond.tokenMint && this.tokenIdx.get(cond.tokenMint)?.delete(conditionId);
    this.globalBurst.delete(conditionId);
    this.swapTokenConds.delete(conditionId); // ← must clean up
    this.cooldowns.delete(conditionId);
    this.aboveThreshold.delete(conditionId);
  }

  // ── Evaluation ───────────────────────────────────────────────────────────────

  async evaluate(event: NormalizedEvent): Promise<MatchResult[]> {
    const candidates = new Set<string>();

    // Standard index lookups
    if (event.wallet)    for (const id of this.walletIdx.get(event.wallet)   ?? []) candidates.add(id);
    if (event.tokenMint) for (const id of this.tokenIdx.get(event.tokenMint) ?? []) candidates.add(id);
    for (const id of this.globalBurst) candidates.add(id);

    if (event.type === 'SWAP' && this.swapTokenConds.size > 0) {
      for (const id of this.swapTokenConds) candidates.add(id);
    }

    if (!candidates.size) return [];

    const results: MatchResult[] = [];
    for (const id of candidates) {
      const r = this.check(id, event);
      if (r !== null) results.push(r);
    }
    return results;
  }

  private check(id: string, event: NormalizedEvent): MatchResult | null {
    const cond = this.conditions.get(id);
    if (!cond || !cond.enabled)  return null;
    if (this.cooldownActive(id)) return null;

    const fireKey = `${id}:${event.signature}`;
    if (this.fireCache.has(fireKey)) return null;

    let result: EvalResult = { matched: false };
    switch (cond.type) {
      case 'WALLET_ACTIVITY': result = this.evalWalletActivity(cond, event); break;
      case 'SWAP_BURST':      result = this.evalSlidingCount(cond, event);   break;
      case 'TOKEN_VOLUME':    result = this.evalSlidingVolume(cond, event);  break;
      case 'LARGE_TRANSFER':  result = this.evalLargeTransfer(cond, event);  break;
    }

    if (!result.matched || !result.explanation) return null;

    this.fireCache.add(fireKey);
    if (this.fireCache.size > FIRE_CACHE_MAX) this.trimFireCache();
    this.setCooldown(id, cond.cooldownSeconds || 60);

    return { condition: cond, event, matchedAt: Date.now(), explanation: result.explanation };
  }

  // ── Matchers ──────────────────────────────────────────────────────────────────

  private evalWalletActivity(cond: Condition, event: NormalizedEvent): EvalResult {
    if (event.confidence === 'LOW') return { matched: false };
    if (!event.wallet)              return { matched: false };
    if (cond.wallet && event.wallet !== cond.wallet) return { matched: false };
    if (
      cond.transactionType &&
      cond.transactionType !== 'ANY' &&
      event.type !== cond.transactionType
    ) return { matched: false };

    const matchedFields: string[] = ['wallet'];
    const details: Record<string, unknown> = {
      wallet:     event.wallet,
      eventType:  event.type,
      confidence: event.confidence,
    };

    if (cond.minAmountSol && event.amount) {
      const sol = event.amount / 1e9;
      if (sol < cond.minAmountSol) return { matched: false };
      matchedFields.push('amount');
      details.amountSol    = sol.toFixed(4);
      details.minAmountSol = cond.minAmountSol;
    }

    const txLabel = cond.transactionType && cond.transactionType !== 'ANY'
      ? cond.transactionType : 'any transaction';

    return {
      matched: true,
      explanation: {
        reason:        `Wallet ${event.wallet.slice(0, 8)}… detected — ${txLabel}`,
        matchedFields,
        confidence:    event.confidence,
        details,
      },
    };
  }

  private evalSlidingCount(cond: Condition, event: NormalizedEvent): EvalResult {
    if (event.type !== 'SWAP') return { matched: false };

    if (cond.tokenMint) {
      const matched = this.mintMatches(cond.tokenMint, event);
      if (!matched) return { matched: false };
    }
    const windowMs  = (cond.windowSeconds ?? 30) * 1_000;
    const key       = `swaps:${cond.tokenMint ?? 'all'}`;
    const now       = Date.now();
    const cutoff    = now - windowMs;
    const threshold = cond.minSwaps ?? 50;
   
    const arr = (this.swapCounts.get(key) ?? []).filter(ts => ts >= cutoff);
    arr.push(now);
    if (arr.length > MAX_WINDOW_ENTRIES) arr.splice(0, arr.length - MAX_WINDOW_ENTRIES);
    this.swapCounts.set(key, arr);

    const isAbove  = arr.length >= threshold;
    const wasAbove = this.aboveThreshold.get(cond.id) ?? false;
    this.aboveThreshold.set(cond.id, isAbove);

    if (!isAbove || wasAbove) return { matched: false };

    return {
      matched: true,
      explanation: {
        reason:        `${arr.length} swaps in ${cond.windowSeconds ?? 30}s (threshold: ${threshold})`,
        matchedFields: ['swapCount', 'window'],
        confidence:    'HIGH',
        details: {
          swapsInWindow: arr.length,
          windowSeconds: cond.windowSeconds ?? 30,
          threshold,
          tokenMint:     cond.tokenMint ?? 'any',
        },
      },
    };
  }

  private evalSlidingVolume(cond: Condition, event: NormalizedEvent): EvalResult {
    if (!event.amount) return { matched: false };

    if (cond.tokenMint) {
      const matched = this.mintMatches(cond.tokenMint, event);
      if (!matched) return { matched: false };
    }

    const windowMs  = (cond.windowSeconds ?? 60) * 1_000;
    const key       = `vol:${cond.tokenMint ?? 'all'}`;
    const now       = Date.now();
    const cutoff    = now - windowMs;
    const threshold = cond.minVolumeSol ?? 1_000;
   
    const arr = (this.volumes.get(key) ?? []).filter(e => e.ts >= cutoff);
    arr.push({ ts: now, amount: event.amount! });
    if (arr.length > MAX_WINDOW_ENTRIES) arr.splice(0, arr.length - MAX_WINDOW_ENTRIES);
    this.volumes.set(key, arr);

    const totalSol = arr.reduce((s, e) => s + e.amount, 0) / 1e9;
    const isAbove  = totalSol >= threshold;
    const wasAbove = this.aboveThreshold.get(cond.id) ?? false;
    this.aboveThreshold.set(cond.id, isAbove);

    if (!isAbove || wasAbove) return { matched: false };

    return {
      matched: true,
      explanation: {
        reason:        `${totalSol.toFixed(0)} SOL volume in ${cond.windowSeconds ?? 60}s (threshold: ${threshold})`,
        matchedFields: ['volume', 'window'],
        confidence:    'HIGH',
        details: {
          totalSol:      totalSol.toFixed(2),
          windowSeconds: cond.windowSeconds ?? 60,
          threshold,
          tokenMint:     cond.tokenMint ?? 'any',
        },
      },
    };
  }

  private evalLargeTransfer(cond: Condition, event: NormalizedEvent): EvalResult {
    if (event.type !== 'TRANSFER' || !event.amount) return { matched: false };
    const sol       = event.amount / 1e9;
    const threshold = cond.minSol ?? 100;
    if (sol < threshold) return { matched: false };

    return {
      matched: true,
      explanation: {
        reason:        `Large transfer: ${sol.toFixed(2)} SOL (threshold: ${threshold})`,
        matchedFields: ['amount', 'type'],
        confidence:    event.confidence,
        details: { amountSol: sol.toFixed(4), threshold, wallet: event.wallet },
      },
    };
  }



  private mintMatches(conditionMint: string, event: NormalizedEvent): boolean {
    const exactMatch = !!event.tokenMint && event.tokenMint === conditionMint;
    const logsMatch  = !exactMatch && !!event.rawLogs?.includes(conditionMint);
    const matched = exactMatch || logsMatch;

    if (DEBUG_MINT) {
      console.log(
        `[MatchDebug] conditionMint=${conditionMint} ` +
        `eventMint=${event.tokenMint ?? 'null'} ` +
        `exactMatch=${exactMatch} logsMatch=${logsMatch} ` +
        `matched=${matched} sig=${event.signature.slice(0, 12)}`
      );
    }

    return matched;
  }

  // ── Cooldown ──────────────────────────────────────────────────────────────────

  private cooldownActive(id: string): boolean {
    const expiry = this.cooldowns.get(id);
    if (expiry === undefined) return false;
    if (Date.now() >= expiry) {
      this.cooldowns.delete(id);
      this.aboveThreshold.delete(id);
      return false;
    }
    return true;
  }

  private setCooldown(id: string, seconds: number): void {
    this.cooldowns.set(id, Date.now() + seconds * 1_000);
  }

  private trimFireCache(): void {
    const arr = [...this.fireCache];
    this.fireCache.clear();
    for (const k of arr.slice(arr.length >>> 1)) this.fireCache.add(k);
  }

  // ── Periodic cleanup ──────────────────────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();

    for (const [id, exp] of this.cooldowns) {
      if (now >= exp) { this.cooldowns.delete(id); this.aboveThreshold.delete(id); }
    }
    for (const [k, arr] of this.swapCounts) {
      const f = arr.filter(ts => now - ts < 3_600_000);
      f.length ? this.swapCounts.set(k, f) : this.swapCounts.delete(k);
    }
    for (const [k, arr] of this.volumes) {
      const f = arr.filter(e => now - e.ts < 3_600_000);
      f.length ? this.volumes.set(k, f) : this.volumes.delete(k);
    }
    for (const [id] of this.aboveThreshold) {
      if (!this.conditions.has(id)) this.aboveThreshold.delete(id);
    }
  }
}

function getOrCreate<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  let s = map.get(key);
  if (!s) { s = new Set(); map.set(key, s); }
  return s;
}
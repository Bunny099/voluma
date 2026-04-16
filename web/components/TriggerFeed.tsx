'use client';
import { type TriggerEvent, type ActionResult, type ExecutionSummary, type TradeResultPayload } from '@/hooks/useSocket';
import { formatDistanceToNowStrict } from 'date-fns';

// ── Importance ────────────────────────────────────────────────────────────────

type Importance = 'critical' | 'high' | 'normal';

function getImportance(ev: TriggerEvent): Importance {
  const sol  = ev.amount ? ev.amount / 1e9 : 0;
  const conf = ev.explanation?.confidence;
  const hasTrade = ev.execution?.actions.some(a => a.type === 'TRADE');
  if (hasTrade)                                    return 'high'; // trades always highlighted
  if (ev.conditionType === 'LARGE_TRANSFER') return sol >= 1_000 ? 'critical' : 'high';
  if (ev.conditionType === 'TOKEN_VOLUME')   return 'high';
  if (conf === 'HIGH' && sol >= 100)         return 'high';
  return 'normal';
}

const IMPORTANCE_BORDER: Record<Importance, string> = {
  critical: 'border-l-4 border-l-red-500   bg-red-500/5',
  high:     'border-l-4 border-l-amber-400 bg-amber-400/5',
  normal:   'border-l-4 border-l-transparent',
};

const IMPORTANCE_LABEL: Record<Importance, string | null> = {
  critical: '🔴 CRITICAL',
  high:     '🟡 HIGH',
  normal:   null,
};

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: ExecutionSummary }) {
  const allGood = summary.failed === 0;
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-mono ${allGood ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
      <span>{allGood ? '✓' : '✗'}</span>
      <span>{summary.success}/{summary.total} action{summary.total !== 1 ? 's' : ''} succeeded</span>
      {summary.failed > 0 && <span className="text-red-400">{summary.failed} failed</span>}
    </div>
  );
}

// ── Trade result row ──────────────────────────────────────────────────────────

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function truncateMint(mint: string) { return `${mint.slice(0, 6)}…${mint.slice(-4)}`; }

function TradeResultRow({ result, status, error }: {
  result?: TradeResultPayload;
  status:  ActionResult['status'];
  error?:  string;
}) {
  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 bg-red-950/40 border border-red-900/40 rounded-lg px-3 py-2">
        <span className="text-red-500 text-sm">✗</span>
        <div>
          <p className="text-[10px] font-semibold text-red-400">Trade failed</p>
          {error && <p className="text-[10px] text-red-500/80 font-mono mt-0.5">{error}</p>}
        </div>
      </div>
    );
  }

  if (!result) return null;

  const isBuy      = result.inputMint  === SOL_MINT;
  const tokenMint  = isBuy ? result.outputMint : result.inputMint;
  const solIn      = (result.amountIn / 1e9).toFixed(4);
  const direction  = isBuy ? 'BUY' : 'SELL';
  const dirColor   = isBuy ? 'text-emerald-400' : 'text-red-400';
  const dirBg      = isBuy ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div className={`rounded-lg border px-3 py-2 ${dirBg}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold font-mono ${dirColor}`}>◎ {direction}</span>
          <span className="text-[10px] text-zinc-400 font-mono">
            {solIn} SOL {isBuy ? '→' : '←'} {truncateMint(tokenMint)}
          </span>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">{result.latencyMs}ms</span>
      </div>
      {result.txHash && (
        <a
          href={`https://solscan.io/tx/${result.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          TX: {result.txHash.slice(0, 16)}… ↗
        </a>
      )}
    </div>
  );
}

// ── Action badge ──────────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed:  'bg-red-500/10     text-red-400     border-red-500/20',
  skipped: 'bg-zinc-500/10   text-zinc-500    border-zinc-500/20',
};
const STATUS_DOT: Record<string, string> = {
  success: 'bg-emerald-500',
  failed:  'bg-red-500',
  skipped: 'bg-zinc-500',
};

function ActionBadge({ action }: { action: ActionResult }) {
  if (action.type === 'TRADE') return null; // TradeResultRow renders TRADE separately
  const pill = STATUS_PILL[action.status] ?? STATUS_PILL.skipped;
  const dot  = STATUS_DOT[action.status]  ?? STATUS_DOT.skipped;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${pill}`}
      title={[action.attempts > 1 ? `${action.attempts} attempts` : null, action.durationMs ? `${action.durationMs}ms` : null].filter(Boolean).join(' · ') || undefined}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
      {action.type}
      {action.attempts > 1 && <span className="opacity-60">×{action.attempts}</span>}
    </span>
  );
}

// ── Failure detail row ────────────────────────────────────────────────────────

function FailureDetail({ action }: { action: ActionResult }) {
  if (action.type === 'TRADE') return null; // rendered in TradeResultRow
  const label = action.errorType
    ? ({ timeout: 'timed out', network: 'network error', bad_request: `bad request${action.responseStatus ? ` (${action.responseStatus})` : ''}`, server_error: `server error${action.responseStatus ? ` (${action.responseStatus})` : ''}`, invalid_url: 'invalid URL', trade_error: 'trade error', no_wallet: 'no trading wallet' })[action.errorType] ?? action.errorType
    : action.error ?? 'unknown failure';
  return (
    <div className="bg-red-950/40 border border-red-900/40 rounded px-2 py-1">
      <span className="text-[10px] font-mono text-red-400">
        {action.type} · {label}{action.attempts > 1 ? ` · after ${action.attempts} attempts` : ''}
      </span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  WALLET_ACTIVITY: 'text-violet-400',
  SWAP_BURST:      'text-amber-400',
  TOKEN_VOLUME:    'text-sky-400',
  LARGE_TRANSFER:  'text-red-400',
};

const CONFIDENCE_PILL: Record<string, string> = {
  HIGH:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  MEDIUM: 'bg-amber-500/10   text-amber-400   border-amber-500/20',
  LOW:    'bg-zinc-500/10    text-zinc-400    border-zinc-500/20',
};

function truncate(s: string, n = 10) { return `${s.slice(0, n)}…${s.slice(-4)}`; }

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { events: TriggerEvent[]; onClear: () => void; }

export default function TriggerFeed({ events, onClear }: Props) {
  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
        <span className="text-4xl">⚡</span>
        <p className="text-sm font-mono">No triggers yet</p>
        <p className="text-xs text-zinc-700">Conditions are watching Solana mainnet</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
          {events.length} trigger{events.length !== 1 ? 's' : ''}
        </span>
        <button onClick={onClear} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
          Clear all
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.map((ev) => {
          const importance   = getImportance(ev);
          const importLabel  = IMPORTANCE_LABEL[importance];
          const actions      = ev.execution?.actions ?? [];
          const summary      = ev.execution?.summary;
          const tradeAction  = actions.find(a => a.type === 'TRADE');
          const failedActions = actions.filter(a => a.status === 'failed');
          const nonTradeActions = actions.filter(a => a.type !== 'TRADE');

          return (
            <div
              key={`${ev.conditionId}-${ev.matchedAt}`}
              className={`border-b border-zinc-900 px-4 py-3 transition-colors hover:bg-zinc-900/20 ${IMPORTANCE_BORDER[importance]}`}
            >
              {/* Importance */}
              {importLabel && (
                <div className="text-[10px] font-mono font-semibold tracking-wider opacity-60 mb-1">
                  {importLabel}
                </div>
              )}

              {/* Condition name + age */}
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-semibold ${TYPE_COLOR[ev.conditionType] ?? 'text-zinc-300'}`}>
                  {ev.conditionName}
                </span>
                <span className="text-[10px] text-zinc-600 font-mono">
                  {formatDistanceToNowStrict(ev.matchedAt)} ago
                </span>
              </div>

              {/* Explanation */}
              {ev.explanation?.reason && (
                <p className="text-xs text-zinc-300 mb-2 leading-snug">{ev.explanation.reason}</p>
              )}

              {/* Matched fields + confidence */}
              {ev.explanation && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {ev.explanation.matchedFields.map(f => (
                    <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{f}</span>
                  ))}
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${CONFIDENCE_PILL[ev.explanation.confidence] ?? ''}`}>
                    {ev.explanation.confidence}
                  </span>
                </div>
              )}

              {/* Details grid */}
              {ev.explanation?.details && Object.keys(ev.explanation.details).length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-2">
                  {Object.entries(ev.explanation.details).map(([k, v]) => (
                    <div key={k} className="flex gap-1 text-[10px] font-mono">
                      <span className="text-zinc-600 shrink-0">{k}:</span>
                      <span className="text-zinc-400 truncate">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Trade result — shown prominently above other action badges */}
              {tradeAction && (
                <div className="mb-2">
                  <TradeResultRow
                    result={tradeAction.tradeResult}
                    status={tradeAction.status}
                    error={tradeAction.error}
                  />
                </div>
              )}

              {/* Execution summary */}
              {summary && (
                <div className="mb-2"><SummaryBar summary={summary} /></div>
              )}

              {/* Non-trade action badges */}
              {nonTradeActions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {nonTradeActions.map((a, i) => <ActionBadge key={`${a.type}-${i}`} action={a} />)}
                </div>
              )}

              {/* Non-trade failure details */}
              {failedActions.filter(a => a.type !== 'TRADE').length > 0 && (
                <div className="space-y-1 mb-2">
                  {failedActions.filter(a => a.type !== 'TRADE').map((a, i) => (
                    <FailureDetail key={i} action={a} />
                  ))}
                </div>
              )}

              {/* Tx link */}
              <a href={`https://solscan.io/tx/${ev.signature}`} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono text-zinc-700 hover:text-zinc-500 transition-colors">
                {truncate(ev.signature, 14)} ↗
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
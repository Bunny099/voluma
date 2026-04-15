'use client';
import { formatDistanceToNowStrict } from 'date-fns';
import { type ConditionWithStats }   from '../conditions/types';

const TYPE_COLORS: Record<string, string> = {
  WALLET_ACTIVITY: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  SWAP_BURST:      'bg-amber-500/10  text-amber-400  border-amber-500/20',
  TOKEN_VOLUME:    'bg-sky-500/10    text-sky-400    border-sky-500/20',
  LARGE_TRANSFER:  'bg-red-500/10    text-red-400    border-red-500/20',
};

const TYPE_LABELS: Record<string, string> = {
  WALLET_ACTIVITY: 'Wallet',
  SWAP_BURST:      'Swap burst',
  TOKEN_VOLUME:    'Volume',
  LARGE_TRANSFER:  'Large xfer',
};

function isRecentlyActive(lastTriggered: number | null): boolean {
  if (!lastTriggered) return false;
  return Date.now() - lastTriggered < 30_000;
}

function isHighFrequency(cond: ConditionWithStats): boolean {
  if (!cond.lastTriggered || cond.triggerCount < 2) return false;
  return Date.now() - cond.lastTriggered < cond.cooldownSeconds * 2 * 1_000;
}

interface Props {
  conditions: ConditionWithStats[];
  loading:    boolean;
  onDelete:   (id: string) => void;
  onToggle:   (id: string, enabled: boolean) => void;
}

export default function ConditionList({ conditions, loading, onDelete, onToggle }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-[72px] rounded-lg bg-zinc-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!conditions.length) {
    return (
      <div className="text-center py-8 text-zinc-600 text-xs font-mono">
        No conditions yet — create one below
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conditions.map(cond => {
        const active   = isRecentlyActive(cond.lastTriggered);
        const highFreq = isHighFrequency(cond);

        return (
          <div
            key={cond.id}
            className={`
              rounded-lg border transition-all
              ${cond.enabled ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-900/40 border-zinc-800/50 opacity-55'}
              ${highFreq ? 'border-amber-500/30' : ''}
            `}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Activity pulse */}
              <div className="relative shrink-0">
                <div className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                {active && (
                  <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                )}
              </div>

              {/* Type badge */}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${TYPE_COLORS[cond.type] ?? ''}`}>
                {TYPE_LABELS[cond.type] ?? cond.type}
              </span>

              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 font-medium truncate">{cond.name}</p>
                <p className="text-[10px] text-zinc-600 font-mono truncate">
                  {cond.wallet
                    ? `${cond.wallet.slice(0, 8)}…`
                    : cond.tokenMint
                    ? `mint ${cond.tokenMint.slice(0, 6)}…`
                    : 'global'
                  }
                  {' · '}cd {cond.cooldownSeconds}s
                  {' · '}
                  {cond.actions.map(a => a.type[0]).join('+')}
                </p>
              </div>

              {highFreq && (
                <span className="text-[10px] font-mono text-amber-500 shrink-0" title="Firing more often than expected">
                  ⚠ freq
                </span>
              )}

              {/* Toggle */}
              <button
                onClick={() => onToggle(cond.id, !cond.enabled)}
                aria-label={cond.enabled ? 'Disable condition' : 'Enable condition'}
                className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${cond.enabled ? 'bg-emerald-600' : 'bg-zinc-700'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${cond.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                />
              </button>

              {/* Delete */}
              <button
                onClick={() => onDelete(cond.id)}
                aria-label="Delete condition"
                className="text-zinc-700 hover:text-red-500 transition-colors text-sm shrink-0 px-1"
              >
                ✕
              </button>
            </div>

            {/* Trigger stats row */}
            {cond.triggerCount > 0 && (
              <div className="px-4 pb-2.5 flex items-center gap-2 border-t border-zinc-800/50 pt-2">
                <span className="text-[10px] font-mono text-emerald-600">
                  ⚡ {cond.triggerCount} trigger{cond.triggerCount !== 1 ? 's' : ''}
                </span>
                {cond.lastTriggered && (
                  <span className="text-[10px] font-mono text-zinc-600">
                    · last {formatDistanceToNowStrict(cond.lastTriggered)} ago
                  </span>
                )}
                {active && (
                  <span className="text-[10px] font-mono text-emerald-500 ml-auto">recently active</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
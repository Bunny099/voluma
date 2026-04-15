'use client';
import { useState, useMemo }         from 'react';
import { formatDistanceToNowStrict } from 'date-fns';

interface LiveEvent {
  signature:  string;
  eventType:  'SWAP' | 'TRANSFER' | 'UNKNOWN';
  tokenMint?: string;
  timestamp:  number;
}

const TYPE_CONFIG = {
  SWAP:     { label: 'SWAP',     color: 'text-violet-400', dot: 'bg-violet-500' },
  TRANSFER: { label: 'TRANSFER', color: 'text-sky-400',    dot: 'bg-sky-500'    },
  UNKNOWN:  { label: 'TX',       color: 'text-zinc-500',   dot: 'bg-zinc-600'   },
};

type FilterType = 'ALL' | 'SWAP' | 'TRANSFER' | 'UNKNOWN';

function truncate(addr: string, chars = 8) {
  return `${addr.slice(0, chars)}…${addr.slice(-4)}`;
}

interface Props {
  events:       LiveEvent[];
  triggeredSigs: Map<string, string>; 
}

export default function EventFeed({ events, triggeredSigs }: Props) {
  const [filter,   setFilter]   = useState<FilterType>('ALL');
  const [paused,   setPaused]   = useState(false);
  const [snapshot, setSnapshot] = useState<LiveEvent[] | null>(null);

  const handlePause = () => {
    if (!paused) setSnapshot([...events]);
    else         setSnapshot(null);
    setPaused(p => !p);
  };

  const displayed = paused ? (snapshot ?? events) : events;
  const filtered  = useMemo(
    () => filter === 'ALL' ? displayed : displayed.filter(e => e.eventType === filter),
    [displayed, filter],
  );

  const triggeredCount = useMemo(
    () => filtered.filter(e => triggeredSigs.has(e.signature)).length,
    [filtered, triggeredSigs],
  );

  const FILTERS: FilterType[] = ['ALL', 'SWAP', 'TRANSFER', 'UNKNOWN'];

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`
                text-[10px] font-mono px-2 py-0.5 rounded transition-colors
                ${filter === f ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}
              `}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {triggeredCount > 0 && (
          <span className="text-[10px] font-mono text-emerald-500">
            ⚡ {triggeredCount} triggered
          </span>
        )}

        <span className="text-[10px] text-zinc-700 font-mono">
          {filtered.length}/{events.length}
        </span>

        <button
          onClick={handlePause}
          className={`
            text-[10px] font-mono px-2 py-0.5 rounded border transition-colors
            ${paused
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }
          `}
        >
          {paused ? '▶ resume' : '⏸ pause'}
        </button>
      </div>

      {/* List */}
      {!filtered.length ? (
        <div className="flex flex-col items-center justify-center flex-1 text-zinc-600 gap-2">
          <span className="text-2xl">◎</span>
          <p className="text-xs font-mono">
            {events.length === 0 ? 'Waiting for events…' : `No ${filter} events`}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-[#080b0f] border-b border-zinc-800">
              <tr className="text-zinc-600 text-[10px] uppercase tracking-wider">
                <th className="py-2 px-4 text-left w-24">Type</th>
                <th className="py-2 px-4 text-left">Signature</th>
                <th className="py-2 px-4 text-left">Token</th>
                <th className="py-2 px-4 text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => {
                const cfg          = TYPE_CONFIG[ev.eventType] ?? TYPE_CONFIG.UNKNOWN;
                const condName     = triggeredSigs.get(ev.signature);
                const isTriggered  = condName !== undefined;

                return (
                  <tr
                    key={ev.signature}
                    className={`
                      border-b transition-colors
                      ${isTriggered
                        ? 'border-b-emerald-900/40 bg-emerald-500/5 hover:bg-emerald-500/8'
                        : 'border-b-zinc-900       hover:bg-zinc-900/40'
                      }
                    `}
                  >
                    {/* Type */}
                    <td className="py-1.5 px-4 align-top">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className={cfg.color}>{cfg.label}</span>
                        {isTriggered && <span className="text-emerald-500 text-[9px]">⚡</span>}
                      </span>
                    </td>

                    {/* Signature + condition name */}
                    <td className="py-1.5 px-4 align-top">
                      <a
                        href={`https://solscan.io/tx/${ev.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`transition-colors ${
                          isTriggered
                            ? 'text-emerald-400 hover:text-emerald-300'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {truncate(ev.signature, 12)}
                      </a>
                      {/* Condition name label — only for triggered events */}
                      {isTriggered && condName && (
                        <div className="text-[9px] text-emerald-700 mt-0.5 truncate max-w-[160px]">
                          via {condName}
                        </div>
                      )}
                    </td>

                    {/* Token */}
                    <td className="py-1.5 px-4 text-zinc-600 align-top">
                      {ev.tokenMint ? truncate(ev.tokenMint) : '—'}
                    </td>

                    {/* Age */}
                    <td className="py-1.5 px-4 text-right text-zinc-600 align-top">
                      {formatDistanceToNowStrict(ev.timestamp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
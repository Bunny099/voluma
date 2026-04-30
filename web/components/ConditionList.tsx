'use client';
import { formatDistanceToNowStrict } from 'date-fns';
import { type ConditionWithStats }   from '../conditions/types';
import { useEffect, useRef, useState } from 'react';

const TYPE_CFG: Record<string, { label: string; color: string; dimColor: string; icon: string }> = {
  WALLET_ACTIVITY: { label: 'WALLET',   color: '#a78bfa', dimColor: 'rgba(167,139,250,0.12)', icon: '◉' },
  SWAP_BURST:      { label: 'SWAP',     color: '#fbbf24', dimColor: 'rgba(251,191,36,0.12)',  icon: '⚡' },
  TOKEN_VOLUME:    { label: 'VOLUME',   color: '#22d3ee', dimColor: 'rgba(34,211,238,0.12)',  icon: '◈' },
  LARGE_TRANSFER:  { label: 'TRANSFER', color: '#f87171', dimColor: 'rgba(248,113,113,0.12)', icon: '⟳' },
};

const ACTION_CFG: Record<string, { label: string; color: string; dimColor: string; icon: string }> = {
  NOTIFY:  { label: 'NOTIFY',  color: '#a78bfa', dimColor: 'rgba(167,139,250,0.1)', icon: '◉' },
  WEBHOOK: { label: 'WEBHOOK', color: '#38bdf8', dimColor: 'rgba(56,189,248,0.1)',  icon: '⤷' },
  LOG:     { label: 'LOG',     color: '#6b7280', dimColor: 'rgba(107,114,128,0.1)', icon: '≡' },
  TRADE:   { label: 'TRADE',   color: '#d4ff00', dimColor: 'rgba(212,255,0,0.1)',   icon: '◎' },
};

function isRecent(ts: number | null): boolean {
  return ts !== null && Date.now() - ts < 30_000;
}
function isHighFreq(cond: ConditionWithStats): boolean {
  return cond.lastTriggered !== null && cond.triggerCount >= 2
    && Date.now() - cond.lastTriggered < cond.cooldownSeconds * 2_000;
}

function triggerDetail(cond: ConditionWithStats): string {
  switch (cond.type) {
    case 'WALLET_ACTIVITY':
      return [
        cond.wallet ? cond.wallet.slice(0,6)+'…' : 'any wallet',
        cond.transactionType && cond.transactionType !== 'ANY' ? cond.transactionType : '',
        cond.minAmountSol ? `≥${cond.minAmountSol} SOL` : '',
      ].filter(Boolean).join(' · ');
    case 'SWAP_BURST':
      return [
        cond.tokenMint ? cond.tokenMint.slice(0,6)+'…' : 'any token',
        cond.minSwaps ? `${cond.minSwaps} swaps` : '',
        cond.windowSeconds ? `${cond.windowSeconds}s window` : '',
      ].filter(Boolean).join(' · ');
    case 'TOKEN_VOLUME':
      return [
        cond.tokenMint ? cond.tokenMint.slice(0,6)+'…' : 'any token',
        cond.minVolumeSol ? `≥${cond.minVolumeSol} SOL` : '',
        cond.windowSeconds ? `${cond.windowSeconds}s` : '',
      ].filter(Boolean).join(' · ');
    case 'LARGE_TRANSFER':
      return cond.minSol ? `≥${cond.minSol} SOL` : 'global watch';
    default:
      return '';
  }
}

function actionDetail(a: ConditionWithStats['actions'][0]): string {
  switch (a.type) {
    case 'TRADE': {
      const parts = [a.tradeDirection, a.tradeAmountSol ? `${a.tradeAmountSol} SOL` : '', a.tradeSlippageBps ? `${a.tradeSlippageBps}bps` : ''];
      return parts.filter(Boolean).join(' · ');
    }
    case 'WEBHOOK': return a.webhookUrl ? new URL(a.webhookUrl).hostname : 'webhook';
    case 'NOTIFY': return 'push notification';
    case 'LOG': return 'server log';
    default: return '';
  }
}


function ConditionCard({ cond, onDelete, onToggle }: {
  cond: ConditionWithStats;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const prevLastTriggered = useRef<number | null>(null);
  const [justFired, setJustFired] = useState(false);
  const [firedCount, setFiredCount] = useState(0);

  // Detect new trigger
  useEffect(() => {
    if (
      cond.lastTriggered !== null &&
      prevLastTriggered.current !== null &&
      cond.lastTriggered > prevLastTriggered.current
    ) {
      setJustFired(true);
      setFiredCount(c => c + 1);
      const t = setTimeout(() => setJustFired(false), 3_000);
      return () => clearTimeout(t);
    }
    prevLastTriggered.current = cond.lastTriggered;
  }, [cond.lastTriggered]);

  const tcfg   = TYPE_CFG[cond.type]     ?? TYPE_CFG.WALLET_ACTIVITY;
  const acfg   = ACTION_CFG[cond.actions[0]?.type] ?? ACTION_CFG.NOTIFY;
  const live   = isRecent(cond.lastTriggered);
  const hiFreq = isHighFreq(cond);
  const tDetail = triggerDetail(cond);
  const aDetail = actionDetail(cond.actions[0]);

  return (
    <div
      className={`cond-card${justFired ? ' cond-fired' : ''}`}
      style={{
        background: justFired
          ? `${tcfg.dimColor}`
          : cond.enabled
          ? 'rgba(255,255,255,0.018)'
          : 'rgba(255,255,255,0.008)',
        border: `1.5px solid ${
          justFired    ? tcfg.color + '50' :
          hiFreq       ? 'rgba(251,191,36,0.35)' :
          live         ? 'rgba(212,255,0,0.22)' :
          cond.enabled ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)'
        }`,
        borderRadius: 13,
        opacity: cond.enabled ? 1 : 0.5,
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.3s, background 0.3s',
        boxShadow: justFired ? `0 0 24px ${tcfg.color}18` : 'none',
      }}
    >
    
      {justFired && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse at 50% 0%, ${tcfg.color}12 0%, transparent 70%)`,
          animation: 'cond-ripple 0.8s ease-out forwards',
        }} />
      )}

     
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: justFired
          ? `linear-gradient(90deg, transparent, ${tcfg.color}, transparent)`
          : live
          ? `linear-gradient(90deg, transparent, rgba(212,255,0,0.4), transparent)`
          : 'transparent',
        transition: 'background 0.4s',
      }} />

    
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px 9px' }}>
      
        <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: justFired ? tcfg.color : live ? '#d4ff00' : cond.enabled ? '#2e3540' : '#1a2030',
            transition: 'background 0.3s',
          }} />
          {(live || justFired) && (
            <div style={{
              position: 'absolute', inset: -2, borderRadius: '50%',
              border: `1.5px solid ${justFired ? tcfg.color : '#d4ff00'}`,
              animation: 'cond-ping 1.2s ease-out infinite',
              opacity: 0.6,
            }} />
          )}
        </div>

       
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em',
          padding: '2px 7px', borderRadius: 5,
          background: justFired ? `${tcfg.color}22` : tcfg.dimColor,
          color: tcfg.color,
          border: `1px solid ${tcfg.color}${justFired ? '50' : '28'}`,
          flexShrink: 0, transition: 'all 0.3s',
        }}>
          {tcfg.label}
        </span>

        
        <span style={{
          flex: 1, fontSize: '0.83rem', fontWeight: 600,
          color: justFired ? '#e8ecf0' : '#c4ccd6',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          transition: 'color 0.3s',
        }}>
          {cond.name}
        </span>

       
        {justFired && (
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.6rem', fontWeight: 700,
            letterSpacing: '0.08em', flexShrink: 0,
            padding: '2px 8px', borderRadius: 5,
            background: `${tcfg.color}18`,
            color: tcfg.color,
            border: `1px solid ${tcfg.color}35`,
            animation: 'cond-badge-in 0.3s ease-out both',
          }}>
            ● FIRED
          </span>
        )}

       
        {hiFreq && !justFired && (
          <span title="Firing frequently" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#fbbf24', flexShrink: 0, opacity: 0.8 }}>⚠</span>
        )}

       
        <button
          onClick={() => onToggle(cond.id, !cond.enabled)}
          aria-label={cond.enabled ? 'Disable' : 'Enable'}
          style={{
            width: 36, height: 20, borderRadius: 10,
            background: cond.enabled ? 'rgba(212,255,0,0.75)' : '#1e2a38',
            border: `1px solid ${cond.enabled ? 'rgba(212,255,0,0.5)' : 'rgba(255,255,255,0.1)'}`,
            position: 'relative', cursor: 'pointer', flexShrink: 0,
            transition: 'background 0.2s, border-color 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: cond.enabled ? 18 : 2,
            width: 14, height: 14, borderRadius: '50%',
            background: cond.enabled ? '#070b10' : '#3d4452',
            transition: 'left 0.18s',
          }} />
        </button>

        
        <button
          className="cond-delete"
          onClick={() => onDelete(cond.id)}
          aria-label="Delete"
          style={{
            width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, background: 'transparent', border: 'none',
            color: '#3d4452', cursor: 'pointer', fontSize: 14,
            transition: 'color 0.15s, background 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color='#f87171'; (e.currentTarget as HTMLButtonElement).style.background='rgba(248,113,113,0.1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color='#3d4452'; (e.currentTarget as HTMLButtonElement).style.background='transparent'; }}
        >
          ✕
        </button>
      </div>

      
      <div style={{ padding: '0 14px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        
        <div className="flow-node" style={{
          flex: 1,
          background: tcfg.dimColor,
          border: `1px solid ${tcfg.color}22`,
          borderRadius: 9, padding: '8px 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: tDetail ? 4 : 0 }}>
            <span style={{ color: tcfg.color, fontSize: '0.72rem', fontWeight: 700 }}>{tcfg.icon}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', fontWeight: 700, color: tcfg.color, letterSpacing: '0.06em' }}>
              {tcfg.label}
            </span>
          </div>
          {tDetail && (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: '#5c6472', lineHeight: 1.5 }}>{tDetail}</div>
          )}
        </div>

      
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <svg width="40" height="16" viewBox="0 0 40 16" fill="none">
            <line x1="0" y1="8" x2="32" y2="8"
              stroke={justFired ? tcfg.color : live ? 'rgba(212,255,0,0.3)' : 'rgba(255,255,255,0.12)'}
              strokeWidth={justFired ? 1.5 : 1}
              strokeDasharray={justFired ? 'none' : '3 3'}
            />
            <polygon points="32,5 38,8 32,11"
              fill={justFired ? tcfg.color : live ? 'rgba(212,255,0,0.4)' : 'rgba(255,255,255,0.15)'}
            />
            {justFired && (
              <circle r="2.5" fill={tcfg.color} opacity="0.9">
                <animateMotion dur="0.8s" repeatCount="indefinite" path="M 0 8 L 32 8" />
              </circle>
            )}
          </svg>
        </div>

       
        <div className="flow-node" style={{
          flex: 1,
          background: acfg.dimColor,
          border: `1px solid ${acfg.color}22`,
          borderRadius: 9, padding: '8px 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: aDetail ? 4 : 0 }}>
            <span style={{ color: acfg.color, fontSize: '0.72rem', fontWeight: 700 }}>{acfg.icon}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', fontWeight: 700, color: acfg.color, letterSpacing: '0.06em' }}>
              {acfg.label}
            </span>
          </div>
          {aDetail && (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: '#5c6472', lineHeight: 1.5 }}>{aDetail}</div>
          )}
        </div>
      </div>

     
      {(cond.triggerCount > 0 || cond.cooldownSeconds > 0) && (
        <div style={{
          padding: '7px 14px',
          borderTop: `1px solid ${justFired ? `${tcfg.color}20` : 'rgba(255,255,255,0.05)'}`,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          transition: 'border-color 0.3s',
        }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#3d4452' }}>
            cd <span style={{ color: '#5c6472' }}>{cond.cooldownSeconds}s</span>
          </span>

          {cond.triggerCount > 0 && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: justFired ? tcfg.color : '#d4ff00', opacity: justFired ? 1 : 0.8, transition: 'color 0.3s' }}>
              ⚡ {cond.triggerCount} run{cond.triggerCount !== 1 ? 's' : ''}
            </span>
          )}

          {cond.executionCount > 0 && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#a78bfa' }}>
              ◎ {cond.executionCount} trade{cond.executionCount !== 1 ? 's' : ''}
            </span>
          )}

          {cond.lastTriggered && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#2e3540' }}>
              {formatDistanceToNowStrict(cond.lastTriggered)} ago
            </span>
          )}

          {live && (
            <span style={{
              marginLeft: 'auto',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.6rem',
              color: justFired ? tcfg.color : '#d4ff00',
              letterSpacing: '0.06em',
            }}>
              {justFired ? '⚡ EXECUTING' : '● FIRING'}
            </span>
          )}
        </div>
      )}
    </div>
  );
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            height: 110, borderRadius: 13,
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.06)',
            animation: 'vdb-pulse 1.5s ease-in-out infinite',
            animationDelay: `${i * 0.15}s`,
          }} />
        ))}
        <style>{`@keyframes vdb-pulse { 0%,100%{opacity:0.4} 50%{opacity:0.7} }`}</style>
      </div>
    );
  }

  if (!conditions.length) {
    return (
      <div style={{
        textAlign: 'center', padding: '3rem 1rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.25 }}>
          <rect x="4" y="12" width="16" height="12" rx="3" stroke="#d4ff00" strokeWidth="1.5"/>
          <rect x="28" y="24" width="16" height="12" rx="3" stroke="#d4ff00" strokeWidth="1.5"/>
          <path d="M20 18H28M28 18V24" stroke="#d4ff00" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2"/>
        </svg>
        <div>
          <p style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'1.1rem', letterSpacing:'0.06em', color:'#3d4452', marginBottom:4 }}>
            NO AUTOMATIONS
          </p>
          <p style={{ fontSize:'0.75rem', color:'#252d38' }}>Deploy your first pipeline below</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <style>{`
        @keyframes cond-ping {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes cond-ripple {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cond-badge-in {
          from { opacity: 0; transform: scale(0.85) translateX(4px); }
          to   { opacity: 1; transform: scale(1) translateX(0); }
        }
        @keyframes cond-fired {
          0%   { box-shadow: 0 0 0 rgba(212,255,0,0); }
          30%  { box-shadow: 0 0 32px rgba(212,255,0,0.15); }
          100% { box-shadow: 0 0 0 rgba(212,255,0,0); }
        }
        .cond-card { transition: border-color 0.3s, background 0.3s, box-shadow 0.3s; }
        .cond-card:hover { background: rgba(255,255,255,0.022) !important; }
        .cond-card.cond-fired { animation: cond-fired 3s ease-out forwards; }
        .cond-delete { opacity: 0; transition: opacity 0.15s; }
        .cond-card:hover .cond-delete { opacity: 1; }
        .flow-node { transition: border-color 0.25s; }
        .flow-node:hover { border-color: rgba(255,255,255,0.14) !important; }
      `}</style>

      {conditions.map(cond => (
        <ConditionCard
          key={cond.id}
          cond={cond}
          onDelete={onDelete}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
'use client';
import { type TriggerEvent, type ActionResult, type ExecutionSummary, type TradeResultPayload } from '@/hooks/useSocket';
import { formatDistanceToNowStrict } from 'date-fns';
import { useState } from 'react';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
function shorten(s: string, n = 10) { return `${s.slice(0, n)}…${s.slice(-4)}`; }

type Importance = 'critical' | 'high' | 'normal';

function importance(ev: TriggerEvent): Importance {
  const sol      = ev.amount ? ev.amount / 1e9 : 0;
  const hasTrade = ev.execution?.actions.some(a => a.type === 'TRADE');
  if (ev.conditionType === 'LARGE_TRANSFER') return sol >= 1_000 ? 'critical' : 'high';
  if (hasTrade || ev.conditionType === 'TOKEN_VOLUME') return 'high';
  if (ev.explanation?.confidence === 'HIGH' && sol >= 100) return 'high';
  return 'normal';
}

const COND_COLORS: Record<string, string> = {
  WALLET_ACTIVITY: '#a78bfa',
  SWAP_BURST:      '#fbbf24',
  TOKEN_VOLUME:    '#22d3ee',
  LARGE_TRANSFER:  '#f87171',
};

const CONF_CFG: Record<string, { color: string; bg: string; border: string }> = {
  HIGH:   { color:'#d4ff00', bg:'rgba(212,255,0,0.08)',   border:'rgba(212,255,0,0.2)'   },
  MEDIUM: { color:'#fbbf24', bg:'rgba(251,191,36,0.08)',  border:'rgba(251,191,36,0.2)'  },
  LOW:    { color:'#3d4452', bg:'rgba(61,68,82,0.08)',    border:'rgba(61,68,82,0.2)'    },
};

function TradeCard({ result, status, error }: { result?: TradeResultPayload; status: ActionResult['status']; error?: string }) {
  if (status === 'failed') {
    return (
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', borderRadius:9, background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.2)' }}>
        <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, background:'rgba(248,113,113,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ color:'#f87171', fontSize:10 }}>✕</span>
        </div>
        <div>
          <p style={{ fontSize:'0.78rem', fontWeight:600, color:'#f87171', marginBottom:2 }}>Trade failed</p>
          {error && <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.68rem', color:'rgba(248,113,113,0.6)' }}>{error}</p>}
        </div>
      </div>
    );
  }
  if (!result) return null;

  const isBuy  = result.inputMint === SOL_MINT;
  const token  = isBuy ? result.outputMint : result.inputMint;
  const solAmt = (result.amountIn / 1e9).toFixed(4);

  return (
    <div style={{ padding:'10px 12px', borderRadius:9, background: isBuy ? 'rgba(212,255,0,0.05)' : 'rgba(248,113,113,0.05)', border: `1px solid ${isBuy ? 'rgba(212,255,0,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.72rem', fontWeight:700, color: isBuy ? '#d4ff00' : '#f87171' }}>
            {isBuy ? '↑ BUY' : '↓ SELL'}
          </span>
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.68rem', color:'#8a939f' }}>
            {solAmt} SOL {isBuy ? '→' : '←'} {shorten(token, 6)}
          </span>
        </div>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#3d4452' }}>{result.latencyMs}ms</span>
      </div>
      {result.txHash && (
        <a href={`https://solscan.io/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer"
          style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#3d4452', textDecoration:'none', transition:'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.color='#8a939f')}
          onMouseLeave={e => (e.currentTarget.style.color='#3d4452')}>
          {shorten(result.txHash, 16)} ↗
        </a>
      )}
    </div>
  );
}

function SummaryBar({ summary }: { summary: ExecutionSummary }) {
  const ok = summary.failed === 0;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      padding:'3px 9px', borderRadius:6,
      background: ok ? 'rgba(212,255,0,0.08)' : 'rgba(248,113,113,0.08)',
      border: `1px solid ${ok ? 'rgba(212,255,0,0.2)' : 'rgba(248,113,113,0.2)'}`,
      fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', fontWeight:700,
      color: ok ? '#d4ff00' : '#f87171',
    }}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{summary.success}/{summary.total} actions</span>
      {summary.failed > 0 && <span>· {summary.failed} failed</span>}
    </span>
  );
}

function ActionBadge({ action }: { action: ActionResult }) {
  if (action.type === 'TRADE') return null;
  const s = {
    success: { color:'#d4ff00', bg:'rgba(212,255,0,0.08)',   border:'rgba(212,255,0,0.2)'   },
    failed:  { color:'#f87171', bg:'rgba(248,113,113,0.08)', border:'rgba(248,113,113,0.2)' },
    skipped: { color:'#3d4452', bg:'rgba(61,68,82,0.08)',    border:'rgba(61,68,82,0.2)'    },
  }[action.status] ?? { color:'#3d4452', bg:'rgba(61,68,82,0.08)', border:'rgba(61,68,82,0.2)' };

  return (
    <span title={`${action.attempts} attempt${action.attempts !== 1 ? 's' : ''} · ${action.durationMs}ms`} style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'2px 8px', borderRadius:5,
      background:s.bg, color:s.color, border:`1px solid ${s.border}`,
      fontFamily:'JetBrains Mono,monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.06em',
    }}>
      <span style={{ width:4, height:4, borderRadius:'50%', background:s.color, flexShrink:0 }} />
      {action.type}
      {action.attempts > 1 && <span style={{ opacity:0.5 }}>×{action.attempts}</span>}
    </span>
  );
}


function ExecutionRow({ ev, idx, isNew }: { ev: TriggerEvent; idx: number; isNew: boolean }) {
  const [expanded, setExpanded] = useState(isNew); // newest auto-opens
  const imp       = importance(ev);
  const impColor  = imp === 'critical' ? '#f87171' : imp === 'high' ? '#fbbf24' : null;
  const actions   = ev.execution?.actions ?? [];
  const summary   = ev.execution?.summary;
  const tradAct   = actions.find(a => a.type === 'TRADE');
  const nonTrade  = actions.filter(a => a.type !== 'TRADE');
  const condColor = COND_COLORS[ev.conditionType] ?? '#8a939f';
  const hasFailed = (ev.execution?.summary?.failed ?? 0) > 0;

  return (
    <div
      className={idx === 0 ? 'tf-new' : ''}
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        borderLeft: `2px solid ${impColor ?? condColor}50`,
        background: imp === 'critical' ? 'rgba(248,113,113,0.02)' : imp === 'high' ? 'rgba(251,191,36,0.015)' : 'transparent',
        transition: 'background 0.2s',
      }}
    >
      
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '11px 16px', cursor: 'pointer', userSelect: 'none' }}
        className="tf-row"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: hasFailed ? '#f87171' : '#d4ff00',
            boxShadow: hasFailed ? '0 0 6px rgba(248,113,113,0.5)' : '0 0 6px rgba(212,255,0,0.4)',
          }} />

          
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: condColor, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.conditionName}
          </span>

          {tradAct && (
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', fontWeight: 700,
              padding: '2px 7px', borderRadius: 5, flexShrink: 0,
              background: tradAct.status === 'failed' ? 'rgba(248,113,113,0.08)' : 'rgba(212,255,0,0.08)',
              color:      tradAct.status === 'failed' ? '#f87171' : '#d4ff00',
              border:     `1px solid ${tradAct.status === 'failed' ? 'rgba(248,113,113,0.2)' : 'rgba(212,255,0,0.2)'}`,
            }}>
              {tradAct.status === 'failed' ? '✗ TRADE' : '✓ TRADE'}
              {tradAct.tradeResult?.txHash ? ` · ${tradAct.tradeResult.txHash.slice(0, 6)}…` : ''}
            </span>
          )}

        
          {summary && (
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', fontWeight: 700,
              padding: '2px 7px', borderRadius: 5,
              background: hasFailed ? 'rgba(248,113,113,0.08)' : 'rgba(212,255,0,0.08)',
              color: hasFailed ? '#f87171' : '#d4ff00',
              border: `1px solid ${hasFailed ? 'rgba(248,113,113,0.2)' : 'rgba(212,255,0,0.2)'}`,
              flexShrink: 0,
            }}>
              {hasFailed ? `✗ ${summary.failed} failed` : `✓ ${summary.success} ok`}
            </span>
          )}

          
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: '#2e3540', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {formatDistanceToNowStrict(ev.matchedAt)} ago
          </span>

        
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="#3d4452" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </div>

        
        {!expanded && ev.explanation?.reason && (
          <p style={{ fontSize: '0.72rem', color: '#3d4452', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 17 }}>
            {ev.explanation.reason}
          </p>
        )}
      </div>

      
      {expanded && (
        <div style={{ padding: '0 16px 14px', paddingLeft: 16 }}>
        
          {imp !== 'normal' && (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, color: impColor ?? '#3d4452', letterSpacing: '0.1em', marginBottom: 8, opacity: 0.8 }}>
              {imp === 'critical' ? '● CRITICAL' : '◉ HIGH PRIORITY'}
            </div>
          )}

         
          {ev.explanation?.reason && (
            <p style={{ fontSize: '0.78rem', color: '#8a939f', lineHeight: 1.55, marginBottom: 8 }}>
              {ev.explanation.reason}
            </p>
          )}

         
          {ev.explanation && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {ev.explanation.matchedFields.map(f => (
                <span key={f} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#3d4452' }}>{f}</span>
              ))}
              {(() => {
                const cs = CONF_CFG[ev.explanation.confidence];
                return cs ? (
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', padding: '2px 7px', borderRadius: 5, background: cs.bg, color: cs.color, border: `1px solid ${cs.border}` }}>{ev.explanation.confidence}</span>
                ) : null;
              })()}
            </div>
          )}

         
          {ev.explanation?.details && Object.keys(ev.explanation.details).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px', marginBottom: 8 }}>
              {Object.entries(ev.explanation.details).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem' }}>
                  <span style={{ color: '#2e3540' }}>{k}:</span>
                  <span style={{ color: '#5c6472', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          
          {tradAct && <div style={{ marginBottom: 8 }}><TradeCard result={tradAct.tradeResult} status={tradAct.status} error={tradAct.error} /></div>}

         
          {(summary || nonTrade.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              {summary && <SummaryBar summary={summary} />}
              {nonTrade.map((a, i) => <ActionBadge key={`${a.type}-${i}`} action={a} />)}
            </div>
          )}

          
          {actions.filter(a => a.status === 'failed' && a.type !== 'TRADE').map((a, i) => (
            <div key={i} style={{ padding: '5px 9px', borderRadius: 7, marginBottom: 5, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#f87171' }}>
              {a.type} failed{a.errorType ? ` (${a.errorType})` : ''}{a.error ? `: ${a.error}` : ''}
            </div>
          ))}

        
          <a href={`https://solscan.io/tx/${ev.signature}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: '#2e3540', textDecoration: 'none', transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color='#5c6472')}
            onMouseLeave={e => (e.currentTarget.style.color='#2e3540')}>
            {shorten(ev.signature, 16)} ↗
          </a>
        </div>
      )}
    </div>
  );
}


interface Props { events: TriggerEvent[]; onClear: () => void; }

export default function TriggerFeed({ events, onClear }: Props) {

  if (!events.length) {
    return (
      <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, fontFamily:'DM Sans,sans-serif' }}>
        <style>{`@keyframes tf-bolt { 0%,100%{opacity:0.25;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.04)} }`}</style>
        <div style={{ width:52, height:52, borderRadius:14, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center', animation:'tf-bolt 3s ease-in-out infinite' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M12 2L6.5 11H10.5L9.5 20L16 9.5H12L12 2Z" stroke="#2e3540" strokeWidth="1.4" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ textAlign:'center' }}>
          <p style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'1rem', letterSpacing:'0.1em', color:'#2e3540', marginBottom:4 }}>NO EXECUTIONS YET</p>
          <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#1a2030' }}>Automations watching Solana mainnet in real-time</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', fontFamily:'DM Sans,system-ui,sans-serif' }}>
      <style>{`
        @keyframes tf-slide { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        .tf-new { animation: tf-slide 0.3s ease-out both; }
        .tf-scroll::-webkit-scrollbar { width: 3px; }
        .tf-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.07); border-radius:2px; }
        .tf-row { transition: background 0.15s; }
        .tf-row:hover { background: rgba(255,255,255,0.02); }
      `}</style>

    
      <div style={{
        flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 16px', background:'rgba(7,11,16,0.92)',
        borderBottom:'1px solid rgba(255,255,255,0.07)',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <svg width="12" height="14" viewBox="0 0 12 14" fill="#d4ff00" opacity="0.7">
            <path d="M7 0L3.5 7H6L5 14L9.5 6.5H7L7 0Z"/>
          </svg>
          <span style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'0.9rem', letterSpacing:'0.08em', color:'#8a939f' }}>
            {events.length} EXECUTION{events.length !== 1 ? 'S' : ''}
          </span>
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#2e3540' }}>
            · click to expand
          </span>
        </div>
        <button onClick={onClear} style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#2e3540', background:'none', border:'none', cursor:'pointer', padding:'4px 8px', borderRadius:6, transition:'all 0.15s', letterSpacing:'0.04em' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color='#8a939f'; (e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.04)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color='#2e3540'; (e.currentTarget as HTMLButtonElement).style.background='none'; }}>
          clear all
        </button>
      </div>

   
      <div className="tf-scroll" style={{ flex:1, overflowY:'auto' }}>
        {events.map((ev, idx) => (
          <ExecutionRow
            key={`${ev.conditionId}-${ev.matchedAt}`}
            ev={ev}
            idx={idx}
            isNew={idx === 0}
          />
        ))}
      </div>
    </div>
  );
}
'use client';
import { useEffect, useState, useCallback } from 'react';
import { authClient } from '@/lib/auth-client';

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const LAMPORTS = 1_000_000_000;

function shorten(s: string, n = 8) { return `${s.slice(0, n)}…${s.slice(-4)}`; }
function fmtSol(lamports: number) { return (lamports / LAMPORTS).toFixed(4); }
function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

interface TradeRecord {
  id: string;
  txHash: string | null;
  direction: 'BUY' | 'SELL';
  inputMint: string;
  outputMint: string;
  rawAmountIn: number;
  quoteOutAmount: number | null;
  slippageBps: number;
  quotePriceImpactPct: number | null;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  executionDurationMs: number | null;
  failureReason: string | null;
  rpcProvider: string | null;
  createdAt: number;
  manual: boolean;
}

const STATUS_CFG = {
  CONFIRMED: { color: '#d4ff00', bg: 'rgba(212,255,0,0.08)',   border: 'rgba(212,255,0,0.2)',   icon: '✓', label: 'Confirmed' },
  PENDING:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.2)',  icon: '…', label: 'Pending'   },
  FAILED:    { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', icon: '✕', label: 'Failed'   },
} as const;

function TradeRow({ trade }: { trade: TradeRecord }) {
  const [expanded, setExpanded] = useState(false);
  const isBuy  = trade.direction === 'BUY';
  const cfg    = STATUS_CFG[trade.status];
  const solAmt = fmtSol(trade.rawAmountIn);
  const token  = isBuy ? trade.outputMint : trade.inputMint;

  return (
    <div style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', borderLeft:`2px solid ${cfg.color}40` }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', cursor:'pointer', transition:'background 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.background='rgba(255,255,255,0.02)')}
        onMouseLeave={e => (e.currentTarget.style.background='transparent')}
      >
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.08em', padding:'2px 8px', borderRadius:5, flexShrink:0, background: isBuy?'rgba(212,255,0,0.1)':'rgba(248,113,113,0.1)', color: isBuy?'#d4ff00':'#f87171', border:`1px solid ${isBuy?'rgba(212,255,0,0.25)':'rgba(248,113,113,0.25)'}` }}>
          {isBuy ? '↑ BUY' : '↓ SELL'}
        </span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.78rem', fontWeight:600, color:'#c4ccd6', flex:1, minWidth:0 }}>
          {solAmt} SOL {isBuy?'→':'←'} {shorten(token,6)}
        </span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', fontWeight:700, padding:'2px 7px', borderRadius:5, flexShrink:0, background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.border}` }}>
          {cfg.icon} {cfg.label}
        </span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.58rem', color:'#506070', flexShrink:0, letterSpacing:'0.06em' }}>
          {trade.manual ? 'MANUAL' : 'AUTO'}
        </span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.6rem', color:'#506070', flexShrink:0, whiteSpace:'nowrap' }}>
          {fmtTime(trade.createdAt)}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink:0, transition:'transform 0.2s', transform:expanded?'rotate(180deg)':'none' }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="#506070" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </div>

      {expanded && (
        <div style={{ padding:'0 16px 14px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 24px', marginBottom:8 }}>
            {[
              ['Slippage',`${trade.slippageBps}bps`],
              ['Impact', trade.quotePriceImpactPct!=null?`${Number(trade.quotePriceImpactPct).toFixed(2)}%`:'—'],
              ['Duration', trade.executionDurationMs?`${trade.executionDurationMs}ms`:'—'],
              ['Provider', trade.rpcProvider??'—'],
            ].map(([k,v]) => (
              <div key={k} style={{ display:'flex', gap:6, fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', padding:'2px 0' }}>
                <span style={{ color:'#506070', flexShrink:0, minWidth:60 }}>{k}:</span>
                <span style={{ color:'#8a939f' }}>{v}</span>
              </div>
            ))}
          </div>
          {trade.failureReason && (
            <div style={{ padding:'6px 10px', borderRadius:7, background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.15)', marginBottom:6 }}>
              <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#f87171' }}>{trade.failureReason}</p>
            </div>
          )}
          {trade.txHash && (
            <a href={`https://solscan.io/tx/${trade.txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.6rem', color:'#506070', textDecoration:'none', transition:'color 0.15s' }}
              onMouseEnter={e=>(e.currentTarget.style.color='#8a939f')}
              onMouseLeave={e=>(e.currentTarget.style.color='#506070')}>
              {shorten(trade.txHash,18)} ↗ Solscan
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function TradeHistory({ userId }: { userId: string }) {
  const { data: sessionData } = authClient.useSession();
  const token = sessionData?.session?.token ?? '';
  const [trades,  setTrades]  = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string|null>(null);

  const load = useCallback(async () => {
    if (!userId || !token) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BASE()}/trades/${userId}`, { headers:{ Authorization:`Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTrades(await r.json());
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally { setLoading(false); }
  }, [userId, token]);

  useEffect(() => { load(); }, [load]);

  const confirmed = trades.filter(t=>t.status==='CONFIRMED').length;
  const failed    = trades.filter(t=>t.status==='FAILED').length;
  const totalSol  = trades.filter(t=>t.status==='CONFIRMED'&&t.direction==='BUY').reduce((s,t)=>s+t.rawAmountIn/LAMPORTS, 0);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', fontFamily:'DM Sans,system-ui,sans-serif' }}>
      <style>{`.th-scroll::-webkit-scrollbar{width:3px}.th-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:2px}@keyframes th-pulse{0%,100%{opacity:0.3}50%{opacity:0.6}}`}</style>

      <div style={{ flexShrink:0, padding:'10px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'rgba(7,11,16,0.92)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'0.9rem', letterSpacing:'0.08em', color:'#8a939f' }}>TRADE HISTORY</span>
          {trades.length>0 && <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', fontWeight:700, padding:'2px 7px', borderRadius:5, background:'rgba(212,255,0,0.1)', color:'#d4ff00', border:'1px solid rgba(212,255,0,0.2)' }}>{trades.length}</span>}
        </div>
        {trades.length>0 && (
          <div style={{ display:'flex', gap:20 }}>
            {[{label:'Confirmed',value:String(confirmed),color:'#d4ff00'},{label:'Failed',value:String(failed),color:failed>0?'#f87171':'#506070'},{label:'SOL in',value:totalSol.toFixed(3),color:'#8a939f'}].map(s=>(
              <div key={s.label} style={{ textAlign:'center' }}>
                <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.72rem', fontWeight:700, color:s.color }}>{s.value}</div>
                <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.55rem', color:'#506070', letterSpacing:'0.08em', textTransform:'uppercase' as const }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={load} style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#506070', background:'none', border:'none', cursor:'pointer', letterSpacing:'0.04em', transition:'color 0.15s' }}
          onMouseEnter={e=>(e.currentTarget.style.color='#8a939f')} onMouseLeave={e=>(e.currentTarget.style.color='#506070')}>↻ refresh</button>
      </div>

      {loading ? (
        <div style={{ flex:1, padding:16, display:'flex', flexDirection:'column', gap:6 }}>
          {[0,1,2,3].map(i=><div key={i} style={{ height:42, borderRadius:8, background:'rgba(255,255,255,0.025)', animation:`th-pulse 1.5s ${i*0.12}s ease-in-out infinite` }}/>)}
        </div>
      ) : error ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ textAlign:'center' }}>
            <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.72rem', color:'#f87171', marginBottom:8 }}>{error}</p>
            <button onClick={load} style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#506070', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, padding:'4px 12px', cursor:'pointer' }}>Retry</button>
          </div>
        </div>
      ) : trades.length===0 ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
          <div style={{ width:48, height:48, borderRadius:12, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="3" stroke="#506070" strokeWidth="1.3"/><path d="M6 10L9 13L14 7" stroke="#506070" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
          <div style={{ textAlign:'center' }}>
            <p style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'1rem', letterSpacing:'0.1em', color:'#506070', marginBottom:4 }}>NO TRADES YET</p>
            <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#4a5a6e' }}>Executed trades will appear here</p>
          </div>
        </div>
      ) : (
        <div className="th-scroll" style={{ flex:1, overflowY:'auto' }}>
          {trades.map(t=><TradeRow key={t.id} trade={t}/>)}
        </div>
      )}
    </div>
  );
}

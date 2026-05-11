'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { formatDistanceToNowStrict }             from 'date-fns';

interface LiveEvent {
  signature:  string;
  eventType:  'SWAP' | 'TRANSFER' | 'UNKNOWN';
  tokenMint?: string;
  timestamp:  number;
}

const TYPE_CFG = {
  SWAP:     { label: 'SWAP',     color: '#818cf8', dim: 'rgba(129,140,248,0.1)' },
  TRANSFER: { label: 'TRANSFER', color: '#38bdf8', dim: 'rgba(56,189,248,0.1)'  },
  UNKNOWN:  { label: 'TX',       color: '#3d4452', dim: 'rgba(61,68,82,0.1)'    },
} as const;

type Filter = 'ALL' | 'SWAP' | 'TRANSFER' | 'UNKNOWN';
function shorten(s: string, n = 8) { return `${s.slice(0, n)}…${s.slice(-4)}`; }

interface Props { events: LiveEvent[]; triggeredSigs: Map<string, string>; }

export default function EventFeed({ events, triggeredSigs }: Props) {
  const [filter,   setFilter]   = useState<Filter>('ALL');
  const [paused,   setPaused]   = useState(false);
  const [snapshot, setSnapshot] = useState<LiveEvent[] | null>(null);
  const prevCount  = useRef(0);
  const [newCount, setNewCount] = useState(0);

  const base     = paused ? (snapshot ?? events) : events;
  const filtered = useMemo(() => filter === 'ALL' ? base : base.filter(e => e.eventType === filter), [base, filter]);
  const hitCount = useMemo(() => filtered.filter(e => triggeredSigs.has(e.signature)).length, [filtered, triggeredSigs]);

  useEffect(() => {
    if (!paused && events.length > prevCount.current) setNewCount(n => n + (events.length - prevCount.current));
    prevCount.current = events.length;
  }, [events.length, paused]);

  const handlePause = () => {
    if (!paused) { setSnapshot([...events]); setNewCount(0); }
    else         { setSnapshot(null); setNewCount(0); }
    setPaused(p => !p);
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', fontFamily:'DM Sans,system-ui,sans-serif' }}>
      <style>{`
        @keyframes ef-slide {
          from { opacity:0; transform:translateX(-6px); background:rgba(212,255,0,0.06); }
          to   { opacity:1; transform:translateX(0);    background:transparent; }
        }
        .ef-row-new { animation: ef-slide 0.35s ease-out both; }
        .ef-row { transition: background 0.15s; }
        .ef-row:hover { background: rgba(255,255,255,0.025) !important; }
        .ef-scroll::-webkit-scrollbar { width: 3px; }
        .ef-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius:2px; }
        @keyframes ef-ping { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.5);opacity:0} }
      `}</style>

     
      <div style={{
        flexShrink: 0,
        background: 'rgba(7,11,16,0.92)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(8px)',
      }}>
      
        <div style={{
          display:'flex', alignItems:'center',
          padding:'9px 16px',
          gap:0,
          borderBottom:'1px solid rgba(255,255,255,0.04)',
          overflow:'hidden',
        }}>
          {[
            { label:'SOLANA RPC', sub:'wss://mainnet', active:true },
            { label:'INGESTION',  sub:'log parse',     active:true },
            { label:'MATCHER',    sub:'index eval',    active:true },
            { label:'BROADCAST',  sub:'ws push',       active:events.length > 0 },
          ].map((node, i, arr) => (
            <div key={node.label} style={{ display:'flex', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px' }}>
                <div style={{ position:'relative', width:5, height:5 }}>
                  <div style={{
                    width:5, height:5, borderRadius:'50%',
                    background: node.active ? '#d4ff00' : '#2e3540',
                  }} />
                  {node.active && (
                    <div style={{
                      position:'absolute', inset:0, borderRadius:'50%',
                      background:'#d4ff00',
                      animation:'ef-ping 2.5s ease-out infinite',
                      animationDelay:`${i * 0.4}s`,
                    }} />
                  )}
                </div>
                <div>
                  <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.58rem', fontWeight:700, color: node.active ? '#8a939f' : '#2e3540', letterSpacing:'0.08em' }}>{node.label}</div>
                  <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.54rem', color:'#2e3540', letterSpacing:'0.04em' }}>{node.sub}</div>
                </div>
              </div>
              {i < arr.length - 1 && (
                <div style={{ display:'flex', alignItems:'center', gap:0 }}>
                  <div style={{ width:16, height:1, background:'rgba(212,255,0,0.15)' }} />
                  <svg width="4" height="6" viewBox="0 0 4 6" fill="rgba(212,255,0,0.2)"><path d="M0 0L4 3L0 6V0Z"/></svg>
                </div>
              )}
            </div>
          ))}
        </div>

       
        <div style={{ display:'flex', alignItems:'center', padding:'7px 16px', flexWrap:'wrap', gap:'6px' } as React.CSSProperties}>
        
          <div style={{
            display:'flex', gap:2,
            background:'rgba(255,255,255,0.03)',
            border:'1px solid rgba(255,255,255,0.07)',
            borderRadius:8, padding:3,
          }}>
            {(['ALL','SWAP','TRANSFER','UNKNOWN'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding:'4px 10px',
                borderRadius:6,
                border:'none', cursor:'pointer',
                fontFamily:'JetBrains Mono,monospace',
                fontSize:'0.62rem', fontWeight:700,
                letterSpacing:'0.06em',
                background: filter === f ? 'rgba(255,255,255,0.08)' : 'transparent',
                color:      filter === f ? '#e8ecf0' : '#3d4452',
                transition:'all 0.15s',
              }}>{f}</button>
            ))}
          </div>

          <div style={{ flex:1 }} />

         
          {hitCount > 0 && (
            <div style={{
              display:'flex', alignItems:'center', gap:5,
              padding:'4px 10px', borderRadius:7,
              background:'rgba(212,255,0,0.08)',
              border:'1px solid rgba(212,255,0,0.2)',
              fontFamily:'JetBrains Mono,monospace',
              fontSize:'0.62rem', fontWeight:700,
              color:'#d4ff00',
            }}>
              <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor"><path d="M4.5 0L2 5H3.5L2.5 10L6 4.5H4.5L4.5 0Z"/></svg>
              {hitCount} matched
            </div>
          )}

         
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.6rem', color:'#2e3540', letterSpacing:'0.04em' }}>
            {filtered.length}/{events.length}
          </span>

         
          <button onClick={handlePause} style={{
            display:'flex', alignItems:'center', gap:5,
            padding:'4px 10px', borderRadius:7,
            border:`1px solid ${paused ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.08)'}`,
            background: paused ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
            color: paused ? '#fbbf24' : '#3d4452',
            cursor:'pointer',
            fontFamily:'JetBrains Mono,monospace',
            fontSize:'0.62rem', fontWeight:600,
            letterSpacing:'0.04em',
            transition:'all 0.15s',
          }}>
            {paused ? (
              <>
                <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor"><polygon points="0,0 7,4 0,8"/></svg>
                RESUME {newCount > 0 && `+${newCount}`}
              </>
            ) : (
              <>
                <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor"><rect x="0" y="0" width="2.5" height="8"/><rect x="4.5" y="0" width="2.5" height="8"/></svg>
                PAUSE
              </>
            )}
          </button>
        </div>
      </div>

     
      {!filtered.length ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
          <div style={{
            width:44, height:44, borderRadius:12,
            background:'rgba(255,255,255,0.02)',
            border:'1px solid rgba(255,255,255,0.06)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="3.5" stroke="#2e3540" strokeWidth="1.3"/>
              <circle cx="9" cy="9" r="7" stroke="#1a2030" strokeWidth="1"/>
            </svg>
          </div>
          <div style={{ textAlign:'center' }}>
            <p style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'0.9rem', letterSpacing:'0.1em', color:'#2e3540', marginBottom:4 }}>
              {events.length === 0 ? 'AWAITING CHAIN EVENTS' : `NO ${filter} EVENTS`}
            </p>
            {events.length === 0 && (
              <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#1a2030' }}>
                Connected · Solana mainnet · Public WebSocket
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="ef-scroll" style={{ flex:1, overflowY:'auto' }}>
          
          <div style={{
            position:'sticky', top:0, zIndex:10,
            display:'grid', gridTemplateColumns:'90px 1fr 90px 72px',
            gap:8, padding:'6px 16px',
            background:'rgba(8,14,24,0.97)',
            borderBottom:'1px solid rgba(255,255,255,0.04)',
            backdropFilter:'blur(6px)',
          }}>
            {['Type','Transaction','Token','Age'].map((h, i) => (
              <span key={h} style={{
                fontFamily:'JetBrains Mono,monospace',
                fontSize:'0.58rem', fontWeight:700,
                color:'#2e3540', letterSpacing:'0.1em',
                textTransform:'uppercase' as const,
                textAlign: i === 3 ? 'right' : 'left',
              }}>{h}</span>
            ))}
          </div>

          {filtered.map((ev, i) => {
            const cfg      = TYPE_CFG[ev.eventType] ?? TYPE_CFG.UNKNOWN;
            const condName = triggeredSigs.get(ev.signature);
            const triggered = condName !== undefined;
            const isNew     = i === 0 && !paused;

            return (
              <div
                key={ev.signature}
                className={`ef-row${isNew ? ' ef-row-new' : ''}`}
                style={{
                  display:'grid', gridTemplateColumns:'90px 1fr 90px 72px',
                  gap:8, padding:'8px 16px',
                  borderBottom:'1px solid rgba(255,255,255,0.03)',
                  borderLeft:`2px solid ${triggered ? 'rgba(212,255,0,0.3)' : 'transparent'}`,
                  background: triggered ? 'rgba(212,255,0,0.03)' : 'transparent',
                  cursor:'default',
                }}
              >
                
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:5, height:5, borderRadius:'50%', background:cfg.color, flexShrink:0 }} />
                  <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', fontWeight:700, color:cfg.color, letterSpacing:'0.04em' }}>
                    {cfg.label}
                  </span>
                  {triggered && <span style={{ fontSize:'0.58rem', color:'#d4ff00' }}>⚡</span>}
                </div>

               
                <div style={{ minWidth:0 }}>
                  <a
                    href={`https://solscan.io/tx/${ev.signature}`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontFamily:'JetBrains Mono,monospace',
                      fontSize:'0.68rem',
                      color: triggered ? '#d4ff00' : '#3d4452',
                      textDecoration:'none',
                      display:'block',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      transition:'color 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'; }}
                  >
                    {shorten(ev.signature, 12)}
                  </a>
                  {triggered && condName && (
                    <div style={{
                      fontFamily:'JetBrains Mono,monospace',
                      fontSize:'0.58rem',
                      color:'rgba(212,255,0,0.5)',
                      marginTop:1,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>
                      via {condName}
                    </div>
                  )}
                </div>

             
                <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#2e3540', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {ev.tokenMint ? shorten(ev.tokenMint, 6) : '—'}
                </div>

            
                <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.62rem', color:'#2e3540', textAlign:'right', whiteSpace:'nowrap' }}>
                  {formatDistanceToNowStrict(ev.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

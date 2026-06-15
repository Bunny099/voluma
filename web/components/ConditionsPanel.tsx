
'use client';
import { useConditions }           from '@/hooks/useConditions';
import ConditionList               from './ConditionList';
import ConditionBuilder            from './ConditionBuilder';
import { type ConditionWithStats } from '../conditions/types';
import { useEffect, useRef }       from 'react';

interface Props {
  userId: string;
  latestTriggerKey: string | null;
}

export default function ConditionsPanel({ userId, latestTriggerKey }: Props) {
  const { conditions, loading, error, refetch, deleteCondition, toggleCondition, addOptimistic } =
    useConditions(userId);
  const lastTriggerKeyRef = useRef<string | null>(latestTriggerKey);

  function handleCreated(cond: ConditionWithStats) {
    addOptimistic(cond);
    setTimeout(refetch, 3_000);
  }

  useEffect(() => {
    if (!latestTriggerKey) return;
    if (lastTriggerKeyRef.current === latestTriggerKey) return;

    lastTriggerKeyRef.current = latestTriggerKey;
    const timer = setTimeout(() => { refetch(); }, 150);
    return () => clearTimeout(timer);
  }, [latestTriggerKey, refetch]);

  return (
    <div style={{ height:'100%', overflowY:'auto', fontFamily:'DM Sans,system-ui,sans-serif' }}>
      <style>{`
        .cp-scroll::-webkit-scrollbar { width:3px; }
        .cp-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:2px; }
        @keyframes cp-fadein { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
      `}</style>
      <div className="cp-scroll" style={{ maxWidth:720, margin:'0 auto', padding:'20px 20px 40px' }}>

        
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:'1.1rem', letterSpacing:'0.08em', color:'#8a939f' }}>
              ACTIVE AUTOMATIONS
            </span>
            {conditions.length > 0 && (
              <span style={{
                fontFamily:'JetBrains Mono,monospace',
                fontSize:'0.62rem', fontWeight:700,
                padding:'2px 7px', borderRadius:5,
                background:'rgba(212,255,0,0.1)',
                color:'#d4ff00',
                border:'1px solid rgba(212,255,0,0.2)',
              }}>{conditions.length}</span>
            )}
          </div>
          <button
            onClick={refetch}
            style={{
              fontFamily:'JetBrains Mono,monospace',
              fontSize:'0.62rem', color:'#5a6b7e',
              background:'none', border:'none', cursor:'pointer',
              display:'flex', alignItems:'center', gap:4,
              transition:'color 0.15s',
              letterSpacing:'0.04em',
            }}
            onMouseEnter={e => (e.currentTarget.style.color='#8a939f')}
            onMouseLeave={e => (e.currentTarget.style.color='#5a6b7e')}
          >
            ↻ refresh
          </button>
        </div>

        {error && (
          <div style={{
            marginBottom:12,
            background:'rgba(248,113,113,0.07)',
            border:'1px solid rgba(248,113,113,0.2)',
            borderRadius:9, padding:'8px 12px',
          }}>
            <p style={{ fontSize:'0.75rem', color:'#f87171', fontFamily:'JetBrains Mono,monospace' }}>{error}</p>
          </div>
        )}

        <ConditionList conditions={conditions} loading={loading} onDelete={deleteCondition} onToggle={toggleCondition} />

      
        <div style={{ margin:'24px 0', borderTop:'1px solid rgba(255,255,255,0.06)', position:'relative' }}>
          <span style={{
            position:'absolute', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            fontFamily:'JetBrains Mono,monospace',
            fontSize:'0.6rem', letterSpacing:'0.14em',
            color:'#506070', background:'#080e18',
            padding:'0 12px',
          }}>NEW AUTOMATION</span>
        </div>

        <ConditionBuilder userId={userId} onCreated={handleCreated} />
      </div>
    </div>
  );
}

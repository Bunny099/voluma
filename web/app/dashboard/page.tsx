'use client';
import { useState, useEffect } from 'react';
import { useUserId }           from '@/hooks/useUserId';
import { useSocket }           from '@/hooks/useSocket';
import { notifyTradeSuccess }  from '@/hooks/useWallet';
import EventFeed               from '@/components/EventFeed';
import TriggerFeed             from '@/components/TriggerFeed';
import ConditionsPanel         from '@/components/ConditionsPanel';
import WalletPanel             from '@/components/WalletPanel';
import SystemStats             from '@/components/SystemStats';
import Link                    from 'next/link';

type View = 'feed' | 'triggers' | 'conditions' | 'wallet';

function VolumaLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="rgba(212,255,0,0.08)" />
      <polyline points="6,10 16,22 26,10" fill="none" stroke="#d4ff00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6"  cy="10" r="2.5" fill="#d4ff00" />
      <circle cx="16" cy="22" r="2.5" fill="#d4ff00" opacity="0.5"/>
      <circle cx="26" cy="10" r="2.5" fill="#d4ff00" />
    </svg>
  );
}

const NAV_ITEMS: { view: View; label: string; short: string; icon: React.ReactNode }[] = [
  {
    view: 'feed', label: 'Live Feed', short: 'Feed',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1" opacity="0.4"/>
        <circle cx="7.5" cy="7.5" r="0.8" fill="currentColor"/>
      </svg>
    ),
  },
  {
    view: 'triggers', label: 'Executions', short: 'Runs',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M8 2L4.5 8H7L6 13L10.5 7H8L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    view: 'conditions', label: 'Automations', short: 'Flows',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1.5" y="3" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="9.5" y="8" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5.5 5H9M9 5V8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: 'wallet', label: 'Wallet', short: 'Wallet',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1" y="3.5" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M1 6.5H14" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="11" cy="9.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
];


interface ToastProps {
  id:        string;
  kind:      'success' | 'error' | 'pending';
  message:   string;
  txHash?:   string;
  onDismiss: (id: string) => void;
}

function TradeToast({ id, kind, message, txHash, onDismiss }: ToastProps) {
  const isOk     = kind === 'success';
  const isPending = kind === 'pending';
  const color     = isOk ? '#d4ff00' : isPending ? '#fbbf24' : '#f87171';
  const bg        = isOk ? 'rgba(212,255,0,0.08)'  : isPending ? 'rgba(251,191,36,0.08)'  : 'rgba(248,113,113,0.08)';
  const border    = isOk ? 'rgba(212,255,0,0.25)'  : isPending ? 'rgba(251,191,36,0.25)'  : 'rgba(248,113,113,0.25)';
  const iconBg    = isOk ? 'rgba(212,255,0,0.15)'  : isPending ? 'rgba(251,191,36,0.15)'  : 'rgba(248,113,113,0.15)';
  const icon      = isOk ? '✓' : isPending ? '…' : '✕';
  const label     = isOk ? 'Trade submitted' : isPending ? 'Trade pending' : 'Trade failed';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 14px',
      borderRadius: 10,
      background: bg,
      border: `1px solid ${border}`,
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      animation: 'toast-in 0.25s ease-out both',
      minWidth: 260, maxWidth: 340,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color, fontSize: 11,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.78rem', fontWeight: 600, color, marginBottom: txHash ? 3 : 0 }}>
          {label}
        </p>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.66rem', color: isOk ? 'rgba(212,255,0,0.6)' : isPending ? 'rgba(251,191,36,0.6)' : 'rgba(248,113,113,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message}
        </p>
        {txHash && (
          <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color, opacity: 0.7, textDecoration: 'none' }}>
            {txHash.slice(0, 16)}… ↗
          </a>
        )}
      </div>
      <button onClick={() => onDismiss(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3d4452', fontSize: 14, padding: 2, lineHeight: 1 }}>×</button>
    </div>
  );
}


export default function Dashboard() {
  const userId = useUserId();
  const {
    connected, liveEvents, triggers, triggeredSigs, clearTriggers,
    tradeToasts, dismissToast, pendingTxs,
    _onTradeSuccessRef,
  } = useSocket(userId);
  const [view, setView] = useState<View>('feed');

  useEffect(() => {
    if (!_onTradeSuccessRef) return;
    _onTradeSuccessRef.current = () => notifyTradeSuccess(userId);
    return () => { if (_onTradeSuccessRef) _onTradeSuccessRef.current = null; };
  }, [userId, _onTradeSuccessRef]);

  if (!userId) {
    return (
      <div style={{ height: '100vh', background: '#070b10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400&display=swap');`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d4ff00', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: '#3d4452', letterSpacing: '0.06em' }}>INITIALIZING PIPELINE…</span>
        </div>
      </div>
    );
  }

  const counts: Partial<Record<View, number>> = {
    feed:     liveEvents.length,
    triggers: triggers.length,
  };

  return (
    <div className="vdb-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        .vdb-root {
          height: 100vh;
          background: #070b10;
          color: #e8ecf0;
          font-family: 'DM Sans', system-ui, sans-serif;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          -webkit-font-smoothing: antialiased;
        }

        .vdb-topbar {
          height: 52px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 1.25rem;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          background: rgba(7,11,16,0.97);
          backdrop-filter: blur(12px);
          position: relative;
          z-index: 50;
        }
        .vdb-brand { display:flex; align-items:center; gap:9px; text-decoration:none; color:inherit; }
        .vdb-wordmark { font-family:'Bebas Neue',sans-serif; font-size:1.3rem; letter-spacing:0.1em; color:#e8ecf0; }

        .vdb-tabs { display:flex; align-items:center; gap:2px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:3px; }
        .vdb-tab { display:flex; align-items:center; gap:7px; padding:6px 14px; border-radius:7px; font-size:0.78rem; font-weight:500; letter-spacing:0.01em; cursor:pointer; border:none; outline:none; background:transparent; color:#4a5260; transition:all 0.15s; position:relative; }
        .vdb-tab:hover { color:#8a939f; background:rgba(255,255,255,0.03); }
        .vdb-tab.active { background:rgba(212,255,0,0.08); color:#e8ecf0; border:1px solid rgba(212,255,0,0.18); }
        .vdb-tab.active svg { color:#d4ff00; }
        .vdb-tab-badge { font-family:'JetBrains Mono',monospace; font-size:0.6rem; font-weight:700; padding:1px 5px; border-radius:4px; min-width:18px; text-align:center; letter-spacing:0; }
        .vdb-tab.active .vdb-tab-badge { background:rgba(212,255,0,0.15); color:#d4ff00; }
        .vdb-tab:not(.active) .vdb-tab-badge { background:rgba(255,255,255,0.06); color:#475569; }

        .vdb-status { display:flex; align-items:center; gap:8px; padding:5px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.02); }
        .vdb-status-dot { width:6px; height:6px; border-radius:50%; position:relative; flex-shrink:0; }
        .vdb-status-dot-ring { position:absolute; inset:0; border-radius:50%; animation:vdb-ping 1.5s ease-in-out infinite; }
        .vdb-status-label { font-family:'JetBrains Mono',monospace; font-size:0.65rem; font-weight:700; letter-spacing:0.1em; }

        .vdb-body { flex:1; overflow:hidden; display:flex; }

        .vdb-sidebar { width:200px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid rgba(255,255,255,0.07); background:rgba(7,11,16,0.98); overflow:hidden; }
        .vdb-sidebar-nav { padding:10px 8px; }
        .vdb-sidebar-item { display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:8px; font-size:0.8rem; font-weight:500; cursor:pointer; border:1px solid transparent; background:transparent; color:#4a5260; width:100%; text-align:left; outline:none; transition:all 0.12s; margin-bottom:1px; }
        .vdb-sidebar-item:hover { color:#8a939f; background:rgba(255,255,255,0.03); }
        .vdb-sidebar-item.active { background:rgba(212,255,0,0.07); color:#e8ecf0; border-color:rgba(212,255,0,0.16); }
        .vdb-sidebar-item.active svg { color:#d4ff00; }
        .vdb-sidebar-badge { margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:0.58rem; font-weight:700; padding:1px 5px; border-radius:4px; min-width:16px; text-align:center; }
        .vdb-sidebar-item.active .vdb-sidebar-badge { background:rgba(212,255,0,0.14); color:#d4ff00; }
        .vdb-sidebar-item:not(.active) .vdb-sidebar-badge { background:rgba(255,255,255,0.05); color:#475569; }

        .vdb-pipeline { padding:12px 12px 8px; border-top:1px solid rgba(255,255,255,0.05); }
        .vdb-pipeline-label { font-family:'JetBrains Mono',monospace; font-size:0.58rem; color:#2e3540; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:10px; }
        .vdb-pipeline-node { display:flex; align-items:center; gap:8px; padding:6px 8px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:7px; margin-bottom:2px; transition:border-color 0.3s; }
        .vdb-pipeline-node.live { border-color:rgba(212,255,0,0.18); }
        .vdb-pipeline-node-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
        .vdb-pipeline-node-dot.live { background:#d4ff00; animation:vdb-ping 2s ease-in-out infinite; }
        .vdb-pipeline-node-dot.idle { background:#2e3540; }
        .vdb-pipeline-node-text { font-size:0.68rem; font-weight:500; color:#3d4452; flex:1; }
        .vdb-pipeline-node.live .vdb-pipeline-node-text { color:#8a939f; }
        .vdb-pipeline-connector { display:flex; align-items:center; gap:4px; padding:1px 8px 1px 19px; color:rgba(212,255,0,0.2); font-family:'JetBrains Mono',monospace; font-size:0.6rem; letter-spacing:0.04em; }

        .vdb-stats-wrap { flex:1; overflow-y:auto; padding:0 8px 8px; }

        .vdb-network { padding:10px 12px; border-top:1px solid rgba(255,255,255,0.05); }
        .vdb-network-inner { background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:8px 10px; }
        .vdb-network-row { display:flex; align-items:center; gap:6px; margin-bottom:3px; }
        .vdb-network-dot { width:4px; height:4px; border-radius:50%; background:rgba(212,255,0,0.5); flex-shrink:0; }
        .vdb-network-label { font-family:'JetBrains Mono',monospace; font-size:0.62rem; color:#3d4452; letter-spacing:0.04em; }
        .vdb-userid { font-family:'JetBrains Mono',monospace; font-size:0.58rem; color:#252d38; margin-top:2px; padding-left:10px; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        .vdb-main { flex:1; overflow:hidden; background:#080e18; position:relative; }
        .vdb-main::before { content:''; position:absolute; inset:0; background-image:linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px); background-size:48px 48px; pointer-events:none; mask-image:radial-gradient(ellipse 80% 60% at 50% 30%, black 0%, transparent 100%); }
        .vdb-view { height:100%; animation:vdb-fadein 0.18s ease-out both; position:relative; z-index:1; }

        .vdb-mobile-nav { flex-shrink:0; display:none; border-top:1px solid rgba(255,255,255,0.07); background:rgba(7,11,16,0.98); }
        .vdb-mobile-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:10px 4px; cursor:pointer; background:transparent; border:none; outline:none; color:#3d4452; transition:color 0.15s; position:relative; }
        .vdb-mobile-item.active { color:#d4ff00; }
        .vdb-mobile-item-label { font-size:0.6rem; font-weight:500; letter-spacing:0.04em; }
        .vdb-mobile-badge { position:absolute; top:8px; right:calc(50% - 14px); background:#d4ff00; color:#070b10; font-family:'JetBrains Mono',monospace; font-size:0.52rem; font-weight:700; border-radius:4px; padding:0 3px; min-width:14px; text-align:center; line-height:14px; height:14px; }

        /* Fix 6: toast animations */
        @keyframes toast-in { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:none} }

        @keyframes vdb-fadein { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
        @keyframes vdb-ping { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.4)} }

        @media (max-width:1024px) { .vdb-sidebar{display:none} .vdb-tabs{display:none} .vdb-mobile-nav{display:flex} }
        @media (max-width:640px) { .vdb-brand-sub{display:none} }
      `}</style>

      <header className="vdb-topbar">
        <Link href="/" className="vdb-brand">
          <VolumaLogo size={26} />
          <div className="vdb-wordmark">Voluma</div>
        </Link>

        <div className="vdb-tabs">
          {NAV_ITEMS.map(item => {
            const count = counts[item.view];
            return (
              <button key={item.view} className={`vdb-tab${view === item.view ? ' active' : ''}`} onClick={() => setView(item.view)}>
                {item.icon}
                {item.label}
                {count !== undefined && count > 0 && (
                  <span className="vdb-tab-badge">{count > 999 ? '999+' : count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="vdb-status">
          <div className="vdb-status-dot" style={{ background: connected ? '#d4ff00' : '#f87171' }}>
            {connected && <div className="vdb-status-dot-ring" style={{ background: '#d4ff00', opacity: 0.4 }} />}
          </div>
          <span className="vdb-status-label" style={{ color: connected ? '#d4ff00' : '#f87171' }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </header>

      <div className="vdb-body">
        <aside className="vdb-sidebar">
          <nav className="vdb-sidebar-nav">
            {NAV_ITEMS.map(item => {
              const count = counts[item.view];
              return (
                <button key={item.view} className={`vdb-sidebar-item${view === item.view ? ' active' : ''}`} onClick={() => setView(item.view)}>
                  {item.icon}
                  {item.label}
                  {count !== undefined && count > 0 && (
                    <span className="vdb-sidebar-badge">{count > 999 ? '999+' : count}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="vdb-pipeline">
            <div className="vdb-pipeline-label">pipeline</div>
            {[
              { label: 'Solana RPC',   live: connected },
              { label: 'Ingestion',    live: connected },
              { label: 'Cond. Engine', live: connected },
              { label: 'Execution',    live: connected },
            ].map((node, i, arr) => (
              <div key={node.label}>
                <div className={`vdb-pipeline-node${node.live ? ' live' : ''}`}>
                  <div className={`vdb-pipeline-node-dot${node.live ? ' live' : ' idle'}`} />
                  <span className="vdb-pipeline-node-text">{node.label}</span>
                </div>
                {i < arr.length - 1 && <div className="vdb-pipeline-connector">↓</div>}
              </div>
            ))}
          </div>

          <div className="vdb-stats-wrap"><SystemStats /></div>

          <div className="vdb-network">
            <div className="vdb-network-inner">
              <div className="vdb-network-row">
                <div className="vdb-network-dot" />
                <span className="vdb-network-label">Solana Mainnet</span>
              </div>
              <span className="vdb-userid" title={userId}>{userId.slice(0, 18)}…</span>
            </div>
          </div>
        </aside>

        <main className="vdb-main">
          <div key={view} className="vdb-view">
            {view === 'feed'       && <EventFeed events={liveEvents} triggeredSigs={triggeredSigs} />}
            {view === 'triggers'   && <TriggerFeed events={triggers} onClear={clearTriggers} />}
            {view === 'conditions' && <ConditionsPanel userId={userId} />}
            {view === 'wallet'     && <WalletPanel userId={userId} pendingTxs={pendingTxs} />}
          </div>

          {tradeToasts.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 20, right: 20,
              display: 'flex', flexDirection: 'column', gap: 8,
              zIndex: 100, pointerEvents: 'none',
            }}>
              {tradeToasts.map(t => (
                <div key={t.id} style={{ pointerEvents: 'auto' }}>
                  <TradeToast {...t} onDismiss={dismissToast} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <nav className="vdb-mobile-nav">
        {NAV_ITEMS.map(item => {
          const count = counts[item.view];
          return (
            <button key={item.view} className={`vdb-mobile-item${view === item.view ? ' active' : ''}`} onClick={() => setView(item.view)}>
              {item.icon}
              <span className="vdb-mobile-item-label">{item.short}</span>
              {count !== undefined && count > 0 && (
                <span className="vdb-mobile-badge">{count > 99 ? '99+' : count}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
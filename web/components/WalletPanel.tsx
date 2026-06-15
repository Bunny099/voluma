'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, type WalletActivityLog, type SensitiveVerification, type WalletExportPayload } from '@/hooks/useWallet';
import { authClient }  from '@/lib/auth-client';
import { type PendingTxInfo } from '@/hooks/useSocket';

function shorten(s: string) { return `${s.slice(0, 8)}…${s.slice(-6)}`; }

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const LAMPORTS  = 1_000_000_000;

const INP: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8, color: '#e8ecf0', fontSize: '0.8rem', fontFamily: 'DM Sans, sans-serif',
  height: 38, padding: '0 10px', width: '100%', outline: 'none',
};
const INP_MONO: React.CSSProperties = { ...INP, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' };

function formatActivity(log: WalletActivityLog): { title: string; detail: string } {
  const metadata = log.metadata ?? {};
  switch (log.actionType) {
    case 'WALLET_CREATED':
      return { title: 'Wallet created', detail: 'Custodial trading wallet provisioned' };
    case 'WALLET_EXPORT_REQUESTED':
      return { title: 'Wallet export requested', detail: 'Private key revealed in secure export flow' };
    case 'WITHDRAWAL_EXECUTED':
      return {
        title: 'Withdrawal submitted',
        detail: metadata.asset === 'TOKEN'
          ? `${String(metadata.uiAmount ?? '0')} tokens → ${String(metadata.destinationAddress ?? '')}`
          : `${String(metadata.amountSol ?? '0')} SOL → ${String(metadata.destinationAddress ?? '')}`,
      };
    case 'TRADE_EXECUTED':
      return {
        title: 'Trade submitted',
        detail: `${String(metadata.direction ?? 'TRADE')} · ${String(metadata.status ?? 'UNKNOWN')}`,
      };
    default:
      return { title: log.actionType, detail: '' };
  }
}

// ── Animated balance display ──────────────────────────────────────────────────

function BalanceNumber({ value, prevValue }: { value: number | null; prevValue: number | null }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [delta,   setDelta]   = useState<number | null>(null);
  const [showDelta, setShowDelta] = useState(false);
  const [flash,   setFlash]   = useState(false);

  useEffect(() => {
    if (value === null) { setDisplayValue(null); return; }
    if (prevValue !== null && value !== prevValue) {
      const d = value - prevValue;
      setDelta(d); setShowDelta(true); setFlash(true);
      const start = prevValue; const end = value; const duration = 1200; const t0 = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4);
        setDisplayValue(start + (end - start) * ease);
        if (progress < 1) requestAnimationFrame(tick); else setDisplayValue(end);
      };
      requestAnimationFrame(tick);
      const hideTimer = setTimeout(() => { setShowDelta(false); setFlash(false); }, 3_500);
      return () => clearTimeout(hideTimer);
    } else { setDisplayValue(value); }
  }, [value]);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily:'Bebas Neue, sans-serif', fontSize:'clamp(2.6rem, 6vw, 3.8rem)', lineHeight:1, letterSpacing:'0.03em', color: flash ? '#d4ff00' : displayValue && displayValue > 0 ? '#e8ecf0' : '#5a6b7e', transition:'color 0.4s', textShadow: flash ? '0 0 30px rgba(212,255,0,0.3)' : 'none' }}>
          {displayValue !== null ? displayValue.toFixed(4) : '—'}
        </span>
        <span style={{ fontFamily:'Bebas Neue, sans-serif', fontSize:'1.4rem', letterSpacing:'0.06em', color:'#5a6b7e' }}>SOL</span>
      </div>
      {showDelta && delta !== null && (
        <div style={{ position:'absolute', top:-4, right:0, fontFamily:'JetBrains Mono, monospace', fontSize:'0.72rem', fontWeight:700, color: delta > 0 ? '#d4ff00' : '#f87171', background: delta > 0 ? 'rgba(212,255,0,0.1)' : 'rgba(248,113,113,0.1)', border:`1px solid ${delta > 0 ? 'rgba(212,255,0,0.3)' : 'rgba(248,113,113,0.3)'}`, padding:'2px 7px', borderRadius:6, animation:'wp-delta 0.4s ease-out both' }}>
          {delta > 0 ? '+' : ''}{delta.toFixed(4)}
        </div>
      )}
    </div>
  );
}

// ── Token row with quick-sell ─────────────────────────────────────────────────

interface SellState {
  loading: boolean;
  error: string | null;
  txHash: string | null;
  quote: string | null;
  quotePct: number | null;
  status: 'idle' | 'pending' | 'confirmed';
}

function TokenRow({ mint, symbol, balance, decimals, userId, onSellSuccess }: {
  mint: string; symbol: string; balance: number; decimals: number;
  userId: string; onSellSuccess: () => void;
}) {
 
  const { data: sessionData } = authClient.useSession();
  const authToken = sessionData?.session?.token ?? '';

  const [sell,     setSell]     = useState<SellState>({ loading:false, error:null, txHash:null, quote:null, quotePct:null, status:'idle' });
  const [expanded, setExpanded] = useState(false);

  const fetchQuote = useCallback(async (pct: number) => {
    const rawBalance = Math.floor(balance * Math.pow(10, decimals));
    const rawSell    = Math.floor(rawBalance * pct / 100);
    if (!rawSell) return;
    try {
     
      const r = await fetch(`${BASE()}/trade/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${rawSell}`);
      const data = await r.json();
      if (r.ok && data.expectedOutput) {
        setSell(s => ({ ...s, quote: `~${(data.expectedOutput / LAMPORTS).toFixed(4)} SOL`, quotePct: pct }));
      } else {
        setSell(s => ({ ...s, quote: null, quotePct: null }));
      }
    } catch { setSell(s => ({ ...s, quote: null })); }
  }, [mint, balance, decimals]);

  const executeSell = async (pct: number) => {
    if (!authToken) { setSell(s => ({ ...s, error: 'Not authenticated — please sign in again' })); return; }
    setSell(s => ({ ...s, loading:true, error:null, txHash:null }));
    try {
      const r = await fetch(`${BASE()}/trade/manual`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ userId, direction: 'SELL', tokenMint: mint, percent: pct }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSell(s => ({
        ...s,
        loading:false,
        txHash: data.txHash ?? null,
        error:null,
        status: data.status === 'PENDING' ? 'pending' : 'confirmed',
      }));
      onSellSuccess();
    } catch (e: any) {
      setSell(s => ({ ...s, loading:false, error: e.message ?? 'Sell failed' }));
    }
  };

  const btnStyle = (): React.CSSProperties => ({
    padding:'4px 10px', borderRadius:7, border:'1px solid rgba(248,113,113,0.18)',
    background:'rgba(248,113,113,0.05)', color:'#f87171',
    cursor: sell.loading ? 'not-allowed' : 'pointer',
    fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', fontWeight:700,
    letterSpacing:'0.04em', opacity: sell.loading ? 0.5 : 1, transition:'all 0.15s',
  });

  return (
    <div style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <div onClick={() => setExpanded(e => !e)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', cursor:'pointer' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(255,255,255,0.04)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', fontWeight:700, color:'#5c6472' }}>
            {symbol.slice(0,2)}
          </div>
          <div>
            <div style={{ fontSize:'0.8rem', fontWeight:600, color:'#c4ccd6' }}>{symbol}</div>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', color:'#506070' }}>{shorten(mint)}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.75rem', fontWeight:600, color:'#8a939f' }}>{balance.toLocaleString(undefined, { maximumFractionDigits:4 })}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transition:'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none', color:'#5a6b7e' }}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      {expanded && (
        <div style={{ padding:'0 0 12px', display:'flex', flexDirection:'column', gap:8 }}>
          <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', letterSpacing:'0.1em', color:'#506070', textTransform:'uppercase' as const }}>Quick Sell</p>
          <div style={{ display:'flex', gap:6 }}>
            {([25, 50, 100] as const).map(pct => (
              <button key={pct} style={btnStyle()} disabled={sell.loading} onMouseEnter={() => fetchQuote(pct)} onClick={() => executeSell(pct)}>
                {sell.loading ? '…' : `${pct}%`}
              </button>
            ))}
          </div>
          {sell.quote && sell.quotePct && (
            <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.64rem', color:'#5c6472' }}>
              {sell.quotePct}% ≈ <span style={{ color:'#d4ff00' }}>{sell.quote}</span>
            </p>
          )}
          {sell.error && (
            <div style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, padding:'7px 10px' }}>
              <p style={{ fontSize:'0.72rem', color:'#f87171', fontFamily:'JetBrains Mono, monospace' }}>{sell.error}</p>
            </div>
          )}
          {sell.txHash && (
            <a href={`https://solscan.io/tx/${sell.txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px', borderRadius:8, background: sell.status === 'pending' ? 'rgba(251,191,36,0.06)' : 'rgba(212,255,0,0.06)', border:`1px solid ${sell.status === 'pending' ? 'rgba(251,191,36,0.2)' : 'rgba(212,255,0,0.2)'}`, color: sell.status === 'pending' ? '#fbbf24' : '#d4ff00', textDecoration:'none', fontFamily:'JetBrains Mono, monospace', fontSize:'0.66rem' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5L4 7.5L8.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              {sell.status === 'pending' ? 'Sell pending' : 'Sell confirmed'} — {sell.txHash.slice(0,18)}… ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main WalletPanel ──────────────────────────────────────────────────────────

export default function WalletPanel({ userId, pendingTxs = [] }: { userId: string; pendingTxs?: PendingTxInfo[] }) {
  const {
    wallet,
    loading,
    creating,
    error,
    createWallet,
    refreshBalance,
    requestSensitiveVerification,
    exportWallet,
    exporting,
    exportError,
    withdrawSOL,
    withdrawing,
    withdrawError,
    withdrawTx,
  } = useWallet(userId);

  const prevBalanceRef = useRef<number | null>(null);
  const [copied,       setCopied]       = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showExport,   setShowExport]   = useState(false);
  const [destAddr,     setDestAddr]     = useState('');
  const [withdrawAmt,  setWithdrawAmt]  = useState('');
  const [addrError,    setAddrError]    = useState<string | null>(null);
  const [amtError,     setAmtError]     = useState<string | null>(null);
  const [withdrawConfirm, setWithdrawConfirm] = useState('');
  const [exportConfirm,   setExportConfirm]   = useState('');
  const [withdrawVerification, setWithdrawVerification] = useState<SensitiveVerification | null>(null);
  const [exportVerification,   setExportVerification]   = useState<SensitiveVerification | null>(null);
  const [exportData,           setExportData]           = useState<WalletExportPayload | null>(null);
  const [securityError,        setSecurityError]        = useState<string | null>(null);
  const [copiedExport,         setCopiedExport]         = useState<'private' | 'json' | null>(null);

  const prevBalance = prevBalanceRef.current;
  const mergedPending = (() => {
    const combined = [...pendingTxs, ...(wallet?.pendingTxs ?? [])];
    const seen = new Set<string>();
    return combined.filter((tx) => {
      if (seen.has(tx.txHash)) return false;
      seen.add(tx.txHash);
      return true;
    });
  })();

  useEffect(() => {
    if (wallet?.balanceSol !== undefined) {
      setTimeout(() => { prevBalanceRef.current = wallet.balanceSol ?? null; }, 1500);
    }
  }, [wallet?.balanceSol]);

  const copy = async () => {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.publicKey);
    setCopied(true); setTimeout(() => setCopied(false), 2_000);
  };

  const verifySensitive = async (action: 'EXPORT_WALLET' | 'WITHDRAW_SOL' | 'WITHDRAW_TOKEN') => {
    setSecurityError(null);
    try {
      const verification = await requestSensitiveVerification(action);
      if (action === 'EXPORT_WALLET') setExportVerification(verification);
      else setWithdrawVerification(verification);
    } catch (e) {
      setSecurityError(e instanceof Error ? e.message : 'Session verification failed');
    }
  };

  const validateWithdraw = () => {
    setAddrError(null); setAmtError(null);
    const amt = parseFloat(withdrawAmt);
    let ok = true;
    if (!destAddr || destAddr.length < 32) { setAddrError('Enter a valid Solana address'); ok = false; }
    if (!withdrawAmt || isNaN(amt) || amt <= 0) { setAmtError('Enter an amount greater than 0'); ok = false; }
    else if (wallet?.balanceSol !== null && amt > (wallet?.balanceSol ?? 0) - 0.005) {
      setAmtError(`Max ~${Math.max(0, (wallet?.balanceSol ?? 0) - 0.005).toFixed(4)} SOL (reserve 0.005 for fees)`); ok = false;
    }
    if (!withdrawVerification?.token) { setSecurityError('Verify your session before withdrawing'); ok = false; }
    if (withdrawConfirm.trim().toUpperCase() !== 'WITHDRAW') { setSecurityError('Type WITHDRAW to confirm this action'); ok = false; }
    if (ok && withdrawVerification) {
      withdrawSOL(destAddr, amt, withdrawVerification.token, withdrawConfirm);
    }
  };

  const revealExport = async () => {
    if (!exportVerification) {
      setSecurityError('Verify your session before export');
      return;
    }
    if (exportConfirm.trim().toUpperCase() !== 'EXPORT') {
      setSecurityError('Type EXPORT to confirm wallet export');
      return;
    }
    try {
      const data = await exportWallet(exportVerification.token, exportConfirm);
      setExportData(data);
      setSecurityError(null);
    } catch (e) {
      setSecurityError(e instanceof Error ? e.message : 'Wallet export failed');
    }
  };

  const copyExport = async (kind: 'private' | 'json') => {
    if (!exportData) return;
    await navigator.clipboard.writeText(kind === 'private' ? exportData.privateKeyBase58 : exportData.secretKeyJson);
    setCopiedExport(kind);
    setTimeout(() => setCopiedExport(null), 2_000);
  };

  const CARD: React.CSSProperties = { background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, overflow:'hidden' };

  if (loading && !wallet) {
    return (
      <div style={{ height:'100%', overflowY:'auto', padding:24 }}>
        <style>{`@keyframes wp-pulse{0%,100%{opacity:0.3}50%{opacity:0.7}}`}</style>
        <div style={{ maxWidth:560, margin:'0 auto', display:'flex', flexDirection:'column', gap:14 }}>
          {[120,80,200].map((h,i) => (
            <div key={i} style={{ height:h, borderRadius:14, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', animation:`wp-pulse 1.6s ${i*0.15}s ease-in-out infinite` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height:'100%', overflowY:'auto', fontFamily:'DM Sans,system-ui,sans-serif' }}>
      <style>{`
        .wp-scroll::-webkit-scrollbar { width: 3px; }
        .wp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        @keyframes wp-delta { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        @keyframes wp-fadein { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        .wp-input:focus { border-color: rgba(255,255,255,0.2) !important; }
      `}</style>
      <div className="wp-scroll" style={{ maxWidth:560, margin:'0 auto', padding:'24px 20px 48px', display:'flex', flexDirection:'column', gap:16 }}>

        {error && (
          <div style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:10, padding:'10px 14px' }}>
            <p style={{ fontSize:'0.75rem', color:'#f87171', fontFamily:'JetBrains Mono, monospace' }}>{error}</p>
          </div>
        )}

        {!wallet ? (
          <div style={{ ...CARD, padding:'32px 24px', textAlign:'center', animation:'wp-fadein 0.3s ease-out both' }}>
            <div style={{ width:52, height:52, borderRadius:14, background:'rgba(212,255,0,0.06)', border:'1px solid rgba(212,255,0,0.15)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="5" width="18" height="13" rx="2" stroke="#d4ff00" strokeWidth="1.4" opacity="0.6"/>
                <path d="M2 9H20" stroke="#d4ff00" strokeWidth="1.4" opacity="0.4"/>
                <circle cx="16" cy="13.5" r="1.5" fill="#d4ff00" opacity="0.5"/>
              </svg>
            </div>
            <p style={{ fontFamily:'Bebas Neue, sans-serif', fontSize:'1.3rem', letterSpacing:'0.08em', color:'#e8ecf0', marginBottom:8 }}>No Trading Wallet</p>
            <p style={{ fontSize:'0.78rem', color:'#5c6472', lineHeight:1.6, marginBottom:22 }}>Create a dedicated wallet with AES-256 encrypted key storage. Keys are decrypted only during execution.</p>
            <button onClick={createWallet} disabled={creating}
              style={{ padding:'10px 28px', borderRadius:10, border:'1px solid rgba(212,255,0,0.3)', background:'rgba(212,255,0,0.08)', color: creating ? '#5a6b7e' : '#d4ff00', fontSize:'0.82rem', fontWeight:600, cursor: creating ? 'not-allowed' : 'pointer', fontFamily:'DM Sans, sans-serif', transition:'all 0.2s' }}>
              {creating ? 'Creating…' : 'Create Trading Wallet'}
            </button>
          </div>
        ) : (
          <>
            {/* Balance card */}
            <div style={{ ...CARD, padding:'20px 20px 18px', animation:'wp-fadein 0.3s ease-out both' }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:6 }}>
                <div>
                  <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.14em', color:'#506070', textTransform:'uppercase' as const, marginBottom:10 }}>TRADING BALANCE</p>
                  <BalanceNumber value={wallet.balanceSol} prevValue={prevBalance} />
                </div>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={refreshBalance}
                    style={{ width:32, height:32, borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'#5a6b7e', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color='#8a939f'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color='#5a6b7e'; }}
                    title="Refresh balance">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6C2 3.8 3.8 2 6 2C7.5 2 8.8 2.8 9.5 4M10 6C10 8.2 8.2 10 6 10C4.5 10 3.2 9.2 2.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M9 1.5V4.5H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" transform="translate(-3,0)"/></svg>
                  </button>
                  {wallet.balanceSol !== null && (
                    <span style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:7, background: wallet.balanceSol >= 0.005 ? 'rgba(212,255,0,0.07)' : 'rgba(251,191,36,0.07)', border:`1px solid ${wallet.balanceSol >= 0.005 ? 'rgba(212,255,0,0.2)' : 'rgba(251,191,36,0.2)'}`, fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.08em', color: wallet.balanceSol >= 0.005 ? '#d4ff00' : '#fbbf24' }}>
                      <span style={{ width:5, height:5, borderRadius:'50%', background:'currentColor' }} />
                      {wallet.balanceSol >= 0.005 ? 'READY' : 'LOW'}
                    </span>
                  )}
                </div>
              </div>

              {wallet.balanceSol !== null && wallet.balanceSol < 0.005 && (
                <div style={{ padding:'8px 12px', borderRadius:9, background:'rgba(251,191,36,0.06)', border:'1px solid rgba(251,191,36,0.2)', display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                  <span style={{ color:'#fbbf24', fontSize:'0.8rem' }}>⚠</span>
                  <p style={{ fontSize:'0.72rem', color:'rgba(251,191,36,0.8)' }}>Balance too low for trades. Fund this wallet to enable automation.</p>
                </div>
              )}

              {/* Token holdings */}
              {wallet.tokens.length > 0 && (
                <div style={{ marginTop:18 }}>
                  <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, marginBottom:10 }}>Token Holdings</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                    {wallet.tokens.map(t => (
                      <TokenRow key={t.mint} mint={t.mint} symbol={t.symbol} balance={t.balance} decimals={t.decimals} userId={userId} onSellSuccess={refreshBalance} />
                    ))}
                  </div>
                </div>
              )}

              {/* Pending transactions from WS stream */}
              {mergedPending.length > 0 && (
                <div style={{ marginTop:18 }}>
                  <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#fbbf24', textTransform:'uppercase' as const, marginBottom:8 }}>Pending Transactions</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    {mergedPending.map(tx => (
                      <a key={tx.txHash} href={`https://solscan.io/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer"
                        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', borderRadius:8, background:'rgba(251,191,36,0.05)', border:'1px solid rgba(251,191,36,0.15)', textDecoration:'none' }}>
                        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#5c6472' }}>{tx.txHash.slice(0,16)}…</span>
                        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, color:'#fbbf24', letterSpacing:'0.06em' }}>PENDING</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Wallet address */}
              <div style={{ marginTop:18 }}>
                <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, marginBottom:8 }}>Wallet Address</p>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <code style={{ flex:1, display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'JetBrains Mono, monospace', fontSize:'0.65rem', color:'#5c6472', padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                    {wallet.publicKey}
                  </code>
                  <button onClick={copy}
                    style={{ width:34, height:34, flexShrink:0, borderRadius:8, background: copied ? 'rgba(212,255,0,0.1)' : 'rgba(255,255,255,0.03)', border:`1px solid ${copied ? 'rgba(212,255,0,0.3)' : 'rgba(255,255,255,0.08)'}`, color: copied ? '#d4ff00' : '#5a6b7e', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s' }}>
                    {copied
                      ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="3.5" y="1" width="7" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><rect x="1.5" y="2.5" width="7" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/></svg>}
                  </button>
                </div>
              </div>

              <div style={{ marginTop:18 }}>
                <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, marginBottom:8 }}>Security</p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  <span style={{ padding:'4px 10px', borderRadius:7, background:'rgba(212,255,0,0.07)', border:'1px solid rgba(212,255,0,0.2)', color:'#d4ff00', fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.06em' }}>
                    AES-256 v{wallet.security.encryptionVersion}
                  </span>
                  <span style={{ padding:'4px 10px', borderRadius:7, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'#5c6472', fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.06em' }}>
                    Session verify required
                  </span>
                </div>
              </div>
            </div>

            <div style={CARD}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px' }}>
                <div>
                  <p style={{ fontSize:'0.82rem', fontWeight:600, color:'#c4ccd6', marginBottom:2 }}>Export Wallet</p>
                  <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#506070' }}>Reveal the private key for Phantom or Solflare import</p>
                </div>
                <button onClick={() => { setShowExport(true); setExportData(null); setExportConfirm(''); setExportVerification(null); setSecurityError(null); }}
                  style={{ padding:'6px 14px', borderRadius:8, background:'rgba(248,113,113,0.05)', border:'1px solid rgba(248,113,113,0.16)', color:'#f87171', cursor:'pointer', fontSize:'0.72rem', fontFamily:'DM Sans, sans-serif' }}>
                  Export →
                </button>
              </div>
            </div>

            {/* Withdraw SOL */}
            <div style={CARD}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px' }}>
                <div>
                  <p style={{ fontSize:'0.82rem', fontWeight:600, color:'#c4ccd6', marginBottom:2 }}>Withdraw SOL</p>
                  <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#506070' }}>Send funds to any Solana wallet</p>
                </div>
                <button onClick={() => { setShowWithdraw(v => !v); setAddrError(null); setAmtError(null); setSecurityError(null); }}
                  style={{ padding:'6px 14px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)', color:'#5c6472', cursor:'pointer', fontSize:'0.72rem', fontFamily:'DM Sans, sans-serif', transition:'all 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color='#e8ecf0'; (e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.16)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color='#5c6472'; (e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.09)'; }}>
                  {showWithdraw ? 'Cancel' : 'Withdraw →'}
                </button>
              </div>
              {showWithdraw && (
                <div style={{ padding:'0 16px 16px', borderTop:'1px solid rgba(255,255,255,0.05)', paddingTop:14, display:'flex', flexDirection:'column', gap:10 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
                    <div>
                      <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.1em', color:'#8a939f' }}>
                        SESSION CHECK
                      </p>
                      <p style={{ fontSize:'0.68rem', color:'#5a6b7e', marginTop:2 }}>
                        {withdrawVerification ? `Verified until ${new Date(withdrawVerification.expiresAt).toLocaleTimeString()}` : 'Required before submitting withdrawal'}
                      </p>
                    </div>
                    <button onClick={() => verifySensitive('WITHDRAW_SOL')}
                      style={{ padding:'6px 10px', borderRadius:8, border:'1px solid rgba(212,255,0,0.2)', background:'rgba(212,255,0,0.06)', color:'#d4ff00', cursor:'pointer', fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', fontWeight:700 }}>
                      {withdrawVerification ? 're-verify' : 'verify'}
                    </button>
                  </div>
                  <div>
                    <label style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, display:'block', marginBottom:6 }}>Destination</label>
                    <input className="wp-input" placeholder="Solana wallet address" value={destAddr} onChange={e => { setDestAddr(e.target.value); setAddrError(null); }} style={INP_MONO} />
                    {addrError && <p style={{ fontSize:'0.68rem', color:'#f87171', marginTop:4 }}>{addrError}</p>}
                  </div>
                  <div>
                    <label style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, display:'block', marginBottom:6 }}>Amount (SOL)</label>
                    <input className="wp-input" type="number" min={0.001} step={0.001} placeholder="0.1" value={withdrawAmt} onChange={e => { setWithdrawAmt(e.target.value); setAmtError(null); }} style={INP} />
                    {amtError && <p style={{ fontSize:'0.68rem', color:'#f87171', marginTop:4 }}>{amtError}</p>}
                  </div>
                  <div>
                    <label style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, display:'block', marginBottom:6 }}>Type WITHDRAW</label>
                    <input className="wp-input" placeholder="WITHDRAW" value={withdrawConfirm} onChange={e => setWithdrawConfirm(e.target.value)} style={INP_MONO} />
                  </div>
                  {withdrawError && <div style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, padding:'7px 10px' }}><p style={{ fontSize:'0.72rem', color:'#f87171' }}>{withdrawError}</p></div>}
                  {securityError && <div style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, padding:'7px 10px' }}><p style={{ fontSize:'0.72rem', color:'#f87171' }}>{securityError}</p></div>}
                  {withdrawTx && (
                    <a href={`https://solscan.io/tx/${withdrawTx}`} target="_blank" rel="noopener noreferrer"
                      style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 12px', borderRadius:8, background:'rgba(212,255,0,0.06)', border:'1px solid rgba(212,255,0,0.2)', color:'#d4ff00', textDecoration:'none', fontFamily:'JetBrains Mono, monospace', fontSize:'0.68rem' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      Sent — {withdrawTx.slice(0,20)}… ↗
                    </a>
                  )}
                  <button onClick={validateWithdraw} disabled={withdrawing}
                    style={{ height:40, borderRadius:8, border:'none', cursor:'pointer', background:'rgba(255,255,255,0.07)', color: withdrawing ? '#5a6b7e' : '#c4ccd6', fontSize:'0.8rem', fontWeight:600, fontFamily:'DM Sans, sans-serif', transition:'all 0.2s', opacity: withdrawing ? 0.5 : 1 }}>
                    {withdrawing ? 'Sending…' : 'Confirm Withdrawal'}
                  </button>
                </div>
              )}
            </div>

            <div style={CARD}>
              <div style={{ padding:'13px 16px 10px' }}>
                <p style={{ fontSize:'0.82rem', fontWeight:600, color:'#c4ccd6', marginBottom:2 }}>Activity History</p>
                <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#506070' }}>Recent security-sensitive actions for this wallet</p>
              </div>
              <div style={{ borderTop:'1px solid rgba(255,255,255,0.05)', padding:'10px 16px 14px', display:'flex', flexDirection:'column', gap:8 }}>
                {wallet.recentActivity.length === 0 ? (
                  <p style={{ fontSize:'0.72rem', color:'#5a6b7e' }}>No wallet activity logged yet.</p>
                ) : wallet.recentActivity.map((log) => {
                  const content = formatActivity(log);
                  return (
                    <div key={log.id} style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <div>
                        <p style={{ fontSize:'0.74rem', color:'#c4ccd6', fontWeight:600 }}>{content.title}</p>
                        <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', color:'#5a6b7e', marginTop:2 }}>{content.detail}</p>
                      </div>
                      <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', color:'#506070', whiteSpace:'nowrap' }}>
                        {new Date(log.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Fund instructions */}
            <div style={{ background:'rgba(255,255,255,0.01)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:11, padding:'14px 16px' }}>
              <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, marginBottom:11 }}>How to fund</p>
              <ol style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {['Copy your wallet address above','Send SOL from Phantom, Backpack, or any Solana wallet','Minimum: trade amount + 0.005 SOL for network fees','Trades execute automatically when your conditions fire'].map((s,i) => (
                  <li key={i} style={{ display:'flex', gap:10, fontSize:'0.72rem', color:'#5a6b7e', lineHeight:1.5 }}>
                    <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#506070', flexShrink:0 }}>{i+1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div style={{ textAlign:'center' }}>
              <a href={`https://solscan.io/account/${wallet.publicKey}`} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', color:'#506070', textDecoration:'none', transition:'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color='#5c6472')}
                onMouseLeave={e => (e.currentTarget.style.color='#506070')}>
                View on Solscan ↗
              </a>
            </div>
          </>
        )}
      </div>
      {showExport && wallet && (
        <div style={{ position:'fixed', inset:0, background:'rgba(4,8,12,0.82)', backdropFilter:'blur(10px)', zIndex:120, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ width:'100%', maxWidth:560, background:'#0b1118', border:'1px solid rgba(255,255,255,0.08)', borderRadius:16, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ padding:'18px 18px 14px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <p style={{ fontFamily:'Bebas Neue, sans-serif', fontSize:'1.1rem', letterSpacing:'0.08em', color:'#e8ecf0' }}>Export Wallet</p>
                <p style={{ fontSize:'0.72rem', color:'#5c6472', marginTop:4 }}>Reveals the private key. Anyone with it can drain this wallet.</p>
              </div>
              <button onClick={() => setShowExport(false)} style={{ background:'transparent', border:'none', color:'#5a6b7e', fontSize:18, cursor:'pointer' }}>×</button>
            </div>
            <div style={{ padding:'16px 18px 18px', display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ padding:'10px 12px', borderRadius:10, background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.18)' }}>
                <p style={{ fontSize:'0.74rem', color:'#f87171', lineHeight:1.5 }}>Import only into wallets you trust. Voluma never stores the revealed private key after this response.</p>
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.1em', color:'#8a939f' }}>SESSION CHECK</p>
                  <p style={{ fontSize:'0.68rem', color:'#5a6b7e', marginTop:2 }}>
                    {exportVerification ? `Verified until ${new Date(exportVerification.expiresAt).toLocaleTimeString()}` : 'Required before revealing export data'}
                  </p>
                </div>
                <button onClick={() => verifySensitive('EXPORT_WALLET')}
                  style={{ padding:'6px 10px', borderRadius:8, border:'1px solid rgba(212,255,0,0.2)', background:'rgba(212,255,0,0.06)', color:'#d4ff00', cursor:'pointer', fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', fontWeight:700 }}>
                  {exportVerification ? 're-verify' : 'verify'}
                </button>
              </div>
              <div>
                <label style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, display:'block', marginBottom:6 }}>Type EXPORT</label>
                <input className="wp-input" placeholder="EXPORT" value={exportConfirm} onChange={e => setExportConfirm(e.target.value)} style={INP_MONO} />
              </div>
              {(securityError || exportError) && (
                <div style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, padding:'7px 10px' }}>
                  <p style={{ fontSize:'0.72rem', color:'#f87171' }}>{securityError ?? exportError}</p>
                </div>
              )}
              {!exportData ? (
                <button onClick={revealExport} disabled={exporting}
                  style={{ height:40, borderRadius:8, border:'none', cursor:'pointer', background:'rgba(248,113,113,0.08)', color: exporting ? '#5a6b7e' : '#f87171', fontSize:'0.8rem', fontWeight:600, fontFamily:'DM Sans, sans-serif', opacity: exporting ? 0.5 : 1 }}>
                  {exporting ? 'Revealing…' : 'Reveal Private Key'}
                </button>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <div>
                    <label style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, display:'block', marginBottom:6 }}>Phantom / Solflare private key</label>
                    <div style={{ display:'flex', gap:8 }}>
                      <code style={{ flex:1, fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#c4ccd6', padding:'10px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', overflowWrap:'anywhere' }}>{exportData.privateKeyBase58}</code>
                      <button onClick={() => copyExport('private')} style={{ minWidth:88, borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color: copiedExport === 'private' ? '#d4ff00' : '#8a939f', cursor:'pointer', fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem' }}>{copiedExport === 'private' ? 'copied' : 'copy'}</button>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.12em', color:'#506070', textTransform:'uppercase' as const, display:'block', marginBottom:6 }}>Raw secret key JSON</label>
                    <div style={{ display:'flex', gap:8 }}>
                      <code style={{ flex:1, fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#8a939f', padding:'10px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', overflowWrap:'anywhere' }}>{exportData.secretKeyJson}</code>
                      <button onClick={() => copyExport('json')} style={{ minWidth:88, borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color: copiedExport === 'json' ? '#d4ff00' : '#8a939f', cursor:'pointer', fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem' }}>{copiedExport === 'json' ? 'copied' : 'copy'}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

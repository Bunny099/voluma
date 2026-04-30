'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { type PendingTxInfo } from '@/hooks/useSocket';

function shorten(s: string) { return `${s.slice(0, 8)}…${s.slice(-6)}`; }

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const INP: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#e8ecf0',
  fontSize: '0.8rem',
  fontFamily: 'DM Sans, sans-serif',
  height: 38,
  padding: '0 10px',
  width: '100%',
  outline: 'none',
};
const INP_MONO: React.CSSProperties = { ...INP, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' };



function BalanceNumber({ value, prevValue }: { value: number | null; prevValue: number | null }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [delta, setDelta]               = useState<number | null>(null);
  const [showDelta, setShowDelta]        = useState(false);
  const [flash, setFlash]               = useState(false);

  useEffect(() => {
    if (value === null) { setDisplayValue(null); return; }
    if (prevValue !== null && value !== prevValue) {
      const d = value - prevValue;
      setDelta(d);
      setShowDelta(true);
      setFlash(true);
      const start = prevValue;
      const end   = value;
      const duration = 1200;
      const t0 = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4);
        setDisplayValue(start + (end - start) * ease);
        if (progress < 1) requestAnimationFrame(tick);
        else setDisplayValue(end);
      };
      requestAnimationFrame(tick);
      const hideTimer = setTimeout(() => { setShowDelta(false); setFlash(false); }, 3_500);
      return () => clearTimeout(hideTimer);
    } else {
      setDisplayValue(value);
    }
  }, [value]);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily: 'Bebas Neue, sans-serif',
          fontSize: 'clamp(2.6rem, 6vw, 3.8rem)',
          lineHeight: 1,
          letterSpacing: '0.03em',
          color: flash ? '#d4ff00' : displayValue && displayValue > 0 ? '#e8ecf0' : '#3d4452',
          transition: 'color 0.4s',
          textShadow: flash ? '0 0 30px rgba(212,255,0,0.3)' : 'none',
        }}>
          {displayValue !== null ? displayValue.toFixed(4) : '—'}
        </span>
        <span style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '1.4rem', letterSpacing: '0.06em', color: '#3d4452' }}>SOL</span>
      </div>
      {showDelta && delta !== null && (
        <div style={{
          position: 'absolute', top: -4, right: 0,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.72rem', fontWeight: 700,
          color: delta > 0 ? '#d4ff00' : '#f87171',
          background: delta > 0 ? 'rgba(212,255,0,0.1)' : 'rgba(248,113,113,0.1)',
          border: `1px solid ${delta > 0 ? 'rgba(212,255,0,0.3)' : 'rgba(248,113,113,0.3)'}`,
          padding: '2px 7px', borderRadius: 6,
          animation: 'wp-delta 0.4s ease-out both',
        }}>
          {delta > 0 ? '+' : ''}{delta.toFixed(4)}
        </div>
      )}
    </div>
  );
}



interface SellState {
  loading:   boolean;
  error:     string | null;
  txHash:    string | null;
  quote:     string | null;   
  quotePct:  number | null;   
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS = 1_000_000_000;

function TokenRow({
  mint, symbol, balance, decimals, userId, onSellSuccess,
}: {
  mint: string; symbol: string; balance: number; decimals: number;
  userId: string; onSellSuccess: () => void;
}) {
  const [sell, setSell] = useState<SellState>({
    loading: false, error: null, txHash: null, quote: null, quotePct: null,
  });
  const [expanded, setExpanded] = useState(false);

  const fetchQuote = useCallback(async (pct: number) => {
    
    const rawBalance = Math.floor(balance * Math.pow(10, decimals));
    const rawSell    = Math.floor(rawBalance * pct / 100);
    if (!rawSell) return;

    try {
      const r = await fetch(
        `${BASE()}/trade/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${rawSell}`
      );
      const data = await r.json();
      if (r.ok && data.expectedOutput) {
        const solOut = (data.expectedOutput / LAMPORTS).toFixed(4);
        setSell(s => ({ ...s, quote: `~${solOut} SOL`, quotePct: pct }));
      } else {
        setSell(s => ({ ...s, quote: null, quotePct: null }));
      }
    } catch {
      setSell(s => ({ ...s, quote: null }));
    }
  }, [mint, balance, decimals]);

  const executeSell = async (pct: number) => {
    setSell(s => ({ ...s, loading: true, error: null, txHash: null }));
    try {
      const r = await fetch(`${BASE()}/trade/manual`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId, direction: 'SELL', tokenMint: mint, percent: pct }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSell(s => ({ ...s, loading: false, txHash: data.txHash ?? null, error: null }));
      onSellSuccess();
    } catch (e: any) {
      setSell(s => ({ ...s, loading: false, error: e.message ?? 'Sell failed' }));
    }
  };

  const btnStyle = (active?: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 7,
    border: `1px solid ${active ? 'rgba(248,113,113,0.4)' : 'rgba(248,113,113,0.18)'}`,
    background: active ? 'rgba(248,113,113,0.12)' : 'rgba(248,113,113,0.05)',
    color: '#f87171',
    cursor: sell.loading ? 'not-allowed' : 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '0.62rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    opacity: sell.loading ? 0.5 : 1,
    transition: 'all 0.15s',
  });

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
    
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', fontWeight: 700, color: '#5c6472',
          }}>
            {symbol.slice(0, 2)}
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#c4ccd6' }}>{symbol}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', color: '#2e3540' }}>{shorten(mint)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', fontWeight: 600, color: '#8a939f' }}>
            {balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none', color: '#3d4452' }}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      
      {expanded && (
        <div style={{ padding: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem',
            letterSpacing: '0.1em', color: '#2e3540', textTransform: 'uppercase' as const,
          }}>
            Quick Sell
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            {([25, 50, 100] as const).map(pct => (
              <button
                key={pct}
                style={btnStyle()}
                disabled={sell.loading}
                onMouseEnter={() => fetchQuote(pct)}
                onClick={() => executeSell(pct)}
              >
                {sell.loading ? '…' : `${pct}%`}
              </button>
            ))}
          </div>

          {/* Fix 2: quote preview */}
          {sell.quote && sell.quotePct && (
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.64rem', color: '#5c6472' }}>
              {sell.quotePct}% ≈ <span style={{ color: '#d4ff00' }}>{sell.quote}</span>
            </p>
          )}

          {sell.error && (
            <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '7px 10px' }}>
              <p style={{ fontSize: '0.72rem', color: '#f87171', fontFamily: 'JetBrains Mono, monospace' }}>{sell.error}</p>
            </div>
          )}

          {sell.txHash && (
            <a
              href={`https://solscan.io/tx/${sell.txHash}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 8, background: 'rgba(212,255,0,0.06)', border: '1px solid rgba(212,255,0,0.2)', color: '#d4ff00', textDecoration: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.66rem' }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5L4 7.5L8.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              Sold — {sell.txHash.slice(0, 18)}… ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}



export default function WalletPanel({ userId, pendingTxs = [] }: { userId: string; pendingTxs?: PendingTxInfo[] }) {
  const {
    wallet, loading, creating, error,
    createWallet, refreshBalance,
    withdrawSOL, withdrawing, withdrawError, withdrawTx,
  } = useWallet(userId);

  const prevBalanceRef = useRef<number | null>(null);
  const [copied,       setCopied]       = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [destAddr,     setDestAddr]     = useState('');
  const [withdrawAmt,  setWithdrawAmt]  = useState('');
  const [addrError,    setAddrError]    = useState<string | null>(null);
  const [amtError,     setAmtError]     = useState<string | null>(null);

  const prevBalance = prevBalanceRef.current;
  useEffect(() => {
    if (wallet?.balanceSol !== undefined) {
      setTimeout(() => { prevBalanceRef.current = wallet.balanceSol ?? null; }, 1500);
    }
  }, [wallet?.balanceSol]);

  const copy = async () => {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const validateWithdraw = () => {
    setAddrError(null); setAmtError(null);
    const amt = parseFloat(withdrawAmt);
    let ok = true;
    if (!destAddr || destAddr.length < 32) { setAddrError('Enter a valid Solana address'); ok = false; }
    if (!withdrawAmt || isNaN(amt) || amt <= 0) { setAmtError('Enter an amount greater than 0'); ok = false; }
    else if (wallet?.balanceSol !== null && amt > (wallet?.balanceSol ?? 0) - 0.005) {
      setAmtError(`Max ~${Math.max(0, (wallet?.balanceSol ?? 0) - 0.005).toFixed(4)} SOL (reserve 0.005 for fees)`);
      ok = false;
    }
    if (ok) withdrawSOL(destAddr, amt);
  };

  const CARD: React.CSSProperties = {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14,
    overflow: 'hidden',
  };

  if (loading && !wallet) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
        <style>{`@keyframes wp-pulse{0%,100%{opacity:0.3}50%{opacity:0.7}}`}</style>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[120, 80, 200].map((h, i) => (
            <div key={i} style={{ height: h, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', animation: `wp-pulse 1.6s ${i * 0.15}s ease-in-out infinite` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontFamily: 'DM Sans,system-ui,sans-serif' }}>
      <style>{`
        .wp-scroll::-webkit-scrollbar { width: 3px; }
        .wp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        @keyframes wp-delta { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        @keyframes wp-fadein { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        .wp-input:focus { border-color: rgba(255,255,255,0.2) !important; }
      `}</style>
      <div className="wp-scroll" style={{ maxWidth: 560, margin: '0 auto', padding: '24px 20px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {error && (
          <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: '0.75rem', color: '#f87171', fontFamily: 'JetBrains Mono, monospace' }}>{error}</p>
          </div>
        )}

        {!wallet ? (
        
          <div style={{ ...CARD, padding: '32px 24px', textAlign: 'center', animation: 'wp-fadein 0.3s ease-out both' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(212,255,0,0.06)', border: '1px solid rgba(212,255,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="5" width="18" height="13" rx="2" stroke="#d4ff00" strokeWidth="1.4" opacity="0.6"/>
                <path d="M2 9H20" stroke="#d4ff00" strokeWidth="1.4" opacity="0.4"/>
                <circle cx="16" cy="13.5" r="1.5" fill="#d4ff00" opacity="0.5"/>
              </svg>
            </div>
            <p style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '1.3rem', letterSpacing: '0.08em', color: '#e8ecf0', marginBottom: 8 }}>No Trading Wallet</p>
            <p style={{ fontSize: '0.78rem', color: '#5c6472', lineHeight: 1.6, marginBottom: 22 }}>
              Create a dedicated wallet to fund and automate trades on Solana.
            </p>
            <button
              onClick={createWallet}
              disabled={creating}
              style={{ padding: '10px 28px', borderRadius: 10, border: '1px solid rgba(212,255,0,0.3)', background: 'rgba(212,255,0,0.08)', color: creating ? '#3d4452' : '#d4ff00', fontSize: '0.82rem', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif', transition: 'all 0.2s' }}
            >
              {creating ? 'Creating…' : 'Create Trading Wallet'}
            </button>
          </div>
        ) : (
          <>
          
            <div style={{ ...CARD, padding: '20px 20px 18px', animation: 'wp-fadein 0.3s ease-out both' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', color: '#2e3540', textTransform: 'uppercase' as const, marginBottom: 10 }}>
                    TRADING BALANCE
                  </p>
                  <BalanceNumber value={wallet.balanceSol} prevValue={prevBalance} />
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button
                    onClick={refreshBalance}
                    style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#3d4452', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#8a939f'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#3d4452'; }}
                    title="Refresh balance"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6C2 3.8 3.8 2 6 2C7.5 2 8.8 2.8 9.5 4M10 6C10 8.2 8.2 10 6 10C4.5 10 3.2 9.2 2.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M9 1.5V4.5H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" transform="translate(-3,0)"/></svg>
                  </button>
                  {wallet.balanceSol !== null && (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7,
                      background: wallet.balanceSol >= 0.05 ? 'rgba(212,255,0,0.07)' : 'rgba(251,191,36,0.07)',
                      border: `1px solid ${wallet.balanceSol >= 0.05 ? 'rgba(212,255,0,0.2)' : 'rgba(251,191,36,0.2)'}`,
                      fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em',
                      color: wallet.balanceSol >= 0.05 ? '#d4ff00' : '#fbbf24',
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                      {wallet.balanceSol >= 0.05 ? 'READY' : 'LOW'}
                    </span>
                  )}
                </div>
              </div>

              {wallet.balanceSol !== null && wallet.balanceSol < 0.005 && (
                <div style={{ padding: '8px 12px', borderRadius: 9, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <span style={{ color: '#fbbf24', fontSize: '0.8rem' }}>⚠</span>
                  <p style={{ fontSize: '0.72rem', color: 'rgba(251,191,36,0.8)' }}>
                    Balance too low for trades. Fund this wallet to enable automation.
                  </p>
                </div>
              )}

             
              {wallet.tokens.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', color: '#2e3540', textTransform: 'uppercase' as const, marginBottom: 10 }}>
                    Token Holdings
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {wallet.tokens.map(t => (
                      <TokenRow
                        key={t.mint}
                        mint={t.mint}
                        symbol={t.symbol}
                        balance={t.balance}
                        decimals={t.decimals}
                        userId={userId}
                        onSellSuccess={refreshBalance}
                      />
                    ))}
                  </div>
                </div>
              )}

            
              {pendingTxs.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', color: '#fbbf24', textTransform: 'uppercase' as const, marginBottom: 8 }}>
                    Pending Transactions
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {pendingTxs.map(tx => (
                      <a
                        key={tx.txHash}
                        href={`https://solscan.io/tx/${tx.txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)', textDecoration: 'none' }}
                      >
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#5c6472' }}>
                          {tx.txHash.slice(0, 16)}…
                        </span>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.06em' }}>
                          PENDING
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

             
              <div style={{ marginTop: 18 }}>
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', color: '#2e3540', textTransform: 'uppercase' as const, marginBottom: 8 }}>
                  Wallet Address
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <code style={{ flex: 1, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem', color: '#5c6472', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    {wallet.publicKey}
                  </code>
                  <button onClick={copy} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 8, background: copied ? 'rgba(212,255,0,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${copied ? 'rgba(212,255,0,0.3)' : 'rgba(255,255,255,0.08)'}`, color: copied ? '#d4ff00' : '#3d4452', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                    {copied
                      ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="3.5" y="1" width="7" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><rect x="1.5" y="2.5" width="7" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/></svg>
                    }
                  </button>
                </div>
              </div>
            </div>

            
            <div style={CARD}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px' }}>
                <div>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#c4ccd6', marginBottom: 2 }}>Withdraw SOL</p>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#2e3540' }}>Send funds to any Solana wallet</p>
                </div>
                <button
                  onClick={() => { setShowWithdraw(v => !v); setAddrError(null); setAmtError(null); }}
                  style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: '#5c6472', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'DM Sans, sans-serif', transition: 'all 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e8ecf0'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.16)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#5c6472'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)'; }}
                >
                  {showWithdraw ? 'Cancel' : 'Withdraw →'}
                </button>
              </div>

              {showWithdraw && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', color: '#2e3540', textTransform: 'uppercase' as const, display: 'block', marginBottom: 6 }}>Destination</label>
                    <input className="wp-input" placeholder="Solana wallet address" value={destAddr} onChange={e => { setDestAddr(e.target.value); setAddrError(null); }} style={INP_MONO} />
                    {addrError && <p style={{ fontSize: '0.68rem', color: '#f87171', marginTop: 4 }}>{addrError}</p>}
                  </div>
                  <div>
                    <label style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', color: '#2e3540', textTransform: 'uppercase' as const, display: 'block', marginBottom: 6 }}>Amount (SOL)</label>
                    <input className="wp-input" type="number" min={0.001} step={0.001} placeholder="0.1" value={withdrawAmt} onChange={e => { setWithdrawAmt(e.target.value); setAmtError(null); }} style={INP} />
                    {amtError && <p style={{ fontSize: '0.68rem', color: '#f87171', marginTop: 4 }}>{amtError}</p>}
                  </div>

                  {withdrawError && (
                    <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '7px 10px' }}>
                      <p style={{ fontSize: '0.72rem', color: '#f87171' }}>{withdrawError}</p>
                    </div>
                  )}
                  {withdrawTx && (
                    <a href={`https://solscan.io/tx/${withdrawTx}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 8, background: 'rgba(212,255,0,0.06)', border: '1px solid rgba(212,255,0,0.2)', color: '#d4ff00', textDecoration: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      Sent — {withdrawTx.slice(0, 20)}… ↗
                    </a>
                  )}

                  <button onClick={validateWithdraw} disabled={withdrawing}
                    style={{ height: 40, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: withdrawing ? '#3d4452' : '#c4ccd6', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'DM Sans, sans-serif', transition: 'all 0.2s', opacity: withdrawing ? 0.5 : 1 }}>
                    {withdrawing ? 'Sending…' : 'Confirm Withdrawal'}
                  </button>
                </div>
              )}
            </div>

            
            <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 11, padding: '14px 16px' }}>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', color: '#2e3540', textTransform: 'uppercase' as const, marginBottom: 11 }}>How to fund</p>
              <ol style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  'Copy your wallet address above',
                  'Send SOL from Phantom, Backpack, or any Solana wallet',
                  'Minimum: trade amount + 0.005 SOL for network fees',
                  'Trades execute automatically when your conditions fire',
                ].map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, fontSize: '0.72rem', color: '#3d4452', lineHeight: 1.5 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', color: '#2e3540', flexShrink: 0 }}>{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div style={{ textAlign: 'center' }}>
              <a href={`https://solscan.io/account/${wallet.publicKey}`} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: '#2e3540', textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#5c6472')}
                onMouseLeave={e => (e.currentTarget.style.color = '#2e3540')}>
                View on Solscan ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
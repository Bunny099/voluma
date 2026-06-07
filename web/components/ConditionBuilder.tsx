'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { nanoid }    from 'nanoid';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { type Condition, type ConditionWithStats, type ExecutionAction } from '../conditions/types';
import { authClient } from '@/lib/auth-client';

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface KnownToken { symbol: string; mint: string; }
const KNOWN_TOKENS: KnownToken[] = [
  { symbol: 'SOL',  mint: 'So11111111111111111111111111111111111111112'  },
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'JUP',  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'  },
];

const TRIGGER_TYPES = {
  WALLET_ACTIVITY: { label: 'Wallet Activity',  icon: '◉', color: '#a78bfa', dim: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)', desc: 'Watch a wallet for on-chain activity' },
  SWAP_BURST:      { label: 'Swap Burst',        icon: '⚡', color: '#fbbf24', dim: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)',  desc: 'Detect rapid swap momentum' },
  TOKEN_VOLUME:    { label: 'Volume Spike',       icon: '◈', color: '#22d3ee', dim: 'rgba(34,211,238,0.12)',  border: 'rgba(34,211,238,0.3)',  desc: 'Track token volume threshold' },
  LARGE_TRANSFER:  { label: 'Large Transfer',     icon: '⟳', color: '#f87171', dim: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', desc: 'Catch whale SOL movements' },
};

const ACTION_TYPES = {
  NOTIFY:  { label: 'Push Notify',  icon: '◉', color: '#a78bfa', dim: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)', desc: 'Real-time push to dashboard' },
  WEBHOOK: { label: 'Webhook',      icon: '⤷', color: '#38bdf8', dim: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.25)',  desc: 'POST to your HTTP endpoint' },
  LOG:     { label: 'Server Log',   icon: '≡', color: '#6b7280', dim: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.25)', desc: 'Write to server logs' },
  TRADE:   { label: 'Auto Trade',   icon: '◎', color: '#d4ff00', dim: 'rgba(212,255,0,0.1)',   border: 'rgba(212,255,0,0.3)',   desc: 'Execute via Jupiter DEX' },
};

const BASE58_RE = /^[A-HJ-NP-Za-km-z1-9]{32,44}$/;
function isValidMint(mint: string) { return BASE58_RE.test(mint); }
const FEE_BUFFER = 0.005;

function buildDefault(): Partial<Condition> {
  return {
    id: nanoid(), type: 'WALLET_ACTIVITY', enabled: true,
    cooldownSeconds: 60, transactionType: 'ANY',
    actions: [{ type: 'NOTIFY' }], createdAt: Date.now(),
    allowRepeatedExecution: false,
  };
}

type ExecMode    = 'once' | 'limited' | 'unlimited';
type ActivePanel = 'trigger' | 'action' | null;
interface WebhookResult { success: boolean; statusCode?: number; durationMs: number; error?: string; }
interface WalletState   { exists: boolean; balanceSol: number | null; }

const INP: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8, color: '#e8ecf0', fontSize: '0.82rem', fontFamily: 'DM Sans, sans-serif',
  height: 38, padding: '0 10px', width: '100%', outline: 'none', transition: 'border-color 0.15s',
};
const INP_MONO: React.CSSProperties = { ...INP, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem' };
const LBL: React.CSSProperties = {
  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const,
  color: '#4a5260', fontFamily: 'JetBrains Mono, monospace', display: 'block', marginBottom: 6,
};

function triggerPreview(form: Partial<Condition>): string[] {
  const lines: string[] = [];
  switch (form.type) {
    case 'WALLET_ACTIVITY':
      if (form.wallet) lines.push(`wallet: ${form.wallet.slice(0,8)}...`);
      if (form.transactionType && form.transactionType !== 'ANY') lines.push(`type: ${form.transactionType}`);
      if (form.minAmountSol) lines.push(`min: ${form.minAmountSol} SOL`);
      break;
    case 'SWAP_BURST':
      if (form.tokenMint) lines.push(`token: ${form.tokenMint.slice(0,8)}...`);
      if (form.minSwaps) lines.push(`${form.minSwaps} swaps`);
      if (form.windowSeconds) lines.push(`${form.windowSeconds}s window`);
      break;
    case 'TOKEN_VOLUME':
      if (form.tokenMint) lines.push(`token: ${form.tokenMint.slice(0,8)}...`);
      if (form.minVolumeSol) lines.push(`≥${form.minVolumeSol} SOL`);
      if (form.windowSeconds) lines.push(`${form.windowSeconds}s`);
      break;
    case 'LARGE_TRANSFER':
      if (form.minSol) lines.push(`≥${form.minSol} SOL`);
      else lines.push('global watch');
      break;
  }
  return lines;
}

function actionPreview(action: ExecutionAction | undefined): string[] {
  if (!action) return [];
  const lines: string[] = [];
  switch (action.type) {
    case 'TRADE':
      if (action.tradeDirection) lines.push(action.tradeDirection);
      if (action.tradeDirection === 'BUY' && action.tradeAmountSol) lines.push(`${action.tradeAmountSol} SOL`);
      if (action.tradeDirection === 'SELL' && action.tradeSellPercent) lines.push(`${action.tradeSellPercent}% of balance`);
      if (action.tradeTokenMint) lines.push(action.tradeTokenMint.slice(0,8)+'...');
      break;
    case 'WEBHOOK':
      if (action.webhookUrl) { try { lines.push(new URL(action.webhookUrl).hostname); } catch { lines.push('endpoint set'); } }
      break;
    case 'NOTIFY': lines.push('dashboard push'); break;
    case 'LOG':    lines.push('server log');    break;
  }
  return lines;
}

function NodeConnector({ active, color }: { active: boolean; color: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', flexShrink:0, gap:0, padding:'0 4px' }}>
      <svg width="72" height="24" viewBox="0 0 72 24" fill="none" style={{ overflow:'visible' }}>
        <defs>
          <linearGradient id="conn-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <line x1="0" y1="12" x2="60" y2="12" stroke={active ? `url(#conn-grad)` : 'rgba(255,255,255,0.08)'} strokeWidth={active ? 1.5 : 1} strokeDasharray={active ? 'none' : '4 4'} />
        <polygon points="60,8 68,12 60,16" fill={active ? color : 'rgba(255,255,255,0.15)'} opacity={active ? 0.8 : 0.5} />
        {active && (
          <circle r="3" fill={color} opacity="0.9">
            <animateMotion dur="1.2s" repeatCount="indefinite" path="M 0 12 L 60 12" />
          </circle>
        )}
      </svg>
    </div>
  );
}

interface NodeCardProps {
  label: string; sublabel: string; icon: string; color: string; dim: string; border: string;
  preview: string[]; isSelected: boolean; isConfigured: boolean; nodeType: 'trigger' | 'action';
  onClick: () => void;
}

function NodeCard({ label, sublabel, icon, color, dim, border, preview, isSelected, isConfigured, nodeType, onClick }: NodeCardProps) {
  const [hovered, setHovered] = useState(false);
  const isActive = isSelected || hovered;
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        flex:1, minWidth:0, background: isSelected ? dim : hovered ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.015)',
        border:`1.5px solid ${isSelected ? border : isConfigured ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius:14, padding:'16px 16px 14px', cursor:'pointer', transition:'all 0.2s',
        position:'relative', overflow:'hidden',
        boxShadow: isSelected ? `0 0 20px ${color}18, 0 0 40px ${color}08` : 'none',
      }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background: isSelected ? `linear-gradient(90deg, transparent, ${color}, transparent)` : isConfigured ? `linear-gradient(90deg, transparent, ${color}40, transparent)` : 'transparent', transition:'all 0.3s' }} />
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase' as const, color: isActive ? color : '#5a6b7e', background: isActive ? `${color}14` : 'rgba(255,255,255,0.04)', border:`1px solid ${isActive ? `${color}30` : 'rgba(255,255,255,0.06)'}`, padding:'2px 7px', borderRadius:4, transition:'all 0.2s' }}>
          {nodeType === 'trigger' ? 'WHEN' : 'THEN'}
        </span>
        {isConfigured && <div style={{ width:6, height:6, borderRadius:'50%', background: isSelected ? color : 'rgba(255,255,255,0.2)', transition:'all 0.2s' }} />}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <div style={{ width:36, height:36, borderRadius:10, background: isActive ? `${color}18` : 'rgba(255,255,255,0.04)', border:`1px solid ${isActive ? `${color}30` : 'rgba(255,255,255,0.08)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', transition:'all 0.2s', flexShrink:0 }}>
          <span style={{ color: isActive ? color : '#5c6472' }}>{icon}</span>
        </div>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:'0.85rem', fontWeight:700, color: isActive ? '#e8ecf0' : '#8a939f', marginBottom:1, transition:'color 0.2s' }}>{label}</div>
          <div style={{ fontSize:'0.68rem', color:'#5a6b7e', fontFamily:'JetBrains Mono, monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sublabel}</div>
        </div>
      </div>
      {preview.length > 0 ? (
        <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:8, padding:'6px 9px', display:'flex', flexDirection:'column', gap:2 }}>
          {preview.slice(0,3).map((p,i) => (
            <div key={i} style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#5c6472', display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ color:`${color}60`, fontSize:'0.5rem' }}>▸</span>{p}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background:'rgba(255,255,255,0.02)', border:`1px dashed ${isActive ? `${color}30` : 'rgba(255,255,255,0.07)'}`, borderRadius:8, padding:'6px 9px', fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', color:'#506070', textAlign:'center', transition:'all 0.2s' }}>
          click to configure
        </div>
      )}
      {isSelected && <div style={{ position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)', width:0, height:0, borderLeft:'8px solid transparent', borderRight:'8px solid transparent', borderBottom:`8px solid ${color}40` }} />}
    </div>
  );
}

function ConfigPanel({ children, color, label, visible }: { children: React.ReactNode; color: string; label: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible && ref.current) ref.current.style.maxHeight = ref.current.scrollHeight + 64 + 'px';
    else if (ref.current) ref.current.style.maxHeight = '0px';
  }, [visible, children]);
  return (
    <div ref={ref} style={{ maxHeight:0, overflow:'hidden', transition:'max-height 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
      <div style={{ marginTop:8, background:'rgba(255,255,255,0.015)', border:`1px solid ${color}25`, borderRadius:14, overflow:'hidden' }}>
        <div style={{ padding:'10px 16px', background:`linear-gradient(90deg, ${color}10, transparent)`, borderBottom:`1px solid ${color}18`, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:4, height:16, borderRadius:2, background:color, opacity:0.7 }} />
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.12em', color, textTransform:'uppercase' as const }}>{label} Configuration</span>
        </div>
        <div style={{ padding:16 }}>{children}</div>
      </div>
    </div>
  );
}

interface Props { userId: string; onCreated?: (c: ConditionWithStats) => void; }

export default function ConditionBuilder({ userId, onCreated }: Props) {
  // Get auth token for authenticated API calls
  const { data: sessionData } = authClient.useSession();
  const authToken = sessionData?.session?.token ?? '';

  const [form,        setForm]       = useState<Partial<Condition>>(() => buildDefault());
  const [saving,      setSaving]     = useState(false);
  const [error,       setError]      = useState<string | null>(null);
  const [saved,       setSaved]      = useState(false);
  const [testingHook, setTestingHook] = useState(false);
  const [hookResult,  setHookResult] = useState<WebhookResult | null>(null);
  const [mintError,   setMintError]  = useState<string | null>(null);
  const [execMode,    setExecMode]   = useState<ExecMode>('once');
  const [walletState,    setWalletState]    = useState<WalletState | null>(null);
  const [walletChecking, setWalletChecking] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>('trigger');

  const currentAction = form.actions?.[0] as ExecutionAction | undefined;
  const isTradeAction = currentAction?.type === 'TRADE';
  const isBuy  = currentAction?.tradeDirection === 'BUY';
  const isSell = currentAction?.tradeDirection === 'SELL';
  const tradeAmountSol = currentAction?.tradeAmountSol ?? 0;
  const requiredSol    = tradeAmountSol + FEE_BUFFER;
  const walletMissing  = isTradeAction && walletState !== null && !walletState.exists;
  const balanceInsufficient = isTradeAction && isBuy && walletState?.exists === true && walletState.balanceSol !== null && tradeAmountSol > 0 && walletState.balanceSol < requiredSol;

  const triggerCfg = TRIGGER_TYPES[form.type ?? 'WALLET_ACTIVITY'];
  const actionCfg  = ACTION_TYPES[currentAction?.type ?? 'NOTIFY'];
  const isConnected = !!(form.type && currentAction?.type);

  // Wallet existence check when TRADE action is selected
  useEffect(() => {
    if (!isTradeAction || !userId || !authToken) { setWalletState(null); return; }
    let cancelled = false;
    setWalletChecking(true);
    fetch(`${BASE()}/wallet/${userId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        setWalletState(!data ? { exists: false, balanceSol: null } : { exists: true, balanceSol: data.balanceSol ?? null });
      })
      .catch(() => { if (!cancelled) setWalletState({ exists: false, balanceSol: null }); })
      .finally(() => { if (!cancelled) setWalletChecking(false); });
    return () => { cancelled = true; };
  }, [isTradeAction, userId, authToken]);

  const set = useCallback(<K extends keyof Condition>(k: K, v: Condition[K]) =>
    setForm(prev => ({ ...prev, [k]: v })), []);

  const setAction = useCallback((update: Partial<ExecutionAction>) =>
    setForm(prev => ({
      ...prev,
      actions: [{ ...(prev.actions?.[0] as ExecutionAction | undefined), ...update } as ExecutionAction],
    })), []);

  const setTradeMint = useCallback((mint: string) => {
    setMintError(null);
    if (mint && !isValidMint(mint)) setMintError('Invalid mint — base58, 32–44 chars');
    setAction({ tradeTokenMint: mint || undefined });
  }, [setAction]);

  const applyExecMode = useCallback((mode: ExecMode) => {
    setExecMode(mode);
    if (mode === 'once')           setForm(p => ({ ...p, allowRepeatedExecution: false, maxExecutions: undefined }));
    else if (mode === 'unlimited') setForm(p => ({ ...p, allowRepeatedExecution: true,  maxExecutions: undefined }));
    else                           setForm(p => ({ ...p, allowRepeatedExecution: true }));
  }, []);

  const reset = useCallback(() => {
    setForm(buildDefault()); setExecMode('once'); setActivePanel('trigger');
    setMintError(null); setHookResult(null); setError(null); setWalletState(null);
  }, []);

  const handleNodeClick = (panel: ActivePanel) => setActivePanel(prev => prev === panel ? null : panel);

  const handleSubmit = async () => {
    setError(null);
    if (!authToken) { setError('Not authenticated — please sign in again'); return; }
    if (!form.name?.trim()) { setError('Give this automation a name'); setActivePanel(null); return; }
    if (form.type === 'WALLET_ACTIVITY' && !form.wallet?.trim()) { setError('A wallet address is required for Wallet Activity conditions'); setActivePanel('trigger'); return; }
    if (execMode === 'limited' && !form.maxExecutions) { setError('Enter a max execution count for Limited mode'); setActivePanel('action'); return; }
    if (isTradeAction) {
      if (walletMissing) { setError('Create a trading wallet first — go to the Wallet tab.'); return; }
      if (!currentAction?.tradeTokenMint)             { setError('Select or enter a token mint'); setActivePanel('action'); return; }
      if (!isValidMint(currentAction.tradeTokenMint)) { setError('Invalid token mint address'); setActivePanel('action'); return; }
      if (!currentAction.tradeDirection)              { setError('Select BUY or SELL direction'); setActivePanel('action'); return; }
      if (isBuy && (!currentAction.tradeAmountSol || tradeAmountSol <= 0)) { setError('Enter the SOL amount to spend'); setActivePanel('action'); return; }
      if (isSell) { const pct = currentAction.tradeSellPercent; if (!pct || pct <= 0 || pct > 100) { setError('Enter a sell percentage between 1 and 100'); setActivePanel('action'); return; } }
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE()}/conditions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ ...form, userId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error ?? data, null, 2)); return; }
      onCreated?.({ ...(form as Condition), id: data.id, userId, triggerCount: 0, lastTriggered: null, executionCount: 0 });
      reset(); setSaved(true); setTimeout(() => setSaved(false), 2_500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestHook = async () => {
    const url = currentAction?.webhookUrl;
    if (!url || !authToken) return;
    setTestingHook(true); setHookResult(null);
    try {
      const res = await fetch(`${BASE()}/webhook/test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ url }),
      });
      setHookResult(await res.json() as WebhookResult);
    } catch (err) {
      setHookResult({ success: false, durationMs: 0, error: err instanceof Error ? err.message : 'Network error' });
    } finally { setTestingHook(false); }
  };

  const tPreview = triggerPreview(form);
  const aPreview = actionPreview(currentAction);
  const canSubmit = !saving && !!form.name?.trim() && !mintError && !walletMissing && (execMode !== 'limited' || !!form.maxExecutions);
  const triggerIsConfigured = tPreview.length > 0 || !!form.type;
  const actionIsConfigured  = aPreview.length > 0 || !!currentAction?.type;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
      <style>{`
        .cb2-input:focus { border-color: rgba(212,255,0,0.4) !important; box-shadow: 0 0 0 2px rgba(212,255,0,0.06) !important; }
        .cb2-input::placeholder { color: #506070; }
        .cb2-name:focus { border-color: rgba(212,255,0,0.3) !important; outline: none; }
        .cb2-name::placeholder { color: #506070; }
        .cb2-select-trigger { background: rgba(255,255,255,0.04) !important; border-color: rgba(255,255,255,0.1) !important; color: #e8ecf0 !important; height: 38px !important; border-radius: 8px !important; }
        .cb2-type-btn { transition: all 0.15s !important; }
        .cb2-seg-btn { flex:1; padding:7px; font-size:0.75rem; font-weight:600; border-radius:7px; cursor:pointer; border:none; transition:all 0.15s; font-family:'DM Sans',sans-serif; }
        .cb2-tok-btn { padding:6px 8px; font-family:'JetBrains Mono',monospace; font-size:0.68rem; font-weight:600; border-radius:7px; cursor:pointer; border:1px solid; transition:all 0.15s; }
        @keyframes cb2-success { 0%{transform:scale(1)} 30%{transform:scale(1.03)} 100%{transform:scale(1)} }
        .cb2-success { animation: cb2-success 0.4s ease-out; }
      `}</style>

      {/* Automation name + cooldown */}
      <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:'12px 14px', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em', color:'#5a6b7e', textTransform:'uppercase' as const, flexShrink:0, whiteSpace:'nowrap' }}>AUTOMATION</span>
          <input className="cb2-name" placeholder="e.g. BONK whale alert, USDC volume spike..." value={form.name ?? ''} onChange={e => set('name', e.target.value)}
            style={{ flex:1, background:'transparent', border:'1px solid transparent', borderRadius:8, color:'#e8ecf0', fontSize:'0.9rem', fontWeight:600, fontFamily:'DM Sans, sans-serif', padding:'4px 8px', outline:'none', transition:'border-color 0.15s' }} />
          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', color:'#506070', whiteSpace:'nowrap' }}>cd</span>
            <input className="cb2-input" type="number" min={0} value={form.cooldownSeconds ?? 60} onChange={e => set('cooldownSeconds', Number(e.target.value))}
              style={{ ...INP, fontFamily:'JetBrains Mono, monospace', fontSize:'0.72rem', width:56, textAlign:'center', height:32 }} />
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.6rem', color:'#506070' }}>s</span>
          </div>
        </div>
      </div>

      {/* Pipeline nodes */}
      <div style={{ display:'flex', alignItems:'stretch', gap:0, marginBottom:10 }}>
        <NodeCard label={triggerCfg.label} sublabel={triggerCfg.desc} icon={triggerCfg.icon} color={triggerCfg.color} dim={triggerCfg.dim} border={triggerCfg.border} preview={tPreview} isSelected={activePanel==='trigger'} isConfigured={triggerIsConfigured} nodeType="trigger" onClick={() => handleNodeClick('trigger')} />
        <NodeConnector active={isConnected} color={triggerCfg.color} />
        <NodeCard label={actionCfg.label} sublabel={actionCfg.desc} icon={actionCfg.icon} color={actionCfg.color} dim={actionCfg.dim} border={actionCfg.border} preview={aPreview} isSelected={activePanel==='action'} isConfigured={actionIsConfigured} nodeType="action" onClick={() => handleNodeClick('action')} />
      </div>

      {/* Trigger config panel */}
      <ConfigPanel color={triggerCfg.color} label={triggerCfg.label} visible={activePanel === 'trigger'}>
        <div style={{ marginBottom:14 }}>
          <label style={LBL}>Trigger type</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {Object.entries(TRIGGER_TYPES).map(([key, cfg]) => (
              <button key={key} className="cb2-type-btn" onClick={() => set('type', key as Condition['type'])}
                style={{ padding:'9px 11px', borderRadius:9, border:`1px solid ${form.type===key ? cfg.border : 'rgba(255,255,255,0.07)'}`, background: form.type===key ? cfg.dim : 'rgba(255,255,255,0.02)', color: form.type===key ? cfg.color : '#5c6472', cursor:'pointer', textAlign:'left', fontFamily:'DM Sans, sans-serif' }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                  <span style={{ fontSize:'0.85rem' }}>{cfg.icon}</span>
                  <span style={{ fontSize:'0.78rem', fontWeight:600 }}>{cfg.label}</span>
                </div>
                <div style={{ fontSize:'0.62rem', opacity:0.6, paddingLeft:22 }}>{cfg.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ borderTop:`1px solid ${triggerCfg.color}18`, marginBottom:14 }} />

        {form.type === 'WALLET_ACTIVITY' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div>
              <label style={LBL}>Wallet address</label>
              <input className="cb2-input" placeholder="7xKX...abc (required)" value={form.wallet ?? ''} onChange={e => set('wallet', e.target.value || undefined)} style={INP_MONO} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div>
                <label style={LBL}>Transaction type</label>
                <Select value={form.transactionType ?? 'ANY'} onValueChange={v => set('transactionType', v as Condition['transactionType'])}>
                  <SelectTrigger className="cb2-select-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent style={{ background:'#0d1520', border:'1px solid rgba(255,255,255,0.1)' }}>
                    {(['ANY','BUY','SELL','SWAP','TRANSFER'] as const).map(t => <SelectItem key={t} value={t} style={{ color:'#c4ccd6', fontSize:'0.8rem' }}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label style={LBL}>Min amount (SOL)</label>
                <input className="cb2-input" type="number" min={0.1} step={0.1} placeholder="0.1" value={form.minAmountSol ?? ''} onChange={e => set('minAmountSol', e.target.value ? Number(e.target.value) : undefined)} style={INP} />
              </div>
            </div>
          </div>
        )}

        {(form.type === 'SWAP_BURST' || form.type === 'TOKEN_VOLUME') && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div>
              <label style={LBL}>Token mint (blank = any token)</label>
              <input className="cb2-input" placeholder="So11...11112" value={form.tokenMint ?? ''} onChange={e => set('tokenMint', e.target.value || undefined)} style={INP_MONO} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div>
                <label style={LBL}>{form.type === 'SWAP_BURST' ? 'Min swaps' : 'Min volume (SOL)'}</label>
                <input className="cb2-input" type="number" min={1} placeholder={form.type === 'SWAP_BURST' ? '50' : '1000'}
                  value={form.type === 'SWAP_BURST' ? (form.minSwaps ?? '') : (form.minVolumeSol ?? '')}
                  onChange={e => form.type === 'SWAP_BURST' ? set('minSwaps', e.target.value ? Number(e.target.value) : undefined) : set('minVolumeSol', e.target.value ? Number(e.target.value) : undefined)}
                  style={INP} />
              </div>
              <div>
                <label style={LBL}>Window (seconds)</label>
                <input className="cb2-input" type="number" min={5} max={3600} placeholder="30" value={form.windowSeconds ?? ''} onChange={e => set('windowSeconds', e.target.value ? Number(e.target.value) : undefined)} style={INP} />
              </div>
            </div>
          </div>
        )}

        {form.type === 'LARGE_TRANSFER' && (
          <div>
            <label style={LBL}>Minimum transfer amount (SOL)</label>
            <input className="cb2-input" type="number" min={0.1} placeholder="100" value={form.minSol ?? ''} onChange={e => set('minSol', e.target.value ? Number(e.target.value) : undefined)} style={INP} />
            <p style={{ fontSize:'0.68rem', color:'#5a6b7e', marginTop:6 }}>Fires on any transfer exceeding this threshold on mainnet.</p>
          </div>
        )}

        <div style={{ marginTop:14, display:'flex', justifyContent:'flex-end' }}>
          <button onClick={() => setActivePanel('action')} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, background:`${triggerCfg.color}15`, border:`1px solid ${triggerCfg.color}35`, color:triggerCfg.color, fontSize:'0.75rem', fontWeight:700, fontFamily:'DM Sans, sans-serif', cursor:'pointer', transition:'all 0.15s' }}>
            Configure Action <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 6H9M9 6L6.5 3.5M9 6L6.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </ConfigPanel>

      {/* Action config panel */}
      <ConfigPanel color={actionCfg.color} label={actionCfg.label} visible={activePanel === 'action'}>
        <div style={{ marginBottom:14 }}>
          <label style={LBL}>Action type</label>
          <div style={{ display:'flex', gap:4, background:'rgba(255,255,255,0.04)', padding:4, borderRadius:10 }}>
            {Object.entries(ACTION_TYPES).map(([key, cfg]) => {
              const isAct = currentAction?.type === key;
              return (
                <button key={key} className="cb2-seg-btn"
                  onClick={() => { setHookResult(null); setMintError(null); setWalletState(null); setError(null); setForm(prev => ({ ...prev, actions: [{ type: key as ExecutionAction['type'] }] })); }}
                  style={{ background: isAct ? `${cfg.color}18` : 'transparent', color: isAct ? cfg.color : '#4a5260', border:`1px solid ${isAct ? `${cfg.color}35` : 'transparent'}` }}>
                  <span style={{ marginRight:4 }}>{cfg.icon}</span>{cfg.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ borderTop:`1px solid ${actionCfg.color}18`, marginBottom:14 }} />

        {currentAction?.type === 'WEBHOOK' && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', gap:6 }}>
              <input className="cb2-input" placeholder="https://your-server.com/webhook" value={currentAction.webhookUrl ?? ''} onChange={e => { setHookResult(null); setAction({ webhookUrl: e.target.value }); }} style={{ ...INP, flex:1 }} />
              <button onClick={handleTestHook} disabled={testingHook || !currentAction.webhookUrl}
                style={{ padding:'0 14px', borderRadius:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'#8a939f', fontSize:'0.75rem', fontWeight:600, cursor:'pointer', flexShrink:0, fontFamily:'DM Sans,sans-serif', opacity: testingHook || !currentAction.webhookUrl ? 0.5 : 1 }}>
                {testingHook ? '...' : 'Test'}
              </button>
            </div>
            {hookResult && (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:8, background: hookResult.success ? 'rgba(212,255,0,0.06)' : 'rgba(248,113,113,0.06)', border:`1px solid ${hookResult.success ? 'rgba(212,255,0,0.2)' : 'rgba(248,113,113,0.2)'}`, color: hookResult.success ? '#d4ff00' : '#f87171', fontSize:'0.75rem', fontFamily:'JetBrains Mono,monospace' }}>
                <span>{hookResult.success ? '✓' : '✗'}</span>
                <span>{hookResult.success ? `HTTP ${hookResult.statusCode ?? 200} · ${hookResult.durationMs}ms` : hookResult.error ?? `HTTP ${hookResult.statusCode}`}</span>
              </div>
            )}
          </div>
        )}

        {currentAction?.type === 'NOTIFY' && (
          <div style={{ padding:'12px 14px', borderRadius:10, background:'rgba(167,139,250,0.06)', border:'1px solid rgba(167,139,250,0.18)', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:'1.2rem' }}>◉</span>
            <div>
              <p style={{ fontSize:'0.82rem', fontWeight:600, color:'#a78bfa', marginBottom:2 }}>Real-time dashboard push</p>
              <p style={{ fontSize:'0.72rem', color:'rgba(167,139,250,0.6)' }}>Appears instantly in the Executions panel via WebSocket.</p>
            </div>
          </div>
        )}

        {currentAction?.type === 'LOG' && (
          <div style={{ padding:'12px 14px', borderRadius:10, background:'rgba(107,114,128,0.06)', border:'1px solid rgba(107,114,128,0.2)' }}>
            <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.72rem', color:'#5c6472' }}>Writes structured JSON to server stdout. No configuration needed.</p>
          </div>
        )}

        {currentAction?.type === 'TRADE' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {walletChecking && (
              <div style={{ padding:'8px 10px', background:'rgba(255,255,255,0.03)', borderRadius:8, display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:'#d4ff00', opacity:0.5 }} />
                <span style={{ fontSize:'0.72rem', color:'#5c6472', fontFamily:'JetBrains Mono, monospace' }}>Checking wallet...</span>
              </div>
            )}
            {!walletChecking && walletState?.exists === false && (
              <div style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.25)', borderRadius:9, padding:'10px 12px' }}>
                <p style={{ fontSize:'0.78rem', fontWeight:600, color:'#f87171', marginBottom:3 }}>No trading wallet found</p>
                <p style={{ fontSize:'0.72rem', color:'rgba(248,113,113,0.6)' }}>Go to the Wallet tab and create one first.</p>
              </div>
            )}
            {!walletChecking && walletState?.exists === true && (
              <div style={{ background: (isBuy && balanceInsufficient) ? 'rgba(251,191,36,0.07)' : 'rgba(212,255,0,0.05)', border:`1px solid ${(isBuy && balanceInsufficient) ? 'rgba(251,191,36,0.2)' : 'rgba(212,255,0,0.18)'}`, borderRadius:9, padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:'0.75rem', fontWeight:600, color: (isBuy && balanceInsufficient) ? '#fbbf24' : '#d4ff00' }}>{(isBuy && balanceInsufficient) ? '⚠ Low SOL balance' : '✓ Wallet ready'}</span>
                <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.72rem', color:'#c4ccd6' }}>◎ {(walletState.balanceSol ?? 0).toFixed(4)} SOL</span>
              </div>
            )}
            <div style={{ background:'rgba(251,191,36,0.06)', border:'1px solid rgba(251,191,36,0.15)', borderRadius:8, padding:'7px 10px' }}>
              <p style={{ fontSize:'0.7rem', color:'rgba(251,191,36,0.8)' }}>⚠ Real trades execute automatically. Verify settings before creating.</p>
            </div>
            <div>
              <label style={LBL}>Direction</label>
              <div style={{ display:'flex', gap:6 }}>
                {(['BUY','SELL'] as const).map(dir => (
                  <button key={dir} onClick={() => setAction({ tradeDirection: dir })}
                    style={{ flex:1, padding:'10px 0', borderRadius:9, border:'none', fontFamily:'DM Sans, sans-serif', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', transition:'all 0.15s',
                      background: currentAction.tradeDirection === dir ? (dir === 'BUY' ? '#d4ff00' : '#f87171') : 'rgba(255,255,255,0.04)',
                      color: currentAction.tradeDirection === dir ? (dir === 'BUY' ? '#070b10' : '#fff') : '#4a5260',
                      boxShadow: currentAction.tradeDirection === dir && dir === 'BUY' ? '0 4px 16px rgba(212,255,0,0.2)' : 'none' }}>
                    {dir === 'BUY' ? '↑ BUY' : '↓ SELL'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={LBL}>Token</label>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:5, marginBottom:7 }}>
                {KNOWN_TOKENS.map(t => {
                  const sel = currentAction.tradeTokenMint === t.mint;
                  return (
                    <button key={t.mint} className="cb2-tok-btn" onClick={() => setTradeMint(t.mint)}
                      style={{ background: sel ? 'rgba(212,255,0,0.1)' : 'rgba(255,255,255,0.03)', borderColor: sel ? 'rgba(212,255,0,0.35)' : 'rgba(255,255,255,0.08)', color: sel ? '#d4ff00' : '#5c6472' }}>
                      {t.symbol}
                    </button>
                  );
                })}
              </div>
              <input className="cb2-input" placeholder="Or paste token mint address..." value={currentAction.tradeTokenMint ?? ''} onChange={e => setTradeMint(e.target.value)} style={INP_MONO} />
              {mintError && <p style={{ fontSize:'0.7rem', color:'#f87171', marginTop:4 }}>{mintError}</p>}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div>
                {isSell ? (
                  <>
                    <label style={LBL}>Sell % of balance</label>
                    <input className="cb2-input" type="number" min={1} max={100} step={1} placeholder="e.g. 50" value={currentAction.tradeSellPercent ?? ''} onChange={e => setAction({ tradeSellPercent: e.target.value ? Math.min(100, Math.max(1, Number(e.target.value))) : undefined })} style={INP} />
                    <p style={{ fontSize:'0.65rem', color:'#5a6b7e', marginTop:4, fontFamily:'JetBrains Mono, monospace' }}>% of actual wallet token balance at execution time</p>
                  </>
                ) : (
                  <>
                    <label style={LBL}>SOL to spend</label>
                    <input className="cb2-input" type="number" min={0.001} max={100} step={0.01} placeholder="0.1" value={currentAction.tradeAmountSol ?? ''} onChange={e => setAction({ tradeAmountSol: e.target.value ? Number(e.target.value) : undefined })} style={INP} />
                  </>
                )}
              </div>
              <div>
                <label style={LBL}>Slippage (bps)</label>
                <input className="cb2-input" type="number" min={0} max={5000} step={10} placeholder="100" value={currentAction.tradeSlippageBps ?? ''} onChange={e => setAction({ tradeSlippageBps: e.target.value ? Number(e.target.value) : undefined })} style={INP} />
              </div>
            </div>
            <div>
              <label style={LBL}>Execution limit</label>
              <div style={{ display:'flex', gap:4, background:'rgba(255,255,255,0.04)', padding:4, borderRadius:9, marginBottom:8 }}>
                {([['once','Once'],['limited','Limited'],['unlimited','Unlimited']] as const).map(([mode,label]) => (
                  <button key={mode} className="cb2-seg-btn" onClick={() => applyExecMode(mode as ExecMode)}
                    style={{ background: execMode===mode ? 'rgba(255,255,255,0.09)' : 'transparent', color: execMode===mode ? '#e8ecf0' : '#4a5260', border:`1px solid ${execMode===mode ? 'rgba(255,255,255,0.14)' : 'transparent'}` }}>
                    {label}
                  </button>
                ))}
              </div>
              {execMode === 'limited' && <input className="cb2-input" type="number" min={1} placeholder="Max executions" value={form.maxExecutions ?? ''} onChange={e => set('maxExecutions', e.target.value ? Number(e.target.value) : undefined)} style={{ ...INP, marginBottom:6 }} />}
              <p style={{ fontSize:'0.68rem', color:'#5a6b7e' }}>
                {execMode === 'once' && 'Executes once then permanently deactivates.'}
                {execMode === 'limited' && 'Executes up to your specified limit.'}
                {execMode === 'unlimited' && 'Executes every time condition fires (cooldown applies).'}
              </p>
            </div>
          </div>
        )}
      </ConfigPanel>

      {error && (
        <div style={{ marginTop:12, background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.25)', borderRadius:9, padding:'10px 12px' }}>
          <p style={{ fontSize:'0.78rem', color:'#f87171', lineHeight:1.5 }}>{error}</p>
        </div>
      )}

      <button className={saved ? 'cb2-success' : ''} onClick={handleSubmit} disabled={!canSubmit}
        style={{ marginTop:16, width:'100%', height:46, borderRadius:12, border:'none', background: saved ? 'rgba(212,255,0,0.12)' : canSubmit ? '#d4ff00' : 'rgba(255,255,255,0.05)', color: saved ? '#d4ff00' : canSubmit ? '#070b10' : '#5a6b7e', fontSize:'0.85rem', fontWeight:700, letterSpacing:'0.04em', fontFamily:'DM Sans, sans-serif', cursor: canSubmit ? 'pointer' : 'not-allowed', transition:'all 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow: canSubmit && !saved ? '0 4px 24px rgba(212,255,0,0.2)' : 'none' }}>
        {saved ? (<><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>Automation Live</>)
          : saving ? (<><div style={{ width:14, height:14, borderRadius:'50%', border:'2px solid rgba(7,11,16,0.3)', borderTopColor:'#070b10', animation:'spin 0.8s linear infinite' }} />Creating...</>)
          : (<><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>Deploy Automation</>)}
      </button>
    </div>
  );
}

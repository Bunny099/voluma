'use client';
import { useState }  from 'react';
import { nanoid }    from 'nanoid';
import { Button }    from '@/components/ui/button';
import { Input }     from '@/components/ui/input';
import { Label }     from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { type Condition, type ConditionWithStats, type ExecutionAction } from '../conditions/types';

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TYPE_LABELS: Record<string, string> = {
  WALLET_ACTIVITY: 'Wallet activity',
  SWAP_BURST:      'Swap burst',
  TOKEN_VOLUME:    'Token volume spike',
  LARGE_TRANSFER:  'Large transfer',
};

const defaultForm = (): Partial<Condition> => ({
  id:              nanoid(),
  type:            'WALLET_ACTIVITY',
  enabled:         true,
  cooldownSeconds: 60,
  transactionType: 'ANY',
  actions:         [{ type: 'NOTIFY' }],
  createdAt:       Date.now(),
});

interface WebhookTestResult {
  success:     boolean;
  statusCode?: number;
  durationMs:  number;
  error?:      string;
}

interface Props {
  userId:     string;
  onCreated?: (cond: ConditionWithStats) => void;
}

export default function ConditionBuilder({ userId, onCreated }: Props) {
  const [form,           setForm]           = useState<Partial<Condition>>(defaultForm());
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [saved,          setSaved]          = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookResult,  setWebhookResult]  = useState<WebhookTestResult | null>(null);

  const set = <K extends keyof Condition>(k: K, v: Condition[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const currentAction = form.actions?.[0] as ExecutionAction | undefined;

  const setAction = (update: Partial<ExecutionAction>) => {
    set('actions', [{ ...currentAction, ...update } as ExecutionAction]);
  };

  // ── Submit ──────────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`${BASE()}/conditions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, userId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(JSON.stringify(data.error ?? data, null, 2)); return; }

      const optimistic: ConditionWithStats = {
        id:              data.id,
        userId,
        name:            form.name!,
        type:            form.type!,
        enabled:         form.enabled ?? true,
        wallet:          form.wallet,
        transactionType: form.transactionType,
        minAmountSol:    form.minAmountSol,
        tokenMint:       form.tokenMint,
        minSwaps:        form.minSwaps,
        minVolumeSol:    form.minVolumeSol,
        windowSeconds:   form.windowSeconds,
        minSol:          form.minSol,
        actions:         (form.actions ?? [{ type: 'NOTIFY' }]) as Condition['actions'],
        cooldownSeconds: form.cooldownSeconds ?? 60,
        createdAt:       form.createdAt ?? Date.now(),
        triggerCount:    0,
        lastTriggered:   null,
      };

      onCreated?.(optimistic);
      setSaved(true);
      setForm(defaultForm());
      setWebhookResult(null);
      setTimeout(() => setSaved(false), 2_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  // ── Test webhook ────────────────────────────────────────────────────────────────

  const handleTestWebhook = async () => {
    const url = currentAction?.webhookUrl;
    if (!url) return;
    setTestingWebhook(true);
    setWebhookResult(null);
    try {
      const res  = await fetch(`${BASE()}/webhook/test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      });
      setWebhookResult(await res.json() as WebhookTestResult);
    } catch (err) {
      setWebhookResult({ success: false, durationMs: 0, error: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3">
          <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Name</Label>
        <Input
          placeholder="My whale alert"
          value={form.name ?? ''}
          onChange={e => set('name', e.target.value)}
          className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm h-9"
        />
      </div>

      {/* Condition type */}
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Condition type</Label>
        <Select value={form.type} onValueChange={v => set('type', v as Condition['type'])}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-700">
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-zinc-200 text-sm">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* WALLET_ACTIVITY */}
      {form.type === 'WALLET_ACTIVITY' && (
        <div className="space-y-4 p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Wallet address</Label>
            <Input placeholder="7xKX…abc" value={form.wallet ?? ''}
              onChange={e => set('wallet', e.target.value)}
              className="bg-zinc-800 border-zinc-700 font-mono text-xs h-9 text-zinc-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Transaction type</Label>
              <Select value={form.transactionType ?? 'ANY'}
                onValueChange={v => set('transactionType', v as Condition['transactionType'])}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {(['ANY', 'BUY', 'SELL', 'TRANSFER'] as const).map(t => (
                    <SelectItem key={t} value={t} className="text-zinc-200 text-sm">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Min amount (SOL)</Label>
              <Input type="number" min={0} step={0.1} placeholder="0.1"
                value={form.minAmountSol ?? ''}
                onChange={e => set('minAmountSol', e.target.value ? Number(e.target.value) : undefined)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm h-9" />
            </div>
          </div>
        </div>
      )}

      {/* SWAP_BURST / TOKEN_VOLUME */}
      {(form.type === 'SWAP_BURST' || form.type === 'TOKEN_VOLUME') && (
        <div className="space-y-4 p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Token mint (blank = any)</Label>
            <Input placeholder="So11…11112" value={form.tokenMint ?? ''}
              onChange={e => set('tokenMint', e.target.value || undefined)}
              className="bg-zinc-800 border-zinc-700 font-mono text-xs h-9 text-zinc-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">
                {form.type === 'SWAP_BURST' ? 'Min swaps in window' : 'Min volume (SOL)'}
              </Label>
              <Input type="number" min={0}
                placeholder={form.type === 'SWAP_BURST' ? '50' : '10000'}
                value={form.type === 'SWAP_BURST' ? (form.minSwaps ?? '') : (form.minVolumeSol ?? '')}
                onChange={e => form.type === 'SWAP_BURST'
                  ? set('minSwaps',     e.target.value ? Number(e.target.value) : undefined)
                  : set('minVolumeSol', e.target.value ? Number(e.target.value) : undefined)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Window (seconds)</Label>
              <Input type="number" min={5} max={3600} placeholder="30"
                value={form.windowSeconds ?? ''}
                onChange={e => set('windowSeconds', e.target.value ? Number(e.target.value) : undefined)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm h-9" />
            </div>
          </div>
        </div>
      )}

      {/* LARGE_TRANSFER */}
      {form.type === 'LARGE_TRANSFER' && (
        <div className="p-4 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-1.5">
          <Label className="text-xs text-zinc-400">Minimum transfer (SOL)</Label>
          <Input type="number" min={0} placeholder="100"
            value={form.minSol ?? ''}
            onChange={e => set('minSol', e.target.value ? Number(e.target.value) : undefined)}
            className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm h-9" />
        </div>
      )}

      {/* Action type selector */}
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Action</Label>
        <Select
          value={currentAction?.type ?? 'NOTIFY'}
          onValueChange={v => {
            setWebhookResult(null);
            set('actions', [{ type: v as ExecutionAction['type'] }]);
          }}
        >
          <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-700">
            <SelectItem value="NOTIFY"  className="text-zinc-200 text-sm">Push notification</SelectItem>
            <SelectItem value="WEBHOOK" className="text-zinc-200 text-sm">HTTP webhook</SelectItem>
            <SelectItem value="LOG"     className="text-zinc-200 text-sm">Log only</SelectItem>
            <SelectItem value="TRADE"   className="text-zinc-200 text-sm">
              ◎ Automated trade (Jupiter)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* WEBHOOK config */}
      {currentAction?.type === 'WEBHOOK' && (
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">Webhook URL</Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://your-server.com/hook"
              value={currentAction?.webhookUrl ?? ''}
              onChange={e => setAction({ webhookUrl: e.target.value })}
              className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm h-9 flex-1"
            />
            <Button type="button" variant="outline" onClick={handleTestWebhook}
              disabled={testingWebhook || !currentAction?.webhookUrl}
              className="h-9 px-3 text-xs border-zinc-700 text-zinc-400 hover:text-zinc-200 shrink-0">
              {testingWebhook ? 'Sending…' : 'Test'}
            </Button>
          </div>
          {webhookResult && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${webhookResult.success ? 'bg-emerald-950/50 border-emerald-900/50 text-emerald-400' : 'bg-red-950/50 border-red-900/50 text-red-400'}`}>
              <span>{webhookResult.success ? '✓' : '✗'}</span>
              <span>
                {webhookResult.success
                  ? `Delivered — ${webhookResult.statusCode ?? 200} in ${webhookResult.durationMs}ms`
                  : `Failed — ${webhookResult.error ?? `HTTP ${webhookResult.statusCode}`}`
                }
              </span>
            </div>
          )}
        </div>
      )}

      {/* TRADE config */}
      {currentAction?.type === 'TRADE' && (
        <div className="space-y-4 p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
          {/* Direction toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Direction</Label>
            <div className="flex gap-1 bg-zinc-800 p-0.5 rounded-lg w-fit">
              {(['BUY', 'SELL'] as const).map(dir => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setAction({ tradeDirection: dir })}
                  className={`
                    px-4 py-1.5 text-xs font-medium rounded-md transition-colors
                    ${currentAction.tradeDirection === dir
                      ? dir === 'BUY'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-red-600    text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                    }
                  `}
                >
                  {dir === 'BUY' ? '↑ BUY' : '↓ SELL'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600">
              {currentAction.tradeDirection === 'BUY'
                ? 'Spend SOL to buy the specified token'
                : 'Sell the specified token, receive SOL'
              }
            </p>
          </div>

          {/* Token mint */}
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Token mint address</Label>
            <Input
              placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
              value={currentAction.tradeTokenMint ?? ''}
              onChange={e => setAction({ tradeTokenMint: e.target.value })}
              className="bg-zinc-800 border-zinc-700 font-mono text-xs h-9 text-zinc-100"
            />
          </div>

          {/* Amount + Slippage */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">
                {currentAction.tradeDirection === 'BUY' ? 'SOL to spend' : 'SOL to receive'}
              </Label>
              <Input
                type="number" min={0.001} max={100} step={0.01}
                placeholder="0.1"
                value={currentAction.tradeAmountSol ?? ''}
                onChange={e => setAction({ tradeAmountSol: e.target.value ? Number(e.target.value) : undefined })}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Slippage (bps)</Label>
              <Input
                type="number" min={0} max={5000} step={10}
                placeholder="100"
                value={currentAction.tradeSlippageBps ?? ''}
                onChange={e => setAction({ tradeSlippageBps: e.target.value ? Number(e.target.value) : undefined })}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 text-sm h-9"
              />
            </div>
          </div>

          {/* Info box */}
          <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Requires a funded trading wallet. Create one in the Wallet tab.
              Trades execute via Jupiter — execution is automatic and cannot be reversed.
            </p>
          </div>
        </div>
      )}

      {/* Cooldown */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-300">Cooldown</p>
          <p className="text-[11px] text-zinc-600">Seconds before condition can re-fire</p>
        </div>
        <Input type="number" min={0}
          value={form.cooldownSeconds ?? 60}
          onChange={e => set('cooldownSeconds', Number(e.target.value))}
          className="w-20 bg-zinc-900 border-zinc-700 text-zinc-100 text-sm h-8 text-right" />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={saving || !form.name?.trim()}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm h-9 font-medium"
      >
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Create automation'}
      </Button>
    </div>
  );
}
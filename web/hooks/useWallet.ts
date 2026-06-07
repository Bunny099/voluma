'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { authClient }                               from '@/lib/auth-client';

export interface TokenBalance {
  mint:     string;
  symbol:   string;
  balance:  number;
  decimals: number;
}

export interface WalletActivityLog {
  id: string;
  userId: string;
  walletPublicKey: string;
  actionType: 'WALLET_CREATED' | 'WALLET_EXPORT_REQUESTED' | 'WITHDRAWAL_EXECUTED' | 'TRADE_EXECUTED';
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface PendingWalletTx {
  txHash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  inputMint: string;
  outputMint: string;
  amountIn: number;
  createdAt: number;
  failureReason?: string | null;
}

export interface WalletSecurityInfo {
  encryptionVersion: number;
  supportsExport: boolean;
}

export interface WalletInfo {
  publicKey: string;
  balanceSol: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  tokens: TokenBalance[];
  pendingTxs: PendingWalletTx[];
  recentActivity: WalletActivityLog[];
  security: WalletSecurityInfo;
}

export interface SensitiveVerification {
  token: string;
  expiresAt: number;
}

export interface WalletExportPayload {
  publicKey: string;
  privateKeyBase58: string;
  secretKeyJson: string;
}

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';


type TradeSuccessCallback = (userId: string) => void;
const tradeSuccessListeners = new Set<TradeSuccessCallback>();

export function notifyTradeSuccess(userId: string): void {
  for (const cb of tradeSuccessListeners) cb(userId);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet(userId: string) {
  const { data: sessionData } = authClient.useSession();
  const token                 = sessionData?.session?.token ?? '';

  const [wallet,        setWallet]        = useState<WalletInfo | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [withdrawing,   setWithdrawing]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawTx,    setWithdrawTx]    = useState<string | null>(null);
  const [exporting,     setExporting]     = useState(false);
  const [exportError,   setExportError]   = useState<string | null>(null);

  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!userId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setWallet((await r.json()) as WalletInfo | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [userId, token]);

  const debouncedRefresh = useCallback(() => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    refreshDebounceRef.current = setTimeout(() => { fetchWallet(); }, 3_000);
  }, [fetchWallet]);

  // Subscribe to trade-success events so balance updates after every trade
  useEffect(() => {
    if (!userId) return;
    const listener: TradeSuccessCallback = (tradeUserId) => {
      if (tradeUserId === userId) debouncedRefresh();
    };
    tradeSuccessListeners.add(listener);
    return () => {
      tradeSuccessListeners.delete(listener);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, [userId, debouncedRefresh]);

  const createWallet = useCallback(async () => {
    if (!userId || !token) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/create`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await fetchWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create wallet');
    } finally {
      setCreating(false);
    }
  }, [userId, token, fetchWallet]);

  const requestSensitiveVerification = useCallback(async (
    action: 'EXPORT_WALLET' | 'WITHDRAW_SOL' | 'WITHDRAW_TOKEN',
  ): Promise<SensitiveVerification> => {
    if (!userId || !token) throw new Error('Not authenticated');
    const r = await fetch(`${BASE()}/wallet/${userId}/security/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data as SensitiveVerification;
  }, [userId, token]);

  const exportWallet = useCallback(async (
    verificationToken: string,
    confirmText: string,
  ): Promise<WalletExportPayload> => {
    if (!userId || !token) throw new Error('Not authenticated');
    setExporting(true);
    setExportError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ verificationToken, confirmText }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      await fetchWallet();
      return data as WalletExportPayload;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Wallet export failed';
      setExportError(message);
      throw new Error(message);
    } finally {
      setExporting(false);
    }
  }, [userId, token, fetchWallet]);

  const withdrawSOL = useCallback(async (
    destinationAddress: string,
    amountSol: number,
    verificationToken: string,
    confirmText: string,
  ) => {
    if (!userId || !token) return;
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawTx(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/withdraw/sol`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ destinationAddress, amountSol, verificationToken, confirmText }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setWithdrawTx(data.txHash as string);
      await fetchWallet();
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : 'Withdrawal failed');
    } finally {
      setWithdrawing(false);
    }
  }, [userId, token, fetchWallet]);

  const withdrawToken = useCallback(async (
    destinationAddress: string,
    tokenMint:          string,
    uiAmount:           number,
    verificationToken:  string,
    confirmText:        string,
  ) => {
    if (!userId || !token) return;
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawTx(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/withdraw/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ destinationAddress, tokenMint, uiAmount, verificationToken, confirmText }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setWithdrawTx(data.txHash as string);
      await fetchWallet();
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : 'Token withdrawal failed');
    } finally {
      setWithdrawing(false);
    }
  }, [userId, token, fetchWallet]);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  return {
    wallet,
    loading,
    creating,
    error,
    walletExists: wallet !== null,
    isFunded:     (wallet?.balanceSol ?? 0) >= 0.005,
    createWallet,
    refreshBalance: fetchWallet,
    requestSensitiveVerification,
    exportWallet, exporting, exportError,
    withdrawSOL, withdrawing, withdrawError, withdrawTx,
    withdrawToken,
  };
}

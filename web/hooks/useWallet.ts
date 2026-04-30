'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

export interface TokenBalance {
  mint:     string;
  symbol:   string;
  balance:  number;
  decimals: number;
}

export interface WalletInfo {
  publicKey:  string;
  balanceSol: number | null;
  createdAt:  number;
  lastUsedAt: number | null;
  tokens:     TokenBalance[];
}

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';



type TradeSuccessCallback = (userId: string) => void;
const tradeSuccessListeners = new Set<TradeSuccessCallback>();

export function notifyTradeSuccess(userId: string): void {
  for (const cb of tradeSuccessListeners) cb(userId);
}



export function useWallet(userId: string) {
  const [wallet,        setWallet]        = useState<WalletInfo | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [withdrawing,   setWithdrawing]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawTx,    setWithdrawTx]    = useState<string | null>(null);

  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setWallet(data as WalletInfo | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const debouncedRefresh = useCallback(() => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    refreshDebounceRef.current = setTimeout(() => {
      fetchWallet();
    }, 3_000);
  }, [fetchWallet]);

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
    if (!userId) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/create`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await fetchWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create wallet');
    } finally {
      setCreating(false);
    }
  }, [userId, fetchWallet]);

 

  const withdrawSOL = useCallback(async (destinationAddress: string, amountSol: number) => {
    if (!userId) return;
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawTx(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/withdraw/sol`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ destinationAddress, amountSol }),
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
  }, [userId, fetchWallet]);

  

  const withdrawToken = useCallback(async (
    destinationAddress: string,
    tokenMint:          string,
    uiAmount:           number,
  ) => {
    if (!userId) return;
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawTx(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/withdraw/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ destinationAddress, tokenMint, uiAmount }),
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
  }, [userId, fetchWallet]);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const walletExists = wallet !== null;
  const isFunded     = (wallet?.balanceSol ?? 0) >= 0.005;

  return {
    wallet, loading, creating, error,
    walletExists, isFunded,
    createWallet,
    refreshBalance: fetchWallet,
    withdrawSOL,     withdrawing, withdrawError, withdrawTx,
    withdrawToken,
  };
}
'use client';
import { useState, useEffect, useCallback } from 'react';

export interface WalletInfo {
  publicKey:  string;
  balanceSol: number | null;
  createdAt:  number;
}

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function useWallet(userId: string) {
  const [wallet,   setWallet]   = useState<WalletInfo | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [creating, setCreating] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setWallet(data); // null if not created yet
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const createWallet = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/wallet/${userId}/create`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await fetchWallet(); // reload with balance
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create wallet');
    } finally {
      setCreating(false);
    }
  }, [userId, fetchWallet]);

  const refreshBalance = useCallback(async () => {
    await fetchWallet();
  }, [fetchWallet]);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  return { wallet, loading, creating, error, createWallet, refreshBalance };
}
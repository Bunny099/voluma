'use client';
import { useState, useEffect, useCallback } from 'react';
import { type ConditionWithStats }           from '../conditions/types';

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function useConditions(userId: string) {
  const [conditions, setConditions] = useState<ConditionWithStats[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE()}/conditions/${userId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConditions(await r.json() as ConditionWithStats[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refetch(); }, [refetch]);

  const addOptimistic = useCallback((cond: ConditionWithStats) => {
    setConditions(prev => prev.some(c => c.id === cond.id) ? prev : [cond, ...prev]);
  }, []);

  const deleteCondition = useCallback(async (id: string) => {
    setConditions(prev => prev.filter(c => c.id !== id));
    try {
      const r = await fetch(`${BASE()}/conditions/${id}`, { method: 'DELETE' });
      if (!r.ok) await refetch();
    } catch { await refetch(); }
  }, [refetch]);

  const toggleCondition = useCallback(async (id: string, enabled: boolean) => {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, enabled } : c));
    try {
      const r = await fetch(`${BASE()}/conditions/${id}/toggle`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) await refetch();
    } catch { await refetch(); }
  }, [refetch]);

  return { conditions, loading, error, refetch, deleteCondition, toggleCondition, addOptimistic };
}
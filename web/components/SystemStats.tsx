'use client';
import { useEffect, useState } from 'react';

interface Stats {
  queueDepth: number;
  activeConditions: number;
  wsConnections: number;
  uptimeSeconds: number;
}

export default function SystemStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/stats`);
        setStats(await r.json());
      } catch {}
    };
    fetch_();
    const t = setInterval(fetch_, 5_000);
    return () => clearInterval(t);
  }, []);

  const rows = stats ? [
    { label: 'Queue depth',   value: stats.queueDepth.toLocaleString() },
    { label: 'Conditions',    value: stats.activeConditions.toLocaleString() },
    { label: 'WS clients',    value: stats.wsConnections.toLocaleString() },
    { label: 'Uptime',        value: `${Math.floor(stats.uptimeSeconds / 60)}m` },
  ] : [];

  return (
    <div>
      <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider mb-3">
        System
      </p>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between items-center">
            <span className="text-[11px] text-zinc-500">{r.label}</span>
            <span className="text-[11px] font-mono text-zinc-300">{r.value}</span>
          </div>
        ))}
        {!stats && (
          <p className="text-[11px] text-zinc-700 font-mono">loading…</p>
        )}
      </div>
    </div>
  );
}
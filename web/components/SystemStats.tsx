'use client';
import { useEffect, useState, useRef } from 'react';

interface Stats {
  queueDepth:       number;
  queueInFlight:    number;
  activeConditions: number;
  wsConnections:    number;
  uptimeSeconds:    number;
  totalEvents:      number;
  droppedEvents:    number;
  dropRate:         number;
  totalExecutions:  number;
  failedExecutions: number;
  pendingExecutions: number;
  tradeSuccessRate: number;
  rpc: {
    activeProvider: {
      label: string;
      recentFailures: number;
      reconnectCount: number;
      lastSuccessfulSlot: number | null;
    };
    degradedMode: boolean;
    healthState: 'HEALTHY' | 'DEGRADED' | 'FALLBACK';
  };
}

const BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function uptime(s: number): string {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}


function AnimNum({ value, warn }: { value: string; warn?: boolean }) {
  const [display, setDisplay] = useState(value);
  const [flash,   setFlash]   = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      setDisplay(value);
      prev.current = value;
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      color: flash ? '#d4ff00' : warn ? '#fbbf24' : '#5c6472',
      transition: 'color 0.35s',
    }}>
      {display}
    </span>
  );
}

function MetricRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '5px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.6rem',
        color: '#506070',
        letterSpacing: '0.04em',
      }}>
        {label}
      </span>
      <AnimNum value={value} warn={warn} />
    </div>
  );
}

export default function SystemStats() {
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const go = async () => {
      try {
        const r = await fetch(`${BASE()}/stats`);
        if (r.ok) setStats(await r.json());
      } catch {}
      finally { setLoading(false); }
    };
    go();
    const t = setInterval(go, 5_000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div style={{ padding:'4px 0' }}>
        <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.58rem', color:'#506070', letterSpacing:'0.12em', textTransform:'uppercase' as const, marginBottom:10 }}>
          METRICS
        </p>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{
            height:16, marginBottom:5, borderRadius:4,
            background:'rgba(255,255,255,0.03)',
            animation:`ss-pulse 1.5s ${i * 0.12}s ease-in-out infinite`,
          }} />
        ))}
        <style>{`@keyframes ss-pulse{0%,100%{opacity:0.3}50%{opacity:0.6}}`}</style>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{ padding:'4px 0' }}>
        <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.6rem', color:'#4a5a6e' }}>Connecting…</p>
      </div>
    );
  }

  const successPct = stats.totalExecutions > 0 ? `${(stats.tradeSuccessRate * 100).toFixed(0)}%` : '—';
  const dropPct    = stats.dropRate > 0 ? `${(stats.dropRate * 100).toFixed(1)}%` : '0%';
  const rpcState = stats.rpc.healthState === 'FALLBACK'
    ? 'fallback'
    : stats.rpc.healthState === 'DEGRADED'
      ? 'degraded'
      : 'healthy';

  return (
    <div style={{ padding:'4px 0' }}>
      <p style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.58rem',
        color: '#506070',
        letterSpacing: '0.12em',
        textTransform: 'uppercase' as const,
        marginBottom: 10,
      }}>METRICS</p>

      <div>
        <MetricRow label="Queue"      value={`${stats.queueDepth}/${stats.queueInFlight}`} warn={stats.queueDepth > 1000} />
        <MetricRow label="Automations" value={String(stats.activeConditions)} />
        <MetricRow label="Clients"    value={String(stats.wsConnections)} />
        <MetricRow label="Events"     value={fmt(stats.totalEvents)} />
        <MetricRow label="RPC"        value={stats.rpc.activeProvider.label} warn={stats.rpc.degradedMode} />
        <MetricRow label="RPC state"  value={rpcState} warn={stats.rpc.healthState !== 'HEALTHY'} />
        <MetricRow label="Reconnects" value={String(stats.rpc.activeProvider.reconnectCount)} warn={stats.rpc.activeProvider.reconnectCount > 3} />
        <MetricRow label="Drop rate"  value={dropPct} warn={stats.dropRate > 0.01} />
        {stats.totalExecutions > 0 && (
          <MetricRow label="Action rate" value={successPct} warn={stats.tradeSuccessRate < 0.8} />
        )}
        {stats.pendingExecutions > 0 && (
          <MetricRow label="Pending" value={String(stats.pendingExecutions)} warn />
        )}
        <MetricRow label="Uptime"     value={uptime(stats.uptimeSeconds)} />
      </div>
    </div>
  );
}

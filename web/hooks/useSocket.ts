'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export type ErrorType =
  | 'timeout' | 'network' | 'bad_request'
  | 'server_error' | 'invalid_url' | 'trade_error' | 'no_wallet';

export interface TradeResultPayload {
  txHash?:    string;
  inputMint:  string;
  outputMint: string;
  amountIn:   number;
  latencyMs:  number;
}

export interface ActionResult {
  type:            string;
  status:          'success' | 'failed' | 'skipped';
  attempts:        number;
  durationMs:      number;
  error?:          string;
  errorType?:      ErrorType;
  responseStatus?: number;
  tradeResult?:    TradeResultPayload;
}

export interface ExecutionSummary { total: number; success: number; failed: number; }

export interface TriggerExplanation {
  reason:        string;
  matchedFields: string[];
  confidence:    'HIGH' | 'MEDIUM' | 'LOW';
  details:       Record<string, unknown>;
}

export interface LiveEvent {
  signature:  string;
  eventType:  'SWAP' | 'TRANSFER' | 'UNKNOWN';
  tokenMint?: string;
  timestamp:  number;
}

export interface TriggerEvent {
  conditionId:   string;
  conditionName: string;
  conditionType: string;
  signature:     string;
  eventType:     string;
  wallet?:       string;
  tokenMint?:    string;
  amount?:       number;
  matchedAt:     number;
  explanation?:  TriggerExplanation;
  execution?: {
    deliveryId: string;
    actions:    ActionResult[];
    summary:    ExecutionSummary;
  };
}

const MAX_LIVE_EVENTS    = 200;
const MAX_TRIGGERS       = 100;
const MAX_TRIGGERED_SIGS = 500;

export function useSocket(userId: string) {
  const wsRef        = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);

  const [connected,     setConnected]     = useState(false);
  const [liveEvents,    setLiveEvents]    = useState<LiveEvent[]>([]);
  const [triggers,      setTriggers]      = useState<TriggerEvent[]>([]);
  const [triggeredSigs, setTriggeredSigs] = useState<Map<string, string>>(new Map());

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')
      .replace(/^https/, 'wss').replace(/^http/, 'ws');
    const ws   = new WebSocket(`${base}/ws?userId=${encodeURIComponent(userId)}`);
    wsRef.current = ws;

    ws.onopen  = () => { if (mountedRef.current) setConnected(true); };
    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 2_000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(evt.data as string); } catch { return; }

      if (msg.type === 'LIVE_EVENT') {
        setLiveEvents(prev => [msg as unknown as LiveEvent, ...prev].slice(0, MAX_LIVE_EVENTS));
      }
      if (msg.type === 'TRIGGER') {
        const trigger = msg as unknown as TriggerEvent;
        setTriggers(prev => [trigger, ...prev].slice(0, MAX_TRIGGERS));
        if (trigger.signature && trigger.conditionName) {
          setTriggeredSigs(prev => {
            if (prev.has(trigger.signature)) return prev;
            const next = new Map(prev);
            next.set(trigger.signature, trigger.conditionName);
            if (next.size > MAX_TRIGGERED_SIGS) {
              const arr = [...next.entries()];
              return new Map(arr.slice(arr.length - MAX_TRIGGERED_SIGS));
            }
            return next;
          });
        }
      }
    };
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearTriggers = useCallback(() => setTriggers([]), []);
  return { connected, liveEvents, triggers, triggeredSigs, clearTriggers };
}
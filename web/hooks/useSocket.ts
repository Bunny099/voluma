'use client';
import { useEffect, useRef, useState } from 'react';

export type ErrorType =
  | 'timeout' | 'network' | 'bad_request'
  | 'server_error' | 'invalid_url' | 'trade_error' | 'no_wallet' | 'no_balance';

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


export interface TradeToast {
  id:        string;
  kind:      'success' | 'error' | 'pending';
  message:   string;
  txHash?:   string;
  timestamp: number;
}

export interface PendingTxInfo {
  txHash:    string;
  status:    'PENDING' | 'CONFIRMED' | 'FAILED';
  inputMint: string;
  outputMint: string;
  amountIn:  number;
  createdAt: number;
}

const MAX_LIVE_EVENTS    = 200;
const MAX_TRIGGERS       = 100;
const MAX_TRIGGERED_SIGS = 500;
const BASE_RECONNECT_MS  = 1_500;
const MAX_RECONNECT_MS   = 30_000;

export function useSocket(userId: string) {
  const [connected,     setConnected]     = useState(false);
  const [liveEvents,    setLiveEvents]    = useState<LiveEvent[]>([]);
  const [triggers,      setTriggers]      = useState<TriggerEvent[]>([]);
  const [triggeredSigs, setTriggeredSigs] = useState<Map<string, string>>(new Map());
  const [pendingTxs,    setPendingTxs]    = useState<PendingTxInfo[]>([]);
  // Fix 6: trade toast queue
  const [tradeToasts,   setTradeToasts]   = useState<TradeToast[]>([]);

  const wsRef          = useRef<WebSocket | null>(null);
  const retryTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef  = useRef(BASE_RECONNECT_MS);
  const generationRef  = useRef(0);

  const setLiveEventsRef    = useRef(setLiveEvents);
  const setTriggersRef      = useRef(setTriggers);
  const setTriggeredSigsRef = useRef(setTriggeredSigs);
  const setTradeToastsRef   = useRef(setTradeToasts);
  const setPendingTxsRef    = useRef(setPendingTxs);
  setLiveEventsRef.current    = setLiveEvents;
  setTriggersRef.current      = setTriggers;
  setTriggeredSigsRef.current = setTriggeredSigs;
  setTradeToastsRef.current  = setTradeToasts;
  setPendingTxsRef.current   = setPendingTxs;

  // Callback ref wired by dashboard page to refresh the wallet
  const onTradeSuccessRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!userId) return;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    generationRef.current += 1;
    const myGeneration = generationRef.current;

    if (wsRef.current) {
      const old = wsRef.current;
      old.onopen    = null;
      old.onclose   = null;
      old.onerror   = null;
      old.onmessage = null;
      if (old.readyState !== WebSocket.CLOSED && old.readyState !== WebSocket.CLOSING) {
        old.close();
      }
      wsRef.current = null;
    }

    setConnected(false);
    retryDelayRef.current = BASE_RECONNECT_MS;

    function pushToast(toast: Omit<TradeToast, 'id' | 'timestamp'>) {
      const entry: TradeToast = {
        ...toast,
        id:        Math.random().toString(36).slice(2),
        timestamp: Date.now(),
      };
      setTradeToastsRef.current(prev => [entry, ...prev].slice(0, 10));
      // Auto-dismiss after 6s
      setTimeout(() => {
        setTradeToastsRef.current(prev => prev.filter(t => t.id !== entry.id));
      }, 6_000);
    }

    function openSocket() {
      if (generationRef.current !== myGeneration) return;

      const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')
        .replace(/^https/, 'wss')
        .replace(/^http/,  'ws');

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${base}/ws?userId=${encodeURIComponent(userId)}`);
      } catch {
        scheduleReconnect();
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (generationRef.current !== myGeneration) { ws.close(); return; }
        setConnected(true);
        retryDelayRef.current = BASE_RECONNECT_MS;
      };

      ws.onclose = (evt) => {
        if (generationRef.current !== myGeneration) return;
        setConnected(false);
        if (evt.code === 1008) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (generationRef.current !== myGeneration) return;
        setConnected(false);
      };

      ws.onmessage = (evt) => {
        if (generationRef.current !== myGeneration) return;

        let msg: Record<string, unknown>;
        try { msg = JSON.parse(evt.data as string); }
        catch { return; }

      
        if (msg.type === 'LIVE_EVENT') {
          setLiveEventsRef.current(prev =>
            [msg as unknown as LiveEvent, ...prev].slice(0, MAX_LIVE_EVENTS)
          );
        }

      
        if (msg.type === 'TRIGGER') {
          const trigger = msg as unknown as TriggerEvent;
          setTriggersRef.current(prev => [trigger, ...prev].slice(0, MAX_TRIGGERS));

          if (trigger.signature && trigger.conditionName) {
            setTriggeredSigsRef.current(prev => {
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

      
        if (msg.type === 'TRADE_SUCCESS') {
          if (onTradeSuccessRef.current) onTradeSuccessRef.current();
          const txHash = msg.txHash as string | undefined;
          pushToast({
            kind:    'success',
            message: `Trade submitted${txHash ? '' : ' — no tx hash'}`,
            txHash,
          });
         
          setPendingTxsRef.current(prev => prev.filter(t => t.txHash !== txHash));
        }

        if (msg.type === 'TRADE_FAILED') {
          if (onTradeSuccessRef.current) onTradeSuccessRef.current();
          pushToast({
            kind:    'error',
            message: (msg.error as string) ?? 'Trade failed',
          });
        }

     
        if (msg.type === 'TRADE_PENDING') {
          const txHash = msg.txHash as string;
          setPendingTxsRef.current(prev => {
            if (prev.some(t => t.txHash === txHash)) return prev;
            return [...prev, {
              txHash,
              status:    'PENDING',
              inputMint:  (msg.inputMint as string) ?? '',
              outputMint: (msg.outputMint as string) ?? '',
              amountIn:   (msg.amountIn as number) ?? 0,
              createdAt:  Date.now(),
            }];
          });
          if (onTradeSuccessRef.current) onTradeSuccessRef.current();
          pushToast({
            kind:    'pending',
            message: 'Trade submitted — awaiting confirmation',
            txHash,
          });
        }

        if (msg.type === 'TRADE_CONFIRMED') {
          const txHash = msg.txHash as string;
          setPendingTxsRef.current(prev => prev.filter(t => t.txHash !== txHash));
          if (onTradeSuccessRef.current) onTradeSuccessRef.current();
          pushToast({
            kind:    'success',
            message: 'Trade confirmed on-chain',
            txHash,
          });
        }
      };
    }

    function scheduleReconnect() {
      if (generationRef.current !== myGeneration) return;
      retryTimerRef.current = setTimeout(() => {
        retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, MAX_RECONNECT_MS);
        openSocket();
      }, retryDelayRef.current);
    }

    openSocket();

    return () => {
      generationRef.current += 1;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        ws.onopen    = null;
        ws.onclose   = null;
        ws.onerror   = null;
        ws.onmessage = null;
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.close();
        }
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [userId]);

  const clearTriggers  = () => setTriggers([]);
  const dismissToast   = (id: string) => setTradeToasts(prev => prev.filter(t => t.id !== id));
  const clearPendingTx = (txHash: string) => setPendingTxs(prev => prev.filter(t => t.txHash !== txHash));

  return {
    connected,
    liveEvents,
    triggers,
    triggeredSigs,
    clearTriggers,
    tradeToasts,
    dismissToast,
    pendingTxs,
    clearPendingTx,
    _onTradeSuccessRef: onTradeSuccessRef,
  };
}
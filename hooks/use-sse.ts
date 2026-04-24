'use client';

import { useEffect, useRef, useState } from 'react';

export interface UseSSEOptions<T> {
  /** Event name to subscribe to. Defaults to 'message'. */
  eventName?: string;
  /** Max events kept in the buffer. Older ones are dropped. */
  bufferLimit?: number;
  /** Called for each event in addition to buffering (for side effects). */
  onEvent?: (parsed: T) => void;
  /** Enable/disable the subscription dynamically. Default true. */
  enabled?: boolean;
}

export interface UseSSEResult<T> {
  events: T[];
  connected: boolean;
  lastError: string | null;
}

/**
 * Subscribes to a Server-Sent Events endpoint. Auto-reconnects by browser default.
 * Buffers parsed events in state; clears them on URL change.
 */
export function useSSE<T = unknown>(
  url: string | null,
  opts: UseSSEOptions<T> = {},
): UseSSEResult<T> {
  const { eventName = 'message', bufferLimit = 500, onEvent, enabled = true } = opts;
  const [events, setEvents] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled || !url) return;
    setEvents([]);
    setConnected(false);
    setLastError(null);

    const es = new EventSource(url);

    const handler = (ev: MessageEvent) => {
      try {
        const parsed: T = JSON.parse(ev.data);
        setEvents(prev => {
          const next = [...prev, parsed];
          return next.length > bufferLimit ? next.slice(next.length - bufferLimit) : next;
        });
        onEventRef.current?.(parsed);
      } catch (err) {
        setLastError(`parse error: ${(err as Error).message}`);
      }
    };

    es.addEventListener('open', () => { setConnected(true); setLastError(null); });
    es.addEventListener('error', () => {
      setConnected(false);
      setLastError('connection error');
      // EventSource auto-reconnects — no manual retry needed
    });
    es.addEventListener(eventName, handler as EventListener);
    if (eventName !== 'message') {
      // also listen on default 'message' for servers that don't set event names
      es.addEventListener('message', handler as EventListener);
    }

    return () => {
      es.removeEventListener(eventName, handler as EventListener);
      es.removeEventListener('message', handler as EventListener);
      es.close();
    };
  }, [url, eventName, bufferLimit, enabled]);

  return { events, connected, lastError };
}

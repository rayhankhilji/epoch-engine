'use client';

import { useEffect, useRef, useState } from 'react';
import type { LlmStats, StreamMessage, WorldEvent, WorldSummary } from './types';

export interface LiveState {
  connected: boolean;
  events: WorldEvent[];
  tick: number;
  t: number;
  stats: WorldSummary['stats'] | null;
  llm: LlmStats | null;
  status: WorldSummary['status'] | null;
  warnings: string[];
}

/**
 * Subscribes to a world's event stream.
 *
 * The server pushes over Server-Sent Events, which `EventSource` reconnects on
 * its own — so a paused laptop or a restarted server heals without any
 * reconnect logic here. Events accumulate into a capped ring so a world left
 * running overnight doesn't grow the tab's memory without bound.
 */
export function useStream(worldId: string | null, maxEvents = 300): LiveState {
  const [state, setState] = useState<LiveState>({
    connected: false,
    events: [],
    tick: 0,
    t: 0,
    stats: null,
    llm: null,
    status: null,
    warnings: [],
  });

  // Ticks arrive far faster than React should re-render, so they're buffered
  // and flushed on an interval instead of driving a render each time.
  const pending = useRef<Partial<LiveState>>({});
  const incoming = useRef<WorldEvent[]>([]);

  useEffect(() => {
    if (!worldId) return;

    const source = new EventSource(`/api/worlds/${worldId}/stream`);

    source.onopen = () => setState((prev) => ({ ...prev, connected: true }));
    source.onerror = () => setState((prev) => ({ ...prev, connected: false }));

    source.onmessage = (message) => {
      let parsed: StreamMessage;
      try {
        parsed = JSON.parse(message.data) as StreamMessage;
      } catch {
        return;
      }

      switch (parsed.type) {
        case 'event':
          incoming.current.push(parsed.payload);
          break;
        case 'tick':
          pending.current = {
            ...pending.current,
            tick: parsed.payload.tick,
            t: parsed.payload.t,
            stats: parsed.payload.stats,
            llm: parsed.payload.llm,
          };
          break;
        case 'status':
          pending.current = { ...pending.current, status: parsed.payload.status };
          break;
        case 'warning':
          pending.current = {
            ...pending.current,
            warnings: [...(pending.current.warnings ?? []), parsed.payload.message].slice(-20),
          };
          break;
      }
    };

    const flush = setInterval(() => {
      if (Object.keys(pending.current).length === 0 && incoming.current.length === 0) return;

      const batch = incoming.current;
      const patch = pending.current;
      incoming.current = [];
      pending.current = {};

      setState((prev) => ({
        ...prev,
        ...patch,
        warnings: patch.warnings ? [...prev.warnings, ...patch.warnings].slice(-20) : prev.warnings,
        events: batch.length > 0 ? [...batch.reverse(), ...prev.events].slice(0, maxEvents) : prev.events,
      }));
    }, 250);

    return () => {
      clearInterval(flush);
      source.close();
    };
  }, [worldId, maxEvents]);

  return state;
}

/** Re-run `load` whenever the world advances past `everyTicks`. */
export function usePolled<T>(
  load: () => Promise<T>,
  deps: unknown[],
  tick: number,
  everyTicks = 40,
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const bucket = Math.floor(tick / everyTicks);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, bucket, nonce]);

  return { data, error, reload: () => setNonce((n) => n + 1) };
}

import { useEffect, useRef, useState } from 'react';
import type { LiveModelSource, LiveModelSourceResult } from '@livra/shared';
import { api } from './api';

export type SourceState = Omit<LiveModelSourceResult, 'status'> & {
  status: LiveModelSourceResult['status'] | 'loading';
  refreshing?: boolean;
};
export function useLiveModelSources(sources: LiveModelSource[]) {
  const [results, setResults] = useState<Record<string, SourceState>>({});
  const generation = useRef(0);
  const key = JSON.stringify(sources);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setResults(
      Object.fromEntries(
        sources
          .filter((s) => s.enabled)
          .map((s) => [s.id, { id: s.id, models: [], status: 'loading' }]),
      ),
    );
    for (const source of sources.filter((s) => s.enabled)) {
      void api<LiveModelSourceResult>(`/live-models/sources/${source.id}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (generation.current === current)
            setResults((all) => ({ ...all, [source.id]: result }));
        })
        .catch((error) => {
          if (!controller.signal.aborted && generation.current === current)
            setResults((all) => ({
              ...all,
              [source.id]: { id: source.id, models: [], status: 'error', error: error.message },
            }));
        });
    }
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [key]);
  async function refresh(id: string) {
    const current = generation.current;
    setResults((all) => ({
      ...all,
      [id]: { ...(all[id] || { id, models: [], status: 'loading' }), refreshing: true },
    }));
    try {
      const result = await api<LiveModelSourceResult>(`/live-models/sources/${id}?refresh=1`);
      if (generation.current === current) setResults((all) => ({ ...all, [id]: result }));
    } catch (error) {
      if (generation.current === current)
        setResults((all) => ({
          ...all,
          [id]: {
            ...all[id],
            status: all[id]?.models.length ? 'stale' : 'error',
            refreshing: false,
            error: (error as Error).message,
          },
        }));
    }
  }
  return { results, refresh };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '@livra/shared';
import { api } from './api';

export function useSaktaModels(account: Settings['sakta']) {
  const connected = !!account?.connected,
    name = account?.name || '';
  const [state, setState] = useState({
    name: '',
    models: [] as string[],
    status: 'idle',
    error: '',
  });
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    if (!connected) return;
    const controller = new AbortController();
    pending.current = controller;
    setState((s) => ({
      name,
      models: s.name === name ? s.models : [],
      status: 'loading',
      error: '',
    }));
    try {
      const data = await api<{ models: string[] }>('/sakta/models', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      if (!controller.signal.aborted)
        setState({ name, models: data.models, status: 'ready', error: '' });
    } catch (e) {
      if (!controller.signal.aborted)
        setState((s) => ({
          ...s,
          status: 'error',
          error: (e as Error).name === 'TimeoutError' ? '连接超时，请重试' : (e as Error).message,
        }));
    }
  }, [connected, name]);
  useEffect(() => {
    if (connected) void refresh();
    else setState({ name: '', models: [], status: 'idle', error: '' });
    return () => pending.current?.abort();
  }, [refresh]);
  const current = connected && state.name === name;
  return {
    models: current ? state.models : [],
    loading: connected && (!current || state.status === 'idle' || state.status === 'loading'),
    error: current ? state.error : '',
    connected,
    refresh,
  };
}
export type RemoteModels = ReturnType<typeof useSaktaModels>;

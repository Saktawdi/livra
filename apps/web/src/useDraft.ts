import { useState, type Dispatch, type SetStateAction } from 'react';

// Drafts are tab-local and never sent until the user submits them.
export function useDraft(id: string | undefined): [string, Dispatch<SetStateAction<string>>] {
  const key = 'livra:draft:' + (id || 'new');
  const read = () => {
    try {
      return sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  };
  const [state, setState] = useState({ key, text: read() });
  const text = state.key === key ? state.text : read();
  function update(action: SetStateAction<string>) {
    setState((previous) => {
      const before = previous.key === key ? previous.text : read();
      const next = typeof action === 'function' ? action(before) : action;
      try {
        if (next) sessionStorage.setItem(key, next);
        else sessionStorage.removeItem(key);
      } catch {}
      return { key, text: next };
    });
  }
  return [text, update];
}

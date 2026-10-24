import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export function useSessionState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const key = 'livra:studio:' + name;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed === typeof initial) return parsed as T;
      }
    } catch {}
    return initial;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

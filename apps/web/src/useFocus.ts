import { useEffect, useState } from 'react';
import type { Notify } from './App';
type Focus = { remaining: number; end: number | null; visible: boolean };
export function useFocus(notify: Notify) {
  const [focus, setFocus] = useState<Focus>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('livra:focus') || 'null');
      if (
        saved &&
        typeof saved.remaining === 'number' &&
        typeof saved.visible === 'boolean' &&
        (saved.end === null || typeof saved.end === 'number')
      )
        return saved;
    } catch {}
    return { remaining: 1500, end: null, visible: false };
  });
  const [remaining, setRemaining] = useState(() =>
    focus.end ? Math.max(0, Math.ceil((focus.end - Date.now()) / 1000)) : focus.remaining,
  );
  useEffect(() => {
    try {
      sessionStorage.setItem('livra:focus', JSON.stringify(focus));
    } catch {}
    setRemaining(
      focus.end ? Math.max(0, Math.ceil((focus.end - Date.now()) / 1000)) : focus.remaining,
    );
  }, [focus]);
  useEffect(() => {
    if (!focus.end) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((focus.end! - Date.now()) / 1000));
      setRemaining(left);
      if (!left) {
        setFocus({ remaining: 0, end: null, visible: true });
        notify('专注时间到了，休息一下。');
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [focus.end]);
  return {
    remaining,
    timerOn: focus.end !== null,
    timerVisible: focus.visible,
    start: () =>
      setFocus((f) => ({
        ...f,
        remaining: f.remaining || 1500,
        visible: true,
        end: f.end || Date.now() + (f.remaining || 1500) * 1000,
      })),
    toggle: () =>
      setFocus((f) => ({
        ...f,
        remaining,
        end: f.end ? null : Date.now() + (remaining || 1500) * 1000,
      })),
    end: () => setFocus({ remaining: 1500, end: null, visible: false }),
  };
}

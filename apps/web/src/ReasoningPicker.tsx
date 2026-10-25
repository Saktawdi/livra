import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brain, Check, ChevronDown } from 'lucide-react';

const defaultLevels = [
  { id: 'auto', label: '自动' },
  { id: 'none', label: '关闭' },
  { id: 'minimal', label: '最低' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '最高' },
  { id: 'max', label: '最大' },
];
export function ReasoningPicker({
  value,
  onChange,
  disabled,
  levels: supported,
}: {
  levels?: string[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const levels = supported?.length
    ? [...new Set(['auto', ...supported])].map((id) => ({
        id,
        label:
          defaultLevels.find((level) => level.id === id)?.label || (id === 'max' ? '最大' : id),
      }))
    : defaultLevels;
  const [open, setOpen] = useState(false),
    [placement, setPlacement] = useState({ side: 'above', height: 280 });
  const host = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    options = useRef<(HTMLButtonElement | null)[]>([]);
  const current = levels.find((l) => l.id === value) || levels[0];
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = host.current!.getBoundingClientRect();
      const bounds = host.current!.closest('.main-content')?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const top = Math.max(bounds?.top || 0, viewportTop);
      const bottom = Math.min(
        bounds?.bottom || innerHeight,
        viewportTop + (viewport?.height || innerHeight),
      );
      const above = rect.top - top - 22,
        below = bottom - rect.bottom - 22;
      const side = above >= Math.min(280, below) ? 'above' : 'below';
      const height = Math.max(44, Math.min(280, side === 'above' ? above : below));
      setPlacement((previous) =>
        previous.side === side && previous.height === height ? previous : { side, height },
      );
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const focused = options.current.find((option) => option === document.activeElement);
    const option =
      focused ||
      options.current[
        Math.max(
          0,
          levels.findIndex((l) => l.id === value),
        )
      ];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  }, [open, placement]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      className="reasoning-control"
      ref={host}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        disabled={disabled}
        className="reasoning-trigger"
        aria-label={'推理强度：' + current.label}
        title={'推理强度：' + current.label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Brain size={16} />
        <span className="reasoning-label">{current.label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="reasoning-popover"
          data-side={placement.side}
          style={{ maxHeight: placement.height }}
          role="menu"
          aria-label="推理强度"
        >
          <p>推理强度</p>
          {levels.map((level, i) => (
            <button
              key={level.id}
              ref={(el) => {
                options.current[i] = el;
              }}
              role="menuitemradio"
              aria-checked={value === level.id}
              tabIndex={value === level.id ? 0 : -1}
              onClick={() => {
                onChange(level.id);
                close();
              }}
              onKeyDown={(e) => {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault();
                  const option =
                    options.current[
                      e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? levels.length - 1
                          : (i + (e.key === 'ArrowDown' ? 1 : -1) + levels.length) % levels.length
                    ];
                  option?.focus({ preventScroll: true });
                  option?.scrollIntoView({ block: 'nearest' });
                }
              }}
            >
              <span>{level.label}</span>
              {value === level.id && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

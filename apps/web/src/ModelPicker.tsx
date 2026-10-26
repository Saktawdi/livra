import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { RemoteModels } from './useSaktaModels';

export type ModelOption = { provider: string; name: string; model: string };
export function ModelSkeleton() {
  return (
    <div className="model-skeleton" role="status" aria-label="正在加载模型">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden="true">
          <i />
          <span>
            <b />
            <small />
          </span>
        </div>
      ))}
    </div>
  );
}
export function ModelPicker({
  options,
  provider,
  model,
  remote,
  busy,
  onSelect,
  onSettings,
}: {
  options: ModelOption[];
  provider: string;
  model: string;
  remote: RemoteModels;
  busy: boolean;
  onSelect: (option: ModelOption) => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [placement, setPlacement] = useState({ side: 'above', height: 300 });
  const filtered = options.filter((o) =>
    (o.model + ' ' + o.name).toLowerCase().includes(query.toLowerCase()),
  );
  const selected = options.find((o) => o.provider === provider && o.model === model);
  const waiting = !selected && remote.loading;
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function select(i: number) {
    if (filtered[i]) {
      onSelect(filtered[i]);
      close();
    }
  }
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = root.current!.getBoundingClientRect();
      const bounds = root.current!.closest('.main-content')?.getBoundingClientRect();
      const above = rect.top - (bounds?.top || 0) - 12,
        below = (bounds?.bottom || innerHeight) - rect.bottom - 12;
      const side = above >= Math.min(400, below) ? 'above' : 'below';
      setPlacement({
        side,
        height: Math.max(70, Math.min(320, (side === 'above' ? above : below) - 120)),
      });
    };
    position();
    window.addEventListener('resize', position);
    input.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
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
      window.removeEventListener('resize', position);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [query, filtered.length]);
  useEffect(() => {
    if (open) document.getElementById(listId + '-' + index)?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);
  return (
    <div
      className="model-control"
      ref={root}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className={'model-trigger ' + (!selected ? 'unconnected' : '')}
        disabled={busy}
        aria-label="选择对话模型"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQuery('');
          setIndex(
            Math.max(
              0,
              options.findIndex((o) => o === selected),
            ),
          );
        }}
      >
        {waiting ? (
          <LoaderCircle size={14} className="spin" />
        ) : remote.error && !selected ? (
          <CircleAlert size={14} />
        ) : (
          <span className="model-dot" />
        )}
        <span>
          {selected?.model ||
            (waiting ? '正在获取模型' : remote.error ? '连接需要重试' : '选择模型')}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="model-popover"
          data-side={placement.side}
          role="dialog"
          aria-label="选择模型"
        >
          <div className="model-search">
            <Search size={16} />
            <input
              ref={input}
              aria-label="搜索模型"
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded="true"
              aria-activedescendant={filtered[index] ? listId + '-' + index : undefined}
              placeholder="搜索模型或连接…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex(
                    (i) =>
                      (i + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, filtered.length)) %
                      Math.max(1, filtered.length),
                  );
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  select(index);
                }
              }}
            />
          </div>
          <div
            className="model-popover-list"
            style={{ maxHeight: placement.height }}
            id={listId}
            role="listbox"
            aria-label="模型列表"
            aria-busy={remote.loading}
          >
            {filtered.map((o, i) => (
              <button
                key={o.provider + ':' + o.model}
                id={listId + '-' + i}
                role="option"
                tabIndex={-1}
                aria-selected={o.provider === provider && o.model === model}
                className={index === i ? 'highlighted' : ''}
                onPointerMove={() => setIndex(i)}
                onClick={() => select(i)}
              >
                <span>
                  <strong>{o.model}</strong>
                  <small>{o.name}</small>
                </span>
                {o.provider === provider && o.model === model && <Check size={16} />}
              </button>
            ))}
            {remote.loading && !remote.models.length && <ModelSkeleton />}
            {!remote.loading && remote.error && (
              <div className="model-feedback" role="alert">
                <CircleAlert size={18} />
                <span>
                  <strong>Sakta 模型未能加载</strong>
                  <small>{remote.error}</small>
                </span>
                <button aria-label="重试加载模型" onClick={remote.refresh}>
                  <RefreshCw size={16} />
                </button>
              </div>
            )}
            {!remote.loading && !remote.error && !filtered.length && (
              <p className="model-empty">
                {query
                  ? '没有匹配的模型'
                  : remote.connected
                    ? '账号暂未提供可用模型'
                    : '添加自己的连接，或登录 Sakta'}
              </p>
            )}
          </div>
          <div className="model-popover-footer">
            <button
              onClick={() => {
                close();
                onSettings();
              }}
            >
              <Plus size={15} />
              管理模型连接
            </button>
            {remote.connected && (
              <button
                disabled={remote.loading}
                aria-label="刷新 Sakta 模型"
                onClick={remote.refresh}
              >
                <RefreshCw size={15} className={remote.loading ? 'spin' : ''} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

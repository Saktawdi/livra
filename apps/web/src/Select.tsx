import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown, CircleAlert, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import './select.css';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
};

type SelectProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'onChange' | 'children'
> & {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
};

/** A shared select with a top-layer panel, including inside modal dialogs. */
export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  searchable,
  loading = false,
  error,
  onRetry,
  disabled,
  className = '',
  id,
  ...props
}: SelectProps) {
  const generatedId = useId(),
    triggerId = id || generatedId,
    listId = generatedId + '-list';
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    retry = useRef<HTMLButtonElement>(null);
  const typing = useRef({ text: '', at: 0 });
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    `${option.label} ${option.description || ''} ${option.group || ''}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const enabled = filtered.filter((option) => !option.disabled);
  const hasSearch = searchable ?? options.length > 7;
  const activeIndex = filtered.findIndex((option) => option.value === active && !option.disabled);
  const activeId = activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show(last = false) {
    if (disabled) return;
    setQuery('');
    setActive(
      !selected?.disabled && selected
        ? selected.value
        : (last ? options.filter((o) => !o.disabled).at(-1) : options.find((o) => !o.disabled))
            ?.value || '',
    );
    setOpen(true);
  }
  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab' && open) {
      if (retry.current && !loading) {
        if (!event.shiftKey && event.target !== retry.current) {
          event.preventDefault();
          retry.current.focus();
          return;
        }
        if (event.shiftKey && event.target === retry.current) {
          event.preventDefault();
          (search.current || trigger.current)?.focus();
          return;
        }
      }
      // Continue from the trigger in normal document order, including Shift+Tab.
      trigger.current?.focus({ preventScroll: true });
      close();
    } else if (event.target !== trigger.current && event.target !== search.current) {
      return;
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (!open && ['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (!open) return show(event.key === 'ArrowUp');
      const index = enabled.findIndex((option) => option.value === active);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabled.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActive(enabled[next]?.value || '');
    } else if (
      (event.key === 'Enter' || (event.key === ' ' && event.target === trigger.current)) &&
      open
    ) {
      event.preventDefault();
      if (enabled.some((option) => option.value === active))
        choose(enabled.find((option) => option.value === active)!);
    } else if (
      event.target === trigger.current &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key !== ' '
    ) {
      event.preventDefault();
      if (!open) show();
      const now = Date.now();
      const text = now - typing.current.at < 700 ? typing.current.text + event.key : event.key;
      typing.current = { text, at: now };
      const match = options.find(
        (option) =>
          !option.disabled && option.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()),
      );
      if (match) setActive(match.value);
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    const popup = panel.current!,
      button = trigger.current!;
    popup.showPopover();
    const position = () => {
      const rect = button.getBoundingClientRect(),
        viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0,
        top = viewport?.offsetTop || 0;
      const width = viewport?.width || innerWidth,
        height = viewport?.height || innerHeight;
      const above = Math.max(0, rect.top - top - 14),
        below = Math.max(0, top + height - rect.bottom - 14);
      const side = below >= Math.min(280, above) ? 'below' : 'above';
      const panelWidth = Math.min(Math.max(rect.width, 240), width - 24);
      popup.dataset.side = side;
      popup.style.width = `${panelWidth}px`;
      popup.style.maxHeight = `${Math.min(380, side === 'below' ? below : above)}px`;
      popup.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12))}px`;
      popup.style.top = `${side === 'below' ? rect.bottom + 6 : rect.top - popup.offsetHeight - 6}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(button);
    observer.observe(popup);
    const onScroll = (event: Event) => {
      if (!popup.contains(event.target as Node)) position();
    };
    window.addEventListener('resize', position);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    (hasSearch ? search.current : button)?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      popup.hidePopover();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open, hasSearch]);
  useEffect(() => {
    if (!open) return;
    if (!enabled.some((option) => option.value === active)) setActive(enabled[0]?.value || '');
  }, [open, active, enabled.map((option) => option.value).join('\0')]);
  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  const label = props['aria-label'];
  return (
    <div
      className={`select-control ${className}`}
      ref={root}
      onKeyDown={keyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        {...props}
        type="button"
        id={triggerId}
        ref={trigger}
        disabled={disabled}
        className="select-trigger"
        role="combobox"
        aria-autocomplete="none"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !hasSearch ? activeId : undefined}
        data-placeholder={!selected || undefined}
        data-loading={loading || undefined}
        onClick={() => (open ? close() : show())}
      >
        <span className="select-value">
          {selected?.group && <small>{selected.group} ·</small>}
          {selected?.label || (loading ? '正在加载…' : placeholder)}
        </span>
        {loading ? (
          <LoaderCircle size={15} className="spin" aria-label="正在加载选项" />
        ) : (
          <ChevronDown size={15} className="select-chevron" />
        )}
      </button>
      {open && (
        <div className="select-panel" ref={panel} popover="manual">
          {hasSearch && (
            <div className="select-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={search}
                value={query}
                role="combobox"
                aria-label={label ? `搜索${label}` : '搜索选项'}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeId}
                placeholder="搜索选项…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          <div
            className="select-options"
            id={listId}
            role="listbox"
            aria-label={label}
            aria-labelledby={label ? undefined : triggerId}
            aria-busy={loading}
          >
            {filtered.map((option, index) => (
              <div key={option.value}>
                {option.group && option.group !== filtered[index - 1]?.group && (
                  <div className="select-group" role="presentation">
                    {option.group}
                  </div>
                )}
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={value === option.value}
                  disabled={option.disabled}
                  className={`select-option ${active === option.value ? 'highlighted' : ''}`}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse' && !option.disabled) setActive(option.value);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>
                    <span className="select-option-label">{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  <Check
                    size={15}
                    className="select-check"
                    aria-hidden="true"
                    style={{ visibility: value === option.value ? 'visible' : 'hidden' }}
                  />
                </button>
              </div>
            ))}
            {loading && (
              <div className="select-loading" role="status" aria-label="正在加载选项">
                {[0, 1, 2].map((index) => (
                  <span key={index} />
                ))}
              </div>
            )}
            {!loading && !filtered.length && (
              <p className="select-empty">
                {query ? '没有匹配的选项' : error ? '选项暂不可用' : '暂无可用选项'}
              </p>
            )}
          </div>
          {error && (
            <div className="select-feedback" role="status">
              <CircleAlert size={15} />
              <span>{error}</span>
              {onRetry && (
                <button
                  ref={retry}
                  type="button"
                  aria-label="重新加载选项"
                  disabled={loading}
                  onClick={() => {
                    (search.current || trigger.current)?.focus({ preventScroll: true });
                    onRetry();
                  }}
                >
                  <RefreshCw size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

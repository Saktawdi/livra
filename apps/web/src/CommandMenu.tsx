import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Search, CornerDownLeft } from 'lucide-react';
import { Modal } from './ui';

export type Command = {
  id: string;
  title: string;
  hint?: string;
  group: string;
  run: () => void;
  icon?: any;
};
export function CommandMenu({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0),
    results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const filtered = useMemo(
    () =>
      commands.filter((c) =>
        (c.title + ' ' + (c.hint || '') + ' ' + c.group)
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [commands, query],
  );
  function run(i: number) {
    filtered[i]?.run();
    onClose();
  }
  return (
    <Modal title="快速访问" onClose={onClose}>
      <div className="command-input">
        <Search size={20} />
        <input
          autoFocus
          data-autofocus
          aria-label="搜索页面、人偶与对话"
          placeholder="搜索页面、人偶与对话"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => (i + 1) % Math.max(1, filtered.length));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(index);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={filtered.length ? 'command-' + index : undefined}
        />
      </div>
      <div
        className="command-results"
        ref={results}
        id="command-results"
        role="listbox"
        aria-label="搜索结果"
      >
        {filtered.length ? (
          filtered.map((c, i) => {
            const Icon = c.icon || ArrowUpRight;
            return (
              <button
                key={c.id}
                id={'command-' + i}
                role="option"
                aria-selected={i === index}
                className={i === index ? 'active' : ''}
                onPointerMove={() => setIndex(i)}
                onClick={() => run(i)}
              >
                <Icon size={18} />
                <span>
                  <strong>{c.title}</strong>
                  <small>
                    {c.group}
                    {c.hint ? ' · ' + c.hint : ''}
                  </small>
                </span>
                {i === index && <CornerDownLeft size={16} />}
              </button>
            );
          })
        ) : (
          <p className="command-empty">没有找到“{query}”</p>
        )}
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd>选择
        </span>
        <span>
          <kbd>Enter</kbd>打开
        </span>
        <span>
          <kbd>Esc</kbd>关闭
        </span>
      </div>
    </Modal>
  );
}

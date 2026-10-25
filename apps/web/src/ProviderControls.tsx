// Ported from lumen-utools/src/ui.tsx.
import { useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react';
import type { ModelConfig } from '@livra/shared';
import { IconButton } from './ui';
const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');
export function CapabilityTags({ config }: { config: ModelConfig }) {
  return (
    <span className="capability-tags">
      {config.vision && <i>视觉</i>}
      {config.reasoning && <i>思考</i>}
      {config.tools && <i>工具</i>}
      {config.context && (
        <i>
          {config.context >= 1000000
            ? `${Math.floor(config.context / 1000000)}M`
            : `${Math.round(config.context / 1000)}K`}
        </i>
      )}
    </span>
  );
}
export function parseKeys(raw: string): string[] {
  let values: unknown[];
  if (/^\s*[\[{"]|^\s*(null|true|false)\s*$/.test(raw)) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('密钥 JSON 格式无效，请使用字符串数组或每行一个密钥');
    }
    values = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { keys?: unknown }).keys)
        ? (data as { keys: unknown[] }).keys
        : [data];
  } else {
    values = raw.split(/[\n,;\t]+/);
  }
  const normalized = values
    .map((value) => {
      const key =
        typeof value === 'string'
          ? value
          : value && typeof value === 'object'
            ? ((value as Record<string, unknown>).key ?? (value as Record<string, unknown>).apiKey)
            : undefined;
      if (typeof key !== 'string') throw new Error('密钥条目需要字符串或包含 key / apiKey 的对象');
      return key
        .trim()
        .replace(/^Bearer\s+/i, '')
        .replace(/^['"]|['"]$/g, '')
        .trim();
    })
    .filter(Boolean);
  if (!normalized.length) throw new Error('没有找到可导入的密钥');
  return [...new Set(normalized)];
}
export function KeysEditor({
  keys,
  onChange,
}: {
  keys: string[];
  onChange: (keys: string[]) => void;
}) {
  const [raw, setRaw] = useState('');
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const importKeys = (text: string) => {
    onChange([...new Set([...keys, ...parseKeys(text)])]);
    setError('');
    setRaw('');
    setExpanded(false);
  };
  return (
    <div className="keys-editor">
      <div className="field-label">
        <span>
          <KeyRound size={14} /> API 密钥 <small>{keys.length} 个 · 轮询使用</small>
        </span>
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          <Plus size={13} />
          批量导入
        </button>
      </div>
      {keys.length > 0 && (
        <div className="key-list">
          {keys.map((key, i) => (
            <div className="key-row" key={key}>
              <span className="key-index">{String(i + 1).padStart(2, '0')}</span>
              <code>
                {show
                  ? key
                  : key.length > 12
                    ? `${key.slice(0, 5)}${'•'.repeat(16)}${key.slice(-4)}`
                    : '•'.repeat(16)}
              </code>
              <IconButton
                label="移除此密钥"
                onClick={() => onChange(keys.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
          <button className="text-button muted" onClick={() => setShow(!show)}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? '隐藏密钥' : '显示密钥'}
          </button>
        </div>
      )}
      {(!keys.length || expanded) && (
        <>
          <textarea
            aria-label="批量密钥"
            className={cx('key-input', !show && 'secret-input')}
            rows={3}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'粘贴多个密钥，每行一个\n也支持逗号分隔或 JSON 数组'}
          />
          <div className="row between">
            <button className="text-button" onClick={() => input.current?.click()}>
              从 TXT / JSON 导入
            </button>
            <button
              className="button small"
              disabled={!raw.trim()}
              onClick={() => {
                try {
                  importKeys(raw);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Plus size={13} />
              导入密钥
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="approval-hint" role="alert">
          {error}
        </p>
      )}
      <input
        hidden
        type="file"
        ref={input}
        accept=".txt,.json"
        onChange={async (e) => {
          try {
            const file = e.target.files?.[0];
            if (file) importKeys(await file.text());
          } catch (error) {
            setError((error as Error).message);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}

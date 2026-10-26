// Provider form and model manager ported from lumen-utools/src/Settings.tsx.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  ChevronDown,
  CloudDownload,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react';
import type { ModelConfig, Provider as StoredProvider, Settings } from '@livra/shared';
import { matchModel } from '@livra/shared';
import { api, post } from './api';
import { Field, IconButton, Modal } from './ui';
import { CapabilityTags, KeysEditor } from './ProviderControls';
import ReasoningLevelsInput from './ReasoningLevelsInput';
import './providers.css';
type Provider = StoredProvider & {
  keys: string[];
  availableModels: string[];
  modelConfigs: Record<string, ModelConfig>;
  enabled: boolean;
};
type ProviderPatch = Partial<Provider> | ((current: Provider) => Partial<Provider>);
const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');
function normalizeProvider(p: StoredProvider): Provider {
  const configs = { ...p.modelConfigs };
  for (const [id, context] of Object.entries(p.contextWindows || {}))
    if (!configs[id]) configs[id] = { context, source: '自定义' };
  return {
    ...p,
    keys: p.keys ?? (p.apiKey ? [p.apiKey] : []),
    availableModels: p.availableModels || [],
    modelConfigs: configs,
    enabled: p.enabled !== false,
  };
}
const newProvider = (): Provider => ({
  id: crypto.randomUUID(),
  name: '自定义供应商',
  baseUrl: '',
  protocol: 'openai',
  kind: 'chat',
  keys: [],
  models: [],
  availableModels: [],
  modelConfigs: {},
  enabled: true,
  defaultEffort: 'auto',
});
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={cx('toggle', checked && 'on')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function ProviderSettings({
  settings,
  onChange,
  notify,
}: {
  settings: Settings;
  onChange: (update: (current: Settings) => Settings) => void;
  notify: (message: string) => void;
}) {
  const [selected, setSelected] = useState(settings.providers[0]?.id || '');
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const busyRef = useRef(false);
  const raw = settings.providers.find((p) => p.id === selected) || settings.providers[0];
  const provider = raw ? normalizeProvider(raw) : undefined;
  const update = (patch: Partial<Settings>) => onChange((current) => ({ ...current, ...patch }));
  const patchProvider: (patch: ProviderPatch) => void = (patch) => {
    if (!provider) return;
    const id = provider.id;
    onChange((current) => {
      const existing = current.providers.find((p) => p.id === id);
      if (!existing) return current;
      const latest = normalizeProvider(existing);
      const changes = typeof patch === 'function' ? patch(latest) : patch;
      const next = { ...latest, ...changes };
      // Unedited saved keys stay private until their local read finishes.
      if (!existing.keys && !existing.apiKey && existing.hasKey && !('keys' in changes)) {
        delete (next as StoredProvider).keys;
      } else if ('keys' in changes) next.apiKey = next.keys[0] || '';
      const providers = current.providers.map((p) => (p.id === id ? next : p));
      const result = { ...current, providers };
      for (const [kind, providerKey, modelKey] of [
        ['chat', 'defaultProvider', 'defaultModel'],
        ['image', 'imageProvider', 'imageModel'],
        ['music', 'musicProvider', 'musicModel'],
        ['speech', 'speechProvider', 'speechModel'],
      ] as const) {
        if (result[providerKey] === id && (next.kind !== kind || !next.enabled)) {
          result[providerKey] = '';
          result[modelKey] = '';
        }
        if (
          next.kind === kind &&
          next.enabled &&
          (!result[providerKey] ||
            (result[providerKey] === id && !next.models.includes(result[modelKey])))
        ) {
          result[providerKey] = id;
          result[modelKey] = next.models[0] || '';
        }
      }
      return result;
    });
  };
  useEffect(() => {
    if (!raw || raw.keys !== undefined || !raw.hasKey) return;
    let live = true;
    setLoadError('');
    api<{ keys: string[] }>(`/providers/${raw.id}/keys`)
      .then(({ keys }) => {
        if (live) patchProvider((latest) => ({ keys: latest.keys.length ? latest.keys : keys }));
      })
      .catch((error) => {
        if (live) setLoadError((error as Error).message);
      });
    return () => {
      live = false;
    };
  }, [raw?.id, raw?.keys !== undefined, raw?.hasKey]);
  const run = async (id: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(id);
    setLoadError('');
    try {
      await operation();
    } catch (error) {
      setLoadError((error as Error).message);
      notify((error as Error).message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };
  return (
    <div className="providers-settings">
      <p className="section-description">连接你信任的供应商，把常用模型放进启动列表。</p>
      {loadError && (
        <p role="alert" className="error-box">
          {loadError}，已选模型和手动配置会保留。
        </p>
      )}
      <div className="provider-layout">
        <aside className="provider-list">
          {settings.providers.map((p) => (
            <button
              key={p.id}
              className={cx('provider-card', p.id === provider?.id && 'active')}
              onClick={() => setSelected(p.id)}
            >
              <span className="provider-avatar">{p.name[0] || 'P'}</span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.models.length} 个启动模型</small>
              </span>
              <i className={cx('status-dot', p.enabled !== false && 'online')} />
            </button>
          ))}
          <button
            className="add-provider"
            onClick={() => {
              const p = newProvider();
              update({ providers: [...settings.providers, p] });
              setSelected(p.id);
            }}
          >
            <Plus size={16} />
            添加供应商
          </button>
        </aside>
        {provider ? (
          <div className="provider-editor" key={provider.id}>
            <div className="row between">
              <h3>{provider.name}</h3>
              <div className="row gap">
                <span className="muted text-xs">启用</span>
                <Toggle
                  label="启用供应商"
                  checked={provider.enabled}
                  onChange={(enabled) => patchProvider({ enabled })}
                />
                <IconButton label="移除供应商" onClick={() => setDeleteId(provider.id)}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
            <div className="form-grid">
              <Field label="名称">
                <input
                  value={provider.name}
                  onChange={(e) => patchProvider({ name: e.target.value })}
                  placeholder="例如：我的模型网关"
                />
              </Field>
              <Field label="接口协议">
                <select
                  aria-label="接口协议"
                  value={provider.protocol}
                  onChange={(e) =>
                    patchProvider({
                      protocol: e.target.value as Provider['protocol'],
                    })
                  }
                >
                  <option value="openai">
                    OpenAI 兼容{provider.kind === 'chat' ? ' · Chat' : ''}
                  </option>
                  {provider.kind === 'chat' && (
                    <>
                      <option value="responses">OpenAI · Responses</option>
                      <option value="anthropic">Anthropic · Messages</option>
                    </>
                  )}
                  {['chat', 'image'].includes(provider.kind) && (
                    <option value="gemini">Google · Gemini</option>
                  )}
                  {provider.kind === 'speech' && <option value="fish">Fish Audio</option>}
                </select>
              </Field>
            </div>
            <Field
              label="API 地址"
              hint="填写 API 根地址，例如 https://你的网关/v1；Gemini 原生通常以 /v1beta 结尾。"
            >
              <input
                aria-label="API 地址"
                placeholder="https://api.example.com/v1"
                value={provider.baseUrl}
                onChange={(e) => patchProvider({ baseUrl: e.target.value.trim() })}
              />
            </Field>
            <KeysEditor
              key={provider.id}
              keys={provider.keys}
              onChange={(keys) => patchProvider({ keys })}
            />
            <div className="provider-default">
              <Field
                label="默认推理强度"
                hint="会话的「自动」继承此设置；这里选 auto 时不发送参数。"
              >
                <input
                  list="efforts"
                  value={provider.defaultEffort || 'auto'}
                  onChange={(e) => patchProvider({ defaultEffort: e.target.value })}
                  placeholder="auto / high / 自定义值"
                />
              </Field>
            </div>
            <Field label="用途">
              <select
                value={provider.kind}
                onChange={(e) =>
                  patchProvider({
                    kind: e.target.value as Provider['kind'],
                    ...((provider.protocol === 'fish' && e.target.value !== 'speech') ||
                    (['music', 'speech'].includes(e.target.value) &&
                      provider.protocol !== 'fish') ||
                    (e.target.value === 'image' &&
                      !['openai', 'gemini'].includes(provider.protocol))
                      ? { protocol: 'openai' as const }
                      : {}),
                  })
                }
              >
                <option value="chat">对话 / Agent</option>
                <option value="image">图像生成</option>
                <option value="music">音乐生成</option>
                <option value="speech">语音合成</option>
              </select>
            </Field>
            {provider.protocol === 'fish' && (
              <p className="info-box">音色 reference_id 在声音或人偶设置中填写。</p>
            )}
            <ModelManager
              provider={provider}
              onChange={patchProvider}
              notify={notify}
              run={run}
              busy={busy}
            />
          </div>
        ) : (
          <div className="settings-empty">
            <Waypoints size={36} />
            <h3>接入第一个供应商</h3>
            <p>支持你的 API、中转网关和本地模型。</p>
            <button
              className="button primary"
              onClick={() => {
                const p = newProvider();
                update({ providers: [p] });
                setSelected(p.id);
              }}
            >
              <Plus size={15} />
              添加供应商
            </button>
          </div>
        )}
      </div>
      <datalist id="efforts">
        {['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      {deleteId && (
        <Modal title="移除这个供应商？" onClose={() => setDeleteId('')}>
          <div className="modal-body">
            <p>历史聊天会保留，供应商和密钥将从设置移除。</p>
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setDeleteId('')}>
              取消
            </button>
            <button
              className="button danger"
              onClick={() => {
                onChange((current) => {
                  const next = {
                    ...current,
                    providers: current.providers.filter((p) => p.id !== deleteId),
                  };
                  for (const [p, m] of [
                    ['defaultProvider', 'defaultModel'],
                    ['imageProvider', 'imageModel'],
                    ['musicProvider', 'musicModel'],
                    ['speechProvider', 'speechModel'],
                    ['speechSummaryProvider', 'speechSummaryModel'],
                  ] as const)
                    if (next[p] === deleteId) {
                      next[p] = '';
                      next[m] = '';
                    }
                  return next;
                });
                setDeleteId('');
              }}
            >
              移除供应商
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ModelManager({
  provider: p,
  onChange,
  notify,
  run,
  busy,
}: {
  provider: Provider;
  onChange: (p: ProviderPatch) => void;
  notify: (text: string) => void;
  run: (id: string, fn: () => Promise<void>) => Promise<void>;
  busy: string;
}) {
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [editing, setEditing] = useState('');
  const [visible, setVisible] = useState(120);
  const [marquee, setMarquee] = useState(false);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    initial: string[];
    moved: boolean;
  } | null>(null);
  const all = useMemo(
    () => [...new Set([...p.models, ...p.availableModels])].sort((a, b) => a.localeCompare(b)),
    [p.models, p.availableModels],
  );
  const filtered = all.filter((id) => id.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string) =>
    onChange({
      models: p.models.includes(id) ? p.models.filter((m) => m !== id) : [...p.models, id],
    });
  const match = async (ids: string[]) => {
    const catalog = await api<Record<string, unknown>>('/model-catalog');
    let count = 0;
    const next: Record<string, ModelConfig> = {};
    for (const id of ids) {
      const result = matchModel(id, catalog);
      if (result) {
        count++;
        next[id] = result;
      }
    }
    return { configs: next, count };
  };
  const mergeMatches = (latest: Provider, matches: Record<string, ModelConfig>) => ({
    ...latest.modelConfigs,
    ...Object.fromEntries(
      Object.entries(matches).filter(([id]) => latest.modelConfigs[id]?.source !== '自定义'),
    ),
  });
  const currentChange = useRef(onChange);
  currentChange.current = onChange;
  const startupIds = p.models.join('\0');
  useEffect(() => {
    let live = true;
    const ids = p.models.filter((id) => !p.modelConfigs[id]?.source);
    if (ids.length)
      void api<Record<string, unknown>>('/model-catalog')
        .then((catalog) => {
          if (!live) return;
          const matches = Object.fromEntries(
            ids.map((id) => [id, matchModel(id, catalog)]).filter(([, config]) => config),
          ) as Record<string, ModelConfig>;
          if (Object.keys(matches).length)
            currentChange.current((latest) => ({
              modelConfigs: {
                ...latest.modelConfigs,
                ...Object.fromEntries(
                  Object.entries(matches).filter(([id]) => !latest.modelConfigs[id]?.source),
                ),
              },
            }));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [p.id, startupIds]);
  const patchConfig = (id: string, patch: Partial<ModelConfig>) =>
    onChange({
      modelConfigs: {
        ...p.modelConfigs,
        [id]: { ...p.modelConfigs[id], ...patch, source: '自定义' },
      },
    });
  const config = editing ? p.modelConfigs[editing] || {} : null;
  return (
    <div className="model-manager">
      <div className="row between wrap">
        <div>
          <h3>
            启动模型 <span className="count-badge">{p.models.length}</span>
          </h3>
          <p className="sub-description">勾选后，即可在聊天中切换。</p>
        </div>
        <div className="row gap">
          <button
            className="button small"
            disabled={!!busy || !p.baseUrl}
            onClick={() =>
              void run('models', async () => {
                const { models: ids } = await post<{ models: string[] }>('/providers/models', {
                  provider: p,
                });
                onChange({ availableModels: ids });
                notify(`已拉取 ${ids.length} 个模型`);
                try {
                  const result = await match([...new Set([...p.models, ...ids])]);
                  onChange((latest) => ({
                    availableModels: ids,
                    modelConfigs: mergeMatches(latest, result.configs),
                  }));
                } catch {
                  notify('模型已拉取；能力目录暂不可用，可手动设置');
                }
              })
            }
          >
            {busy === 'models' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <CloudDownload size={14} />
            )}
            拉取模型
          </button>
          <button
            className="button small"
            disabled={!!busy || !all.length}
            onClick={() =>
              void run('match', async () => {
                const result = await match(all);
                onChange((latest) => ({
                  modelConfigs: mergeMatches(latest, result.configs),
                }));
                notify(`匹配到 ${result.count} / ${all.length} 个模型，手动配置已保留`);
              })
            }
          >
            {busy === 'match' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            智能匹配
          </button>
        </div>
      </div>
      {p.models.length > 0 && (
        <div className="selected-models">
          {p.models.map((id) => (
            <span key={id} className="model-chip">
              <button onClick={() => setEditing(editing === id ? '' : id)}>{id}</button>
              <IconButton label={`移除 ${id}`} onClick={() => toggle(id)}>
                <X size={11} />
              </IconButton>
            </span>
          ))}
        </div>
      )}
      {all.length > 0 && (
        <>
          <div className="model-list-toolbar">
            <input
              aria-label="筛选模型"
              placeholder={`筛选 ${all.length} 个模型…`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(120);
              }}
            />
            <button
              className="text-button"
              onClick={() => onChange({ models: [...new Set([...p.models, ...filtered])] })}
            >
              <CheckCheck size={14} />
              全选筛选结果
            </button>
            <IconButton
              label="拖动框选模型"
              className={cx(marquee && 'selected')}
              onClick={() => setMarquee(!marquee)}
            >
              <SquareDashedMousePointer size={16} />
            </IconButton>
          </div>
          <div
            className={cx('model-grid', marquee && 'marquee-mode')}
            ref={grid}
            onPointerDown={(e) => {
              if (!marquee || !grid.current) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const bounds = grid.current.getBoundingClientRect();
              drag.current = {
                x: e.clientX - bounds.left + grid.current.scrollLeft,
                y: e.clientY - bounds.top + grid.current.scrollTop,
                initial: e.shiftKey ? p.models : [],
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              if (!drag.current || !grid.current) return;
              const bounds = grid.current.getBoundingClientRect();
              const start = drag.current;
              const x = e.clientX - bounds.left + grid.current.scrollLeft,
                y = e.clientY - bounds.top + grid.current.scrollTop;
              const r = {
                left: Math.min(start.x, x),
                top: Math.min(start.y, y),
                width: Math.abs(x - start.x),
                height: Math.abs(y - start.y),
              };
              start.moved = start.moved || r.width + r.height > 5;
              if (!start.moved) return;
              setRect(r);
              const ids = [...grid.current.querySelectorAll<HTMLElement>('[data-model]')]
                .filter((el) => {
                  const b = el.getBoundingClientRect();
                  return (
                    b.right >= bounds.left + r.left - grid.current!.scrollLeft &&
                    b.left <= bounds.left + r.left + r.width - grid.current!.scrollLeft &&
                    b.bottom >= bounds.top + r.top - grid.current!.scrollTop &&
                    b.top <= bounds.top + r.top + r.height - grid.current!.scrollTop
                  );
                })
                .map((el) => el.dataset.model!);
              onChange({ models: [...new Set([...start.initial, ...ids])] });
            }}
            onPointerUp={() => {
              drag.current = null;
              setRect(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setRect(null);
            }}
          >
            {filtered.slice(0, visible).map((id) => (
              <div
                key={id}
                data-model={id}
                className={cx('model-row', p.models.includes(id) && 'checked')}
              >
                <button
                  role="checkbox"
                  aria-checked={p.models.includes(id)}
                  aria-label={`启动 ${id}`}
                  onClick={() => {
                    if (!marquee) toggle(id);
                  }}
                >
                  <span className="checkbox">{p.models.includes(id) && <Check size={11} />}</span>
                  <span className="model-row-label">
                    {id}
                    <CapabilityTags config={p.modelConfigs[id] || {}} />
                  </span>
                </button>
                <IconButton
                  label={`配置 ${id}`}
                  onClick={() => setEditing(editing === id ? '' : id)}
                >
                  <Settings2 size={13} />
                </IconButton>
              </div>
            ))}
            {!filtered.length && <p className="empty-inline">没有匹配的模型。</p>}
            {rect && <div className="selection-marquee" style={rect} />}
          </div>
          {filtered.length > visible && (
            <button className="text-button" onClick={() => setVisible((v) => v + 120)}>
              显示更多（还有 {filtered.length - visible} 个）
              <ChevronDown size={13} />
            </button>
          )}
          {marquee && (
            <small className="muted">拖动框选；按住 Shift 追加选择。再次点击框选按钮退出。</small>
          )}
        </>
      )}
      <Field label="手动添加模型" hint="输入模型 ID，回车添加到启动列表；支持逗号或换行分隔。">
        <input
          aria-label="手动添加模型"
          value={manual}
          list={`model-suggestions-${p.id}`}
          placeholder="输入模型 ID…"
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            const ids = manual
              .split(/[,，\n]+/)
              .map((id) => id.trim())
              .filter(Boolean);
            if (!ids.length) return;
            onChange((latest) => ({
              models: [...new Set([...latest.models, ...ids])],
              availableModels: [...new Set([...latest.availableModels, ...ids])],
            }));
            setManual('');
          }}
        />
      </Field>
      <datalist id={`model-suggestions-${p.id}`}>
        {all.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {editing && config && (
        <div className="model-config">
          <div className="row between">
            <h4>{editing}</h4>
            <IconButton label="收起模型配置" onClick={() => setEditing('')}>
              <X size={14} />
            </IconButton>
          </div>
          <p className="sub-description">
            {config.matchedId
              ? `已匹配 ${config.matchedId} · ${config.source}`
              : '未匹配到目录，可按上游文档手动配置。'}
          </p>
          {config.output && (
            <p className="sub-description">目录最大输出：{config.output.toLocaleString()} Token</p>
          )}
          <div className="config-toggles">
            {(
              [
                { key: 'vision', label: '视觉输入' },
                { key: 'reasoning', label: '推理思考' },
                { key: 'tools', label: '工具调用' },
              ] as const
            ).map((t) => (
              <div key={t.key}>
                <span>{t.label}</span>
                <select
                  aria-label={t.label}
                  value={config[t.key] === undefined ? 'auto' : String(config[t.key])}
                  onChange={(e) =>
                    patchConfig(editing, {
                      [t.key]: e.target.value === 'auto' ? undefined : e.target.value === 'true',
                    })
                  }
                >
                  <option value="auto">未指定</option>
                  <option value="true">支持</option>
                  <option value="false">不支持</option>
                </select>
              </div>
            ))}
          </div>
          <div className="form-grid">
            <Field label="支持的推理档位" hint="逗号、分号或回车分隔，支持中文标点。">
              <ReasoningLevelsInput
                key={`${p.id}:${editing}`}
                value={config.levels}
                onChange={(levels) => patchConfig(editing, { levels })}
              />
            </Field>
            <Field label="推理参数形式">
              <select
                value={config.reasoningMode || 'effort'}
                onChange={(e) =>
                  patchConfig(editing, {
                    reasoningMode: e.target.value as ModelConfig['reasoningMode'],
                  })
                }
              >
                <option value="effort">effort · 强度档位</option>
                <option value="toggle">toggle · 开启/关闭</option>
                <option value="budget">budget · 思考预算</option>
              </select>
            </Field>
            <Field label="上下文窗口">
              <input
                type="number"
                min="1"
                placeholder="例如 128000"
                value={config.context || ''}
                onChange={(e) =>
                  patchConfig(editing, {
                    context: Number(e.target.value) || undefined,
                  })
                }
              />
            </Field>
            <Field label="最大输出 Token">
              <input
                type="number"
                min="128"
                max="1000000"
                placeholder="默认 8192"
                value={config.maxTokens || ''}
                onChange={(e) =>
                  patchConfig(editing, {
                    maxTokens: Number(e.target.value) || undefined,
                  })
                }
              />
            </Field>
            <Field label="温度（可留空）">
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature ?? ''}
                placeholder="跟随上游默认"
                onChange={(e) =>
                  patchConfig(editing, {
                    temperature: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
          <button
            className="text-button"
            onClick={() =>
              void run('match', async () => {
                const raw = await api<Record<string, unknown>>('/model-catalog');
                const result = matchModel(editing, raw);
                if (result)
                  onChange({
                    modelConfigs: { ...p.modelConfigs, [editing]: result },
                  });
                else notify('目录中没有匹配项，请保留手动配置');
              })
            }
          >
            <Sparkles size={13} />
            恢复目录匹配
          </button>
        </div>
      )}
    </div>
  );
}

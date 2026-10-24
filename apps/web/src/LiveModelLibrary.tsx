import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  builtInLiveModels,
  defaultPersonas,
  liveModelCatalog,
  liveModelSchema,
  defaultLiveModelSources,
  liveModelSourceSchema,
  type LiveModel,
  type LiveModelSource,
  type Settings,
} from '@livra/shared';
import { LiveAvatar } from './LiveAvatar';
import { Button, Field, IconButton, Modal, Toggle, Select } from './ui';
import { post } from './api';
import { useLiveModelSources } from './useLiveModelSources';
import type { Notify } from './App';

export function LiveModelLibrary({
  settings,
  selectedUrl,
  saveSettings,
  onChoose,
  onClose,
  notify,
}: {
  settings: Settings;
  selectedUrl?: string;
  saveSettings: (s: Settings) => Promise<Settings>;
  onChoose: (m: LiveModel) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const { results, refresh } = useLiveModelSources(settings.liveModelSources);
  const catalog = liveModelCatalog(settings);
  const urls = new Set(catalog.map((m) => m.live.modelUrl));
  for (const source of settings.liveModelSources)
    for (const model of results[source.id]?.models || []) {
      if (
        source.enabled &&
        !urls.has(model.live.modelUrl) &&
        !catalog.some((m) => m.id === model.id)
      ) {
        catalog.push(model);
        urls.add(model.live.modelUrl);
      }
    }
  const [sourceFilter, setSourceFilter] = useState('all');
  const [managingSources, setManagingSources] = useState(false);
  const [sourceForm, setSourceForm] = useState<LiveModelSource | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [selectedId, setSelectedId] = useState(
    catalog.find((m) => m.live.modelUrl === selectedUrl)?.id || catalog[0].id,
  );
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [adding, setAdding] = useState(false);
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [description, setDescription] = useState(''),
    [source, setSource] = useState('');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [editingId, setEditingId] = useState(''),
    [confirmRemove, setConfirmRemove] = useState(false);
  const [resolved, setResolved] = useState<Record<string, LiveModel>>({});
  const [resolving, setResolving] = useState(false),
    [resolveError, setResolveError] = useState('');
  const [previewStatus, setPreviewStatus] = useState('loading'),
    [resolveAttempt, setResolveAttempt] = useState(0);
  const rows = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const reveal = () =>
      rows.current[selectedId]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    const list = rows.current[selectedId]?.parentElement;
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [selectedId, filter, query]);
  const selected = catalog.find((m) => m.id === selectedId) || catalog[0];
  const saved = (m: LiveModel) => settings.liveModels.some((s) => s.id === m.id);
  const remote = !!selected.sourceId && !saved(selected);
  const resolutionKey = JSON.stringify([
    selected.id,
    selected.sourceName,
    selected.license,
    selected.sourceUrl,
  ]);
  const preview = remote ? resolved[resolutionKey] || selected : selected;
  useEffect(() => {
    setPreviewStatus('loading');
  }, [selected.id]);
  useEffect(() => {
    setResolveError('');
    if (!remote || resolved[resolutionKey]) {
      setResolving(false);
      return;
    }
    const controller = new AbortController();
    setResolving(true);
    void post<LiveModel>('/live-models/resolve', { id: selected.id }, { signal: controller.signal })
      .then((model) => {
        if (!controller.signal.aborted) setResolved((all) => ({ ...all, [resolutionKey]: model }));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResolveError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setResolving(false);
      });
    return () => controller.abort();
  }, [resolutionKey, remote, resolveAttempt]);
  const builtin = (m: LiveModel) => builtInLiveModels.some((b) => b.id === m.id);
  const activeStates = settings.liveModelSources
    .filter((s) => s.enabled && (sourceFilter === 'all' || sourceFilter === s.id))
    .map((s) => results[s.id]);
  const loading =
    filter !== 'custom' && activeStates.some((s) => !s || s.status === 'loading' || s.refreshing);
  const failed = settings.liveModelSources.filter((s) => s.enabled && results[s.id]?.error);
  const filtered = catalog.filter(
    (m) =>
      (filter === 'all' || (filter === 'custom' ? saved(m) : !!m.sourceId)) &&
      (filter !== 'remote' || sourceFilter === 'all' || m.sourceId === sourceFilter) &&
      (m.name + ' ' + m.description + ' ' + (m.sourceName || ''))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (!query && filtered.length && !filtered.some((m) => m.id === selectedId))
      setSelectedId(filtered[0].id);
  }, [filter, sourceFilter, filtered[0]?.id]);
  function openForm(model?: LiveModel) {
    setManagingSources(false);
    setEditingId(model?.id || '');
    setName(model?.name || '');
    setUrl(model?.live.modelUrl || '');
    setDescription(model?.description || '');
    setSource(model?.sourceUrl || '');
    setError('');
    setConfirmRemove(false);
    setAdding(true);
  }
  async function saveModel() {
    const previous = settings.liveModels.find((m) => m.id === editingId);
    const parsed = liveModelSchema.safeParse({
      ...previous,
      id: editingId || crypto.randomUUID(),
      name: name.trim(),
      description,
      sourceUrl: source.trim(),
      live: {
        ...previous?.live,
        modelUrl: url.trim(),
        expressions: previous?.live.expressions || {
          neutral: '',
          happy: '',
          thinking: '',
          concerned: '',
          excited: '',
          calm: '',
        },
      },
    });
    if (!url.trim() || !parsed.success) {
      setError(!url.trim() ? '填写模型地址' : parsed.error!.issues[0].message);
      return;
    }
    const existing = catalog.find(
      (m) => m.id !== editingId && m.live.modelUrl === parsed.data.live.modelUrl,
    );
    if (existing) {
      if (editingId) {
        setError(`该地址已用于「${existing.name}」`);
        return;
      }
      setSelectedId(existing.id);
      setAdding(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveSettings({
        ...settings,
        liveModels: editingId
          ? settings.liveModels.map((m) => (m.id === editingId ? parsed.data : m))
          : [...settings.liveModels, parsed.data],
      });
      setSelectedId(parsed.data.id);
      setAdding(false);
      setName('');
      setUrl('');
      notify(editingId ? '形象库已更新' : '形象已添加，Agent 也可以选用');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function removeModel() {
    setSaving(true);
    setError('');
    try {
      await saveSettings({
        ...settings,
        liveModels: settings.liveModels.filter((m) => m.id !== selectedId),
      });
      setSelectedId(catalog[0].id);
      setConfirmRemove(false);
      notify('形象已从目录移除');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function collect(choose = false) {
    setSaving(true);
    setError('');
    try {
      if (remote)
        await saveSettings({ ...settings, liveModels: [...settings.liveModels, preview] });
      if (choose) onChoose(preview);
      else notify('已收藏到我的形象');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function updateSources(sources: LiveModelSource[]) {
    setSaving(true);
    setSourceError('');
    try {
      await saveSettings({ ...settings, liveModelSources: sources });
      return true;
    } catch (e) {
      setSourceError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function saveSource() {
    const parsed = liveModelSourceSchema.safeParse(sourceForm);
    if (!parsed.success) {
      setSourceError(parsed.error.issues[0].message);
      return;
    }
    const exists = settings.liveModelSources.some((s) => s.id === parsed.data.id);
    if (
      await updateSources(
        exists
          ? settings.liveModelSources.map((s) => (s.id === parsed.data.id ? parsed.data : s))
          : [...settings.liveModelSources, parsed.data],
      )
    )
      setSourceForm(null);
  }
  return (
    <Modal title="形象库" onClose={onClose} wide>
      <div className={`live-library${managingSources || adding ? ' is-editing' : ''}`}>
        <div className="live-library-browse">
          <div className="library-search">
            <Search size={16} />
            <input
              aria-label="搜索人偶形象"
              placeholder="搜索形象、风格…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="library-add-compact"
              aria-label="添加自有形象"
              disabled={saving}
              onClick={() => openForm()}
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="library-filters" role="group" aria-label="形象来源">
            {[
              { id: 'all', label: '全部' },
              { id: 'remote', label: '远端形象' },
              { id: 'custom', label: '我的形象' },
            ].map((f) => (
              <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {filter === 'remote' && (
            <Select
              className="library-source-select"
              aria-label="筛选远端来源"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[
                { value: 'all', label: '全部远端来源' },
                ...settings.liveModelSources
                  .filter((s) => s.enabled)
                  .map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}
          <div className="library-sync-status" role="status" aria-live="polite">
            {loading ? (
              <>
                <LoaderCircle size={13} className="spin" />
                正在同步远端形象
              </>
            ) : (
              <>
                <Globe2 size={13} />
                {settings.liveModelSources.filter((s) => s.enabled).length} 个远端来源
              </>
            )}
            {failed.length > 0 && (
              <button
                onClick={() => {
                  setManagingSources(true);
                  setAdding(false);
                }}
              >
                {' '}
                {failed.length} 个来源需重试
              </button>
            )}
          </div>
          <div className="live-library-list" role="listbox" aria-label="人偶形象列表">
            {loading && (
              <div className="model-skeleton library-skeleton" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <i />
                    <span>
                      <b />
                      <small />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {filtered.map((m, index) => (
              <button
                key={m.id}
                ref={(el) => {
                  rows.current[m.id] = el;
                }}
                role="option"
                aria-selected={m.id === selectedId}
                tabIndex={
                  m.id === selectedId || (!filtered.some((m) => m.id === selectedId) && index === 0)
                    ? 0
                    : -1
                }
                disabled={saving}
                onClick={() => {
                  setSelectedId(m.id);
                  setAdding(false);
                  setManagingSources(false);
                  setConfirmRemove(false);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (
                    !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                      e.key,
                    )
                  )
                    return;
                  e.preventDefault();
                  const next =
                    filtered[
                      e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? filtered.length - 1
                          : (index +
                              (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) +
                              filtered.length) %
                            filtered.length
                    ];
                  setSelectedId(next.id);
                  setAdding(false);
                  setManagingSources(false);
                  setConfirmRemove(false);
                  setError('');
                  rows.current[next.id]?.focus();
                }}
              >
                <span className="shape-initial" aria-hidden="true">
                  {m.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{m.name}</strong>
                  <small>
                    {m.sourceName || (builtin(m) ? 'Live2D 官方示例' : '我的形象')}
                    {m.description ? ' · ' + m.description : ''}
                  </small>
                </span>
                {m.id === selectedId && <Check size={16} />}
              </button>
            ))}
            {!filtered.length && !loading && (
              <p className="library-empty">
                {query
                  ? '没有匹配的形象'
                  : filter === 'remote'
                    ? '启用一个来源，开始发现远端形象'
                    : '在这里收藏或添加自己的形象'}
              </p>
            )}
          </div>
          <button className="library-add" disabled={saving} onClick={() => openForm()}>
            <Plus size={16} />
            添加自有形象
          </button>
        </div>
        <div className="live-library-detail">
          {managingSources ? (
            <div className="library-source-manager">
              <div className="library-form-title">
                <h3>形象来源</h3>
                <IconButton label="返回形象预览" onClick={() => setManagingSources(false)}>
                  <X size={18} />
                </IconButton>
              </div>
              {sourceForm ? (
                <>
                  <Field label="来源名称">
                    <input
                      autoFocus
                      value={sourceForm.name}
                      maxLength={80}
                      onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
                    />
                  </Field>
                  <Field label="目录类型">
                    <Select
                      value={sourceForm.kind}
                      onChange={(value) =>
                        setSourceForm({
                          ...sourceForm,
                          kind: value as LiveModelSource['kind'],
                        })
                      }
                      options={[
                        { value: 'github', label: 'GitHub 模型仓库' },
                        { value: 'static', label: '静态模型目录' },
                      ]}
                    />
                  </Field>
                  <Field
                    label="来源地址"
                    hint={
                      sourceForm.kind === 'github'
                        ? '支持仓库地址，或 tree/版本/子目录地址。'
                        : '填写 model_list.json 地址或其所在目录。'
                    }
                  >
                    <input
                      value={sourceForm.url}
                      placeholder={
                        sourceForm.kind === 'github'
                          ? 'https://github.com/作者/仓库/tree/版本/目录'
                          : 'https://…/model_list.json'
                      }
                      onChange={(e) => setSourceForm({ ...sourceForm, url: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="资源 CDN（可选）"
                    hint="资源使用独立域名时填写；留空则从原来源加载。"
                  >
                    <input
                      value={sourceForm.assetBaseUrl}
                      onChange={(e) =>
                        setSourceForm({ ...sourceForm, assetBaseUrl: e.target.value })
                      }
                      placeholder="https://…/"
                    />
                  </Field>
                  <Field label="使用范围">
                    <input
                      value={sourceForm.license}
                      maxLength={160}
                      onChange={(e) => setSourceForm({ ...sourceForm, license: e.target.value })}
                    />
                  </Field>
                  <Field label="作者或授权页面（可选）">
                    <input
                      value={sourceForm.licenseUrl}
                      onChange={(e) => setSourceForm({ ...sourceForm, licenseUrl: e.target.value })}
                    />
                  </Field>
                  <div className="button-row">
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setSourceForm(null);
                        setSourceError('');
                      }}
                    >
                      取消
                    </Button>
                    <Button variant="primary" busy={saving} onClick={saveSource}>
                      保存来源
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="library-source-intro">
                    从公开模型库发现形象。启用的来源也会提供给 Agent 搜索与选用。
                  </p>
                  {settings.liveModelSources.map((s) => {
                    const result = results[s.id];
                    const busy = result?.status === 'loading' || result?.refreshing;
                    return (
                      <div className="library-source-item" key={s.id}>
                        <Toggle
                          disabled={saving}
                          checked={s.enabled}
                          label={s.name}
                          onChange={(enabled) => {
                            if (!saving)
                              void updateSources(
                                settings.liveModelSources.map((item) =>
                                  item.id === s.id ? { ...item, enabled } : item,
                                ),
                              );
                          }}
                          description={
                            !s.enabled
                              ? '已停用'
                              : busy
                                ? '正在获取目录…'
                                : result?.error
                                  ? result.models.length
                                    ? '正在使用缓存 · 更新失败'
                                    : '暂时未能获取目录'
                                  : `${result?.models.length || 0} 个形象${result?.truncated ? ' · 可缩小来源目录获取更多' : ''}`
                          }
                        />
                        <div className="library-source-actions">
                          <span>{s.license}</span>
                          <IconButton
                            label={`刷新 ${s.name}`}
                            disabled={!s.enabled || busy || saving}
                            onClick={() => void refresh(s.id)}
                          >
                            <RefreshCw size={14} className={busy ? 'spin' : ''} />
                          </IconButton>
                          <IconButton
                            label={`编辑 ${s.name}`}
                            disabled={saving}
                            onClick={() => {
                              setSourceForm(s);
                              setSourceError('');
                            }}
                          >
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton
                            label={`移除来源 ${s.name}`}
                            disabled={saving}
                            onClick={() =>
                              void updateSources(
                                settings.liveModelSources.filter((item) => item.id !== s.id),
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                        {result?.error && s.enabled && (
                          <p className="library-source-error" role="status">
                            {result.error}
                          </p>
                        )}
                        {result?.updatedAt && s.enabled && (
                          <small className="muted">
                            更新于 {new Date(result.updatedAt).toLocaleString()}
                          </small>
                        )}
                      </div>
                    );
                  })}
                  <div className="library-source-buttons">
                    <Button
                      disabled={saving || settings.liveModelSources.length >= 12}
                      onClick={() => {
                        setSourceForm(
                          liveModelSourceSchema.parse({
                            id: 'source-' + crypto.randomUUID().slice(0, 12),
                            name: '我的模型来源',
                            kind: 'github',
                            url: 'https://github.com/',
                          }),
                        );
                        setSourceError('');
                      }}
                    >
                      <Plus size={15} />
                      添加来源
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() =>
                        void updateSources([
                          ...settings.liveModelSources,
                          ...defaultLiveModelSources.filter(
                            (s) => !settings.liveModelSources.some((item) => item.id === s.id),
                          ),
                        ])
                      }
                    >
                      恢复推荐来源
                    </Button>
                  </div>
                </>
              )}
              {sourceError && (
                <p className="error-box" role="alert">
                  {sourceError}
                </p>
              )}
            </div>
          ) : adding ? (
            <div className="library-add-form">
              <div className="library-form-title">
                <h3>{editingId ? '编辑形象' : '添加形象'}</h3>
                <button
                  aria-label="返回形象预览"
                  disabled={saving}
                  onClick={() => setAdding(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <Field label="形象名称">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="为这个形象取个名字"
                  maxLength={80}
                />
              </Field>
              <Field
                label="模型地址"
                hint="Live2D 模型 JSON，可填写本地 /models/ 路径或远端 HTTP(S) 地址。"
              >
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…/model.model3.json"
                />
              </Field>
              <Field label="风格描述">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="让 Agent 按风格找到它"
                  maxLength={500}
                />
              </Field>
              <Field label="来源链接（可选）">
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="作者或授权页面"
                />
              </Field>
              {error && (
                <p className="error-box" role="alert">
                  {error}
                </p>
              )}
              <Button variant="primary" busy={saving} onClick={saveModel}>
                {editingId ? '保存形象' : '添加到形象库'}
              </Button>
            </div>
          ) : (
            <>
              <div className="library-preview">
                {resolving || (remote && !resolved[resolutionKey] && !resolveError) ? (
                  <div className="library-preview-loading" role="status">
                    <LoaderCircle className="spin" size={24} />
                    <span>正在准备形象…</span>
                  </div>
                ) : resolveError ? (
                  <div className="library-preview-loading" role="alert">
                    <span>{resolveError}</span>
                    <Button onClick={() => setResolveAttempt((v) => v + 1)}>重新加载</Button>
                  </div>
                ) : (
                  <LiveAvatar
                    key={selected.id}
                    persona={{
                      ...defaultPersonas[0],
                      id: 'library-preview',
                      name: selected.name,
                      live: preview.live,
                    }}
                    reducedMotion={settings.reducedMotion}
                    onStatus={setPreviewStatus}
                  />
                )}
                <span className="library-preview-source">
                  {selected.sourceName || (builtin(selected) ? 'Live2D 官方示例' : '我的形象')}
                </span>
              </div>
              <div className="library-detail-caption">
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.description}</p>
                  {selected.license && (
                    <a
                      className="library-license"
                      href={selected.licenseUrl || selected.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {selected.license}
                    </a>
                  )}
                </div>
                {selected.sourceUrl && (
                  <a
                    href={selected.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="查看形象来源"
                  >
                    <ExternalLink size={17} />
                  </a>
                )}
              </div>
              {remote && (
                <div className="library-management">
                  <Button
                    variant="ghost"
                    busy={saving}
                    disabled={resolving || !!resolveError || previewStatus !== 'ready'}
                    onClick={() => void collect()}
                  >
                    <Star size={14} />
                    收藏形象
                  </Button>
                  {error && (
                    <p className="error-box" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
              {saved(selected) && (
                <div className="library-management">
                  {confirmRemove ? (
                    <div className="library-remove-confirm">
                      <p>从形象库移除「{selected.name}」？已创建的人偶仍保留当前形象。</p>
                      <div className="button-row">
                        <Button disabled={saving} onClick={() => setConfirmRemove(false)}>
                          取消
                        </Button>
                        <Button variant="danger" busy={saving} onClick={removeModel}>
                          确认移除
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="button-row">
                      <Button variant="ghost" disabled={saving} onClick={() => openForm(selected)}>
                        <Pencil size={14} />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={saving}
                        onClick={() => setConfirmRemove(true)}
                      >
                        <Trash2 size={14} />
                        移除
                      </Button>
                    </div>
                  )}
                  {error && (
                    <p className="error-box" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setManagingSources((v) => !v);
            setAdding(false);
            setSourceForm(null);
          }}
        >
          <Globe2 size={15} />
          管理来源
        </Button>
        <div className="button-row">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            busy={saving}
            disabled={
              adding || managingSources || resolving || !!resolveError || previewStatus !== 'ready'
            }
            onClick={() => void collect(true)}
          >
            使用此形象
          </Button>
        </div>
      </div>
    </Modal>
  );
}

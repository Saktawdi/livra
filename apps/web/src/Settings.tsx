import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Server,
  Palette,
  Globe,
  Volume2,
  Search,
  Database,
  UserRound,
  ArrowUpRight,
  KeyRound,
  Download,
  Upload,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import type { Provider, Settings } from '@livra/shared';
import { providerSchema, settingsSchema, fishModels } from '@livra/shared';
import { api, post, download } from './api';
import { Button, IconButton, Field, Modal, Section, Badge, Select } from './ui';
import { ModelDefault } from './ModelDefault';
import { VoiceSettings } from './VoiceSettings';
import type { Notify } from './App';
import { ModelSkeleton } from './ModelPicker';
import { Appearance } from './Appearance';

export function SettingsPanel({
  settings,
  initialTab,
  saktaEnabled,
  saveSettings,
  onSettings,
  onPreview,
  onClose,
  notify,
  onDesignSkin,
}: {
  settings: Settings;
  initialTab: string;
  saktaEnabled: boolean;
  saveSettings: (s: Settings) => Promise<Settings>;
  onSettings: (s: Settings) => void;
  onPreview: (s: Settings) => void;
  onClose: () => void;
  notify: Notify;
  onDesignSkin: (prompt: string) => void;
}) {
  const [draft, setDraft] = useState(() => settingsSchema.parse(settings)),
    [tab, setTab] = useState(initialTab),
    [saving, setSaving] = useState(false),
    [providerId, setProviderId] = useState(settings.providers[0]?.id || '');
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [loginBusy, setLoginBusy] = useState(false),
    [usage, setUsage] = useState<any[] | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<Settings>) => setDraft((s) => ({ ...s, ...p }));
  useEffect(() => {
    onPreview(draft);
  }, [draft, onPreview]);
  const provider = draft.providers.find((p) => p.id === providerId) || draft.providers[0];
  const tabs = [
    { id: 'models', title: '模型连接', icon: Server },
    { id: 'accounts', title: 'Sakta 账号', icon: UserRound },
    { id: 'appearance', title: '外观与动效', icon: Palette },
    { id: 'language', title: '语言与回复', icon: Globe },
    { id: 'voice', title: '声音', icon: Volume2 },
    { id: 'search', title: '网页搜索', icon: Search },
    { id: 'data', title: '数据与用量', icon: Database },
  ];
  async function save() {
    setSaving(true);
    try {
      await saveSettings(draft);
      notify('偏好设置已保存');
      onClose();
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }
  function removeProvider(id: string) {
    patch({
      providers: draft.providers.filter((p) => p.id !== id),
      ...(draft.defaultProvider === id ? { defaultProvider: '', defaultModel: '' } : {}),
      ...(draft.imageProvider === id ? { imageProvider: '', imageModel: '' } : {}),
      ...(draft.musicProvider === id ? { musicProvider: '', musicModel: '' } : {}),
      ...(draft.speechProvider === id ? { speechProvider: '' } : {}),
      ...(draft.speechSummaryProvider === id
        ? { speechSummaryProvider: '', speechSummaryModel: '' }
        : {}),
    });
  }
  function saveProvider(p: Provider) {
    const providers = draft.providers.some((x) => x.id === p.id)
      ? draft.providers.map((x) => (x.id === p.id ? p : x))
      : [...draft.providers, p];
    const defaults: Partial<Settings> = {};
    if (
      p.kind === 'chat' &&
      (!draft.defaultProvider ||
        (draft.defaultProvider === p.id && !p.models.includes(draft.defaultModel)))
    ) {
      defaults.defaultProvider = p.id;
      defaults.defaultModel = p.models[0] || '';
    }
    if (
      p.kind === 'image' &&
      (!draft.imageProvider ||
        (draft.imageProvider === p.id && !p.models.includes(draft.imageModel)))
    ) {
      defaults.imageProvider = p.id;
      defaults.imageModel = p.models[0] || '';
    }
    if (
      p.kind === 'music' &&
      (!draft.musicProvider ||
        (draft.musicProvider === p.id && !p.models.includes(draft.musicModel)))
    ) {
      defaults.musicProvider = p.id;
      defaults.musicModel = p.models[0] || '';
    }
    if (
      p.kind === 'speech' &&
      (!draft.speechProvider ||
        (draft.speechProvider === p.id && !p.models.includes(draft.speechModel)))
    ) {
      defaults.speechProvider = p.id;
      defaults.speechModel = p.models[0] || 'tts-1';
    }
    if (p.kind !== 'chat' && draft.defaultProvider === p.id) {
      defaults.defaultProvider = '';
      defaults.defaultModel = '';
    }
    if (p.kind !== 'image' && draft.imageProvider === p.id) {
      defaults.imageProvider = '';
      defaults.imageModel = '';
    }
    if (p.kind !== 'music' && draft.musicProvider === p.id) {
      defaults.musicProvider = '';
      defaults.musicModel = '';
    }
    if (p.kind !== 'speech' && draft.speechProvider === p.id) {
      defaults.speechProvider = '';
    }
    patch({ providers, ...defaults });
  }
  return (
    <Modal title="偏好设置" onClose={onClose} wide className="settings-dialog">
      <div className="settings-layout">
        <nav className="settings-nav">
          {tabs.map(({ id, title, icon: Icon }) => (
            <button
              className={tab === id ? 'active' : ''}
              key={id}
              onClick={() => {
                setTab(id);
                if (id === 'data' && !usage)
                  api('/usage')
                    .then(setUsage)
                    .catch((e) => notify(e.message, 'error'));
              }}
            >
              <Icon size={16} />
              {title}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'models' && (
            <>
              <Section title="模型连接" description="选择一个连接直接编辑，完成后统一保存设置。">
                <div className="connections-workspace">
                  <nav className="connections-list" aria-label="模型连接列表">
                    {draft.providers.map((p) => (
                      <button
                        key={p.id}
                        aria-current={provider?.id === p.id ? 'true' : undefined}
                        onClick={() => setProviderId(p.id)}
                      >
                        <span className="connection-monogram">{p.name.slice(0, 1) || 'M'}</span>
                        <span>
                          <strong>{p.name || '未命名连接'}</strong>
                          <small>
                            {p.models.length} 个模型 · {p.protocol}
                          </small>
                        </span>
                      </button>
                    ))}
                    <button
                      className="connection-add"
                      onClick={() => {
                        const next = providerSchema.parse({
                          id: crypto.randomUUID(),
                          name: '我的模型服务',
                          baseUrl: 'https://api.openai.com/v1',
                        });
                        patch({ providers: [...draft.providers, next] });
                        setProviderId(next.id);
                      }}
                    >
                      <Plus size={15} />
                      添加模型连接
                    </button>
                  </nav>
                  {provider ? (
                    <div className="connection-detail">
                      <div className="connection-heading">
                        <h4>{provider.name || '未命名连接'}</h4>
                        <IconButton
                          label={'移除连接 ' + provider.name}
                          onClick={() => removeProvider(provider.id)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                      <ProviderEditor
                        key={provider.id}
                        provider={provider}
                        onChange={saveProvider}
                        notify={notify}
                      />
                    </div>
                  ) : (
                    <div className="connection-empty">
                      <Server size={26} />
                      <h4>连接你的模型服务</h4>
                      <p>从左侧添加连接，填写地址后拉取模型，或手动添加模型 ID。</p>
                    </div>
                  )}
                </div>
              </Section>
              <Section title="默认模型">
                <div className="form-grid">
                  <ModelDefault
                    label="对话模型"
                    kind="chat"
                    draft={draft}
                    providerId={draft.defaultProvider}
                    model={draft.defaultModel}
                    onChange={(id, m) => patch({ defaultProvider: id, defaultModel: m })}
                  />
                  <ModelDefault
                    label="生图模型"
                    kind="image"
                    draft={draft}
                    providerId={draft.imageProvider}
                    model={draft.imageModel}
                    onChange={(id, m) => patch({ imageProvider: id, imageModel: m })}
                  />
                  <ModelDefault
                    label="音乐模型"
                    kind="music"
                    draft={draft}
                    providerId={draft.musicProvider}
                    model={draft.musicModel}
                    onChange={(id, m) => patch({ musicProvider: id, musicModel: m })}
                  />
                </div>
              </Section>
              <Section title="Agent 的执行方式">
                <Field label="需要你的确认时机">
                  <Select
                    value={draft.toolPermission}
                    onChange={(value) =>
                      patch({ toolPermission: value as Settings['toolPermission'] })
                    }
                    options={[
                      {
                        value: 'ask',
                        label: '执行前询问',
                        description: '生成媒体、写入记忆或调用外部工具前，由你确认',
                      },
                      { value: 'auto', label: '自动执行', description: '自动执行人偶已启用的工具' },
                    ]}
                  />
                </Field>
                <p className="setting-note">人偶只会使用你为它启用的工具；执行记录始终可见。</p>
              </Section>
            </>
          )}
          {tab === 'accounts' && (
            <Section
              title="连接 Sakta"
              description="登录你的 Sakta 账号，使用账号可访问的免费模型。账号接入是可选的，BYOK 可以独立使用。"
            >
              {!saktaEnabled ? (
                <p className="info-box">
                  此部署已关闭 Sakta 接入，你可以在「模型连接」中使用自己的服务。
                </p>
              ) : draft.sakta?.connected ? (
                <div className="connected-account">
                  <div className="large-avatar">{draft.sakta.name.slice(0, 1).toUpperCase()}</div>
                  <h3>{draft.sakta.name}</h3>
                  <Badge color="green">Sakta 已登录</Badge>
                  <p className="muted">可用模型按账号权限获取。登录状态过期时，重新登录即可。</p>
                  <Button
                    onClick={async () => {
                      try {
                        const next = await api<Settings>('/auth/sakta', { method: 'DELETE' });
                        setDraft(next);
                        onSettings(next);
                        notify('已退出 Sakta');
                      } catch (e) {
                        notify((e as Error).message, 'error');
                      }
                    }}
                  >
                    <LogOut size={15} />
                    退出登录
                  </Button>
                </div>
              ) : (
                <form
                  className="login-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoginBusy(true);
                    try {
                      const data = await post('/auth/sakta', { username, password });
                      setDraft(data.settings);
                      onSettings(data.settings);
                      setPassword('');
                      notify('Sakta 已登录');
                    } catch (e) {
                      notify((e as Error).message, 'error');
                    } finally {
                      setLoginBusy(false);
                    }
                  }}
                >
                  <Field label="账号或邮箱">
                    <input
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="密码">
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </Field>
                  <Button variant="primary" busy={loginBusy} type="submit">
                    <KeyRound size={15} />
                    登录并连接
                  </Button>
                  <a
                    className="text-link"
                    href="https://api.sakta.top"
                    target="_blank"
                    rel="noreferrer"
                  >
                    前往 Sakta 管理账号
                    <ArrowUpRight size={13} />
                  </a>
                </form>
              )}
            </Section>
          )}
          {tab === 'appearance' && (
            <Appearance settings={draft} patch={patch} notify={notify} onDesign={onDesignSkin} />
          )}
          {tab === 'language' && (
            <>
              <Section title="语言偏好">
                <Field label="界面语言">
                  <Select
                    value={draft.locale}
                    onChange={(value) => patch({ locale: value as Settings['locale'] })}
                    options={[
                      { value: 'zh-CN', label: '简体中文' },
                      { value: 'en', label: 'English' },
                      { value: 'ja', label: '日本語' },
                    ]}
                  />
                </Field>
                <Field
                  label="默认回复语言"
                  hint="auto 跟随用户语言。也可以填写任意语言或表达偏好，例如：简体中文、English、温柔的日语。"
                >
                  <input
                    value={draft.responseLanguage}
                    onChange={(e) => patch({ responseLanguage: e.target.value })}
                    placeholder="auto"
                  />
                </Field>
                <p className="setting-note">
                  每个人偶还可以单独设置回复语言，优先于这里的全局偏好。
                </p>
              </Section>
            </>
          )}
          {tab === 'voice' && <VoiceSettings draft={draft} patch={patch} notify={notify} />}
          {tab === 'search' && (
            <Section title="网页搜索" description="配置服务后，在人偶卡中启用网页搜索。">
              <Field label="搜索服务">
                <Select
                  value={draft.searchEngine}
                  onChange={(value) =>
                    patch({
                      searchEngine: value as Settings['searchEngine'],
                      searchUrl:
                        value === 'anysearch'
                          ? 'https://api.anysearch.com/v1/search'
                          : value === 'tavily'
                            ? 'https://api.tavily.com/search'
                            : '',
                      searchKey: '',
                      hasSearchKey: false,
                    })
                  }
                  options={[
                    {
                      value: 'anysearch',
                      label: 'AnySearch',
                      description: '官方 REST · 支持匿名搜索',
                    },
                    { value: 'searxng', label: 'SearXNG', description: '自部署搜索服务' },
                    { value: 'tavily', label: 'Tavily' },
                  ]}
                />
              </Field>
              <Field
                label="服务地址"
                hint={
                  draft.searchEngine === 'anysearch'
                    ? '默认使用官方 /v1/search，密钥可选。'
                    : draft.searchEngine === 'searxng'
                      ? '例如 https://search.example.com，服务需开启 JSON 输出。'
                      : '填写完整搜索地址，例如 https://api.tavily.com/search。'
                }
              >
                <input
                  type="url"
                  value={draft.searchUrl}
                  onChange={(e) => patch({ searchUrl: e.target.value })}
                  placeholder={
                    draft.searchEngine === 'anysearch'
                      ? 'https://api.anysearch.com/v1/search'
                      : draft.searchEngine === 'searxng'
                        ? 'https://search.example.com'
                        : 'https://api.tavily.com/search'
                  }
                />
              </Field>
              {draft.searchEngine !== 'searxng' && (
                <Field
                  label={draft.searchEngine === 'anysearch' ? '搜索密钥（可选）' : '搜索密钥'}
                  hint={draft.hasSearchKey ? '已保存密钥；不编辑则继续使用。' : undefined}
                >
                  <input
                    type="password"
                    autoComplete="off"
                    value={draft.searchKey || ''}
                    onChange={(e) => patch({ searchKey: e.target.value })}
                  />
                </Field>
              )}
            </Section>
          )}
          {tab === 'data' && (
            <>
              <Section
                title="备份与恢复"
                description="数据和密钥保存在当前浏览器。导出包括人偶、对话、记忆和作品，不含密钥和登录凭据。"
              >
                <div className="button-row">
                  <Button
                    onClick={async () => {
                      try {
                        const data = await api('/export');
                        download(
                          'livra-backup-' + new Date().toISOString().slice(0, 10) + '.json',
                          JSON.stringify(data, null, 2),
                          'application/json',
                        );
                        notify('数据已导出');
                      } catch (e) {
                        notify((e as Error).message, 'error');
                      }
                    }}
                  >
                    <Download size={15} />
                    导出数据
                  </Button>
                  <Button onClick={() => importRef.current?.click()}>
                    <Upload size={15} />
                    导入备份
                  </Button>
                  <input
                    hidden
                    type="file"
                    ref={importRef}
                    accept="application/json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 120_000_000) {
                        notify('备份最大 120 MB', 'error');
                        return;
                      }
                      if (
                        !confirm(
                          '导入将更新当前空间的人偶与偏好，并合并对话和作品。建议先导出当前数据。',
                        )
                      )
                        return;
                      try {
                        await post('/import', JSON.parse(await file.text()));
                        notify('导入完成，正在重新打开空间');
                        location.reload();
                      } catch (e) {
                        notify((e as Error).message, 'error');
                      }
                    }}
                  />
                </div>
              </Section>
              <Section
                title="模型用量"
                description="仅统计本空间 Agent 请求中模型实际返回的用量；未报告用量的请求不计入估算。"
              >
                {usage ? (
                  <>
                    <div className="usage-metrics">
                      <div>
                        <small>总 Tokens</small>
                        <strong>{usage.reduce((s, r) => s + r.total, 0).toLocaleString()}</strong>
                      </div>
                      <div>
                        <small>输入</small>
                        <strong>{usage.reduce((s, r) => s + r.input, 0).toLocaleString()}</strong>
                      </div>
                      <div>
                        <small>输出</small>
                        <strong>{usage.reduce((s, r) => s + r.output, 0).toLocaleString()}</strong>
                      </div>
                    </div>
                    <div className="usage-table">
                      {usage.slice(0, 30).map((r) => (
                        <div key={r.id}>
                          <span>
                            {r.model}
                            <small>{new Date(r.created).toLocaleString()}</small>
                          </span>
                          <strong>{r.total.toLocaleString()}</strong>
                        </div>
                      ))}
                    </div>
                    {!usage.length && <p className="muted">还没有模型报告的用量。</p>}
                  </>
                ) : (
                  <Button
                    onClick={() =>
                      api('/usage')
                        .then(setUsage)
                        .catch((e) => notify(e.message, 'error'))
                    }
                  >
                    查看用量
                  </Button>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <span className="muted">
          {tab === 'accounts'
            ? '账号操作立即生效'
            : tab === 'appearance'
              ? '正在预览 · 保存后保留'
              : '保存后生效'}
        </span>
        <div className="button-row">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" busy={saving} onClick={save}>
            保存设置
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function ProviderEditor({
  provider,
  onChange,
  notify,
}: {
  provider: Provider;
  onChange: (p: Provider) => void;
  notify: Notify;
}) {
  const [p, setP] = useState(provider),
    [modelsText, setModelsText] = useState(provider.models.join('\n')),
    [fetched, setFetched] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(''),
    [filter, setFilter] = useState('');
  const patch = (data: Partial<Provider>) => setP((prev) => ({ ...prev, ...data }));
  const selected = modelsText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  useEffect(() => {
    onChange({ ...p, models: [...new Set(selected)] });
  }, [p, modelsText]);
  const presets = [
    { name: 'OpenAI 兼容', protocol: 'openai', url: 'https://api.openai.com/v1' },
    { name: 'Anthropic', protocol: 'anthropic', url: 'https://api.anthropic.com/v1' },
    { name: 'Gemini', protocol: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
    { name: 'Ollama', protocol: 'openai', url: 'http://localhost:11434/v1' },
    { name: 'Fish Audio', protocol: 'fish', url: 'https://api.fish.audio/v1' },
  ];
  return (
    <section className="provider-editor" aria-label="编辑模型连接">
      <div>
        <div className="preset-row">
          {presets.map((preset) => (
            <button
              key={preset.name}
              onClick={() => {
                const fish = preset.protocol === 'fish';
                patch({
                  protocol: preset.protocol as any,
                  baseUrl: preset.url,
                  name: preset.name,
                  kind: fish
                    ? 'speech'
                    : ['anthropic', 'gemini'].includes(preset.protocol)
                      ? 'chat'
                      : p.kind,
                  models: [],
                });
                setModelsText(fish ? fishModels.slice(0, 2).join('\n') : '');
                setFetched([]);
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="连接名称">
            <input value={p.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="用途">
            <Select
              value={p.kind}
              onChange={(value) =>
                patch({
                  kind: value as Provider['kind'],
                  ...((p.protocol === 'fish' && value !== 'speech') ||
                  (['music', 'speech'].includes(value) && p.protocol !== 'fish')
                    ? { protocol: 'openai' as const }
                    : {}),
                })
              }
              options={[
                { value: 'chat', label: '对话 / Agent' },
                { value: 'image', label: '图像生成' },
                { value: 'music', label: '音乐生成' },
                { value: 'speech', label: '语音合成' },
              ]}
            />
          </Field>
        </div>
        <Field label="接口协议">
          <Select
            value={p.protocol}
            onChange={(value) => patch({ protocol: value as Provider['protocol'] })}
            options={[
              { value: 'openai', label: 'OpenAI 兼容', description: 'Chat / Images / Audio' },
              ...(p.kind === 'speech'
                ? [{ value: 'fish', label: 'Fish Audio', description: '原生语音' }]
                : []),
              ...(p.kind === 'chat'
                ? [
                    { value: 'responses', label: 'OpenAI Responses' },
                    { value: 'anthropic', label: 'Anthropic Messages' },
                  ]
                : []),
              ...(['chat', 'image'].includes(p.kind)
                ? [{ value: 'gemini', label: 'Google Gemini', description: '原生接口' }]
                : []),
            ]}
          />
        </Field>
        <Field
          label="服务地址 Base URL"
          hint="浏览器直接连接此地址，包含版本路径（如 /v1）；服务需允许当前站点跨域访问。"
        >
          <input
            type="url"
            value={p.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </Field>
        <Field
          label="API Key"
          hint={p.hasKey ? '密钥已保存；不编辑则继续使用。' : '支持无密钥的本地服务。'}
        >
          <input
            type="password"
            autoComplete="off"
            value={p.apiKey || ''}
            placeholder={p.hasKey ? '•••••••• 已保存' : 'sk-…'}
            onChange={(e) => patch({ apiKey: e.target.value })}
          />
        </Field>
        {p.hasKey && (
          <button className="text-link" onClick={() => patch({ apiKey: '', hasKey: false })}>
            清除已保存的密钥
          </button>
        )}
        <div className="field-header">
          <strong>可用模型</strong>
          <Button
            busy={loading}
            onClick={async () => {
              setLoading(true);
              setLoadError('');
              try {
                const data = await post('/providers/models', {
                  provider: { ...p, models: selected },
                });
                setFetched(data.models);
                notify(
                  p.protocol === 'fish'
                    ? '已列出 Fish 型号，实际权限以你的账号为准'
                    : `已获取 ${data.models.length} 个模型，勾选需要使用的模型`,
                );
              } catch (e) {
                setLoadError((e as Error).message);
              } finally {
                setLoading(false);
              }
            }}
          >
            <RefreshCw size={13} />
            {p.protocol === 'fish' ? '查看内置型号' : '拉取模型'}
          </Button>
        </div>
        {loading && !fetched.length && <ModelSkeleton />}
        {loadError && (
          <p className="error-box" role="alert">
            {loadError}，可重新拉取；已选模型会保留。
          </p>
        )}
        {fetched.length > 0 && (
          <div className="model-picker">
            <div>
              <input
                placeholder="筛选可用模型…"
                aria-label="筛选可用模型"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button onClick={() => setModelsText(fetched.join('\n'))}>全选</button>
              <button onClick={() => setModelsText('')}>清空</button>
            </div>
            <div>
              {fetched
                .filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
                .map((m) => (
                  <label key={m}>
                    <input
                      type="checkbox"
                      checked={selected.includes(m)}
                      onChange={(e) =>
                        setModelsText(
                          (e.target.checked
                            ? [...selected, m]
                            : selected.filter((x) => x !== m)
                          ).join('\n'),
                        )
                      }
                    />
                    {m}
                  </label>
                ))}
            </div>
          </div>
        )}
        <Field
          label="手动模型列表"
          hint="每行一个模型 ID，也可以用逗号分隔。兼容不支持模型列表的服务。"
        >
          <textarea
            rows={4}
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder={
              p.kind === 'image'
                ? 'gpt-image-1'
                : p.kind === 'music'
                  ? 'your-music-model'
                  : '填写服务提供的模型 ID'
            }
          />
        </Field>
        {p.kind === 'chat' && selected.length > 0 && (
          <details className="context-window-fields">
            <summary>上下文容量（可选）</summary>
            {selected.map((m) => (
              <Field label={m} key={m}>
                <input
                  type="number"
                  min="256"
                  max="10000000"
                  placeholder="以服务商公布的 token 上限为准"
                  value={p.contextWindows?.[m] || ''}
                  onChange={(e) => {
                    const windows = { ...p.contextWindows };
                    if (e.target.value) windows[m] = Number(e.target.value);
                    else delete windows[m];
                    patch({ contextWindows: windows });
                  }}
                />
              </Field>
            ))}
          </details>
        )}
        {p.protocol === 'fish' && (
          <p className="info-box">
            推荐 s2.1-pro。s2.1-pro-free 可用于账号允许的测试额度。音色在「声音」或人偶卡中填写
            reference_id；密钥保存在当前浏览器，请求直接发送给 Fish。
          </p>
        )}
        {p.protocol === 'fish' && /^https:\/\/api\.fish\.audio(?:\/|$)/i.test(p.baseUrl) && (
          <p className="info-box">
            Fish 官方地址目前不允许网页跨域调用。请使用允许跨域的 Fish 兼容地址，或在「声音」中选择
            VITS / 浏览器朗读。
          </p>
        )}
        {p.kind === 'music' && (
          <p className="info-box">
            音乐适配使用 POST /audio/generations，接受 model、prompt、lyrics、duration，并同步返回
            data[0].audio_url、url 或 b64_json。异步音乐服务可通过自定义 HTTP 工具接入。
          </p>
        )}
      </div>
      <p className="connection-selection-count" role="status">
        已选 {new Set(selected).size} 个模型
      </p>
    </section>
  );
}

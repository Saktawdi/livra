import { useRef, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Server,
  Palette,
  Globe,
  Volume2,
  Search,
  Database,
  UserRound,
  Check,
  ArrowUpRight,
  KeyRound,
  Download,
  Upload,
  LogOut,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
} from 'lucide-react';
import type { Provider, Settings } from '@livra/shared';
import { providerSchema, settingsSchema, fishModels } from '@livra/shared';
import { api, post, download } from './api';
import { Button, IconButton, Field, Modal, Section, Toggle, Badge } from './ui';
import type { Notify } from './App';

export function SettingsPanel({
  settings,
  initialTab,
  saktaEnabled,
  saveSettings,
  onSettings,
  onClose,
  notify,
}: {
  settings: Settings;
  initialTab: string;
  saktaEnabled: boolean;
  saveSettings: (s: Settings) => Promise<Settings>;
  onSettings: (s: Settings) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(() => settingsSchema.parse(settings)),
    [tab, setTab] = useState(initialTab),
    [saving, setSaving] = useState(false),
    [provider, setProvider] = useState<Provider | null>(null);
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [loginBusy, setLoginBusy] = useState(false),
    [usage, setUsage] = useState<any[] | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<Settings>) => setDraft((s) => ({ ...s, ...p }));
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
    if (!confirm('移除这个模型连接？已保存的聊天和作品会保留。')) return;
    patch({
      providers: draft.providers.filter((p) => p.id !== id),
      ...(draft.defaultProvider === id ? { defaultProvider: '', defaultModel: '' } : {}),
      ...(draft.imageProvider === id ? { imageProvider: '', imageModel: '' } : {}),
      ...(draft.musicProvider === id ? { musicProvider: '', musicModel: '' } : {}),
      ...(draft.speechProvider === id ? { speechProvider: '' } : {}),
    });
  }
  function saveProvider(p: Provider) {
    const result = providerSchema.safeParse(p);
    if (!result.success) {
      notify(result.error.issues[0].message, 'error');
      return;
    }
    const providers = draft.providers.some((x) => x.id === p.id)
      ? draft.providers.map((x) => (x.id === p.id ? p : x))
      : [...draft.providers, p];
    const defaults: Partial<Settings> = {};
    if (p.kind === 'chat' && !draft.defaultProvider) {
      defaults.defaultProvider = p.id;
      defaults.defaultModel = p.models[0] || '';
    }
    if (p.kind === 'image' && !draft.imageProvider) {
      defaults.imageProvider = p.id;
      defaults.imageModel = p.models[0] || '';
    }
    if (p.kind === 'music' && !draft.musicProvider) {
      defaults.musicProvider = p.id;
      defaults.musicModel = p.models[0] || '';
    }
    if (p.kind === 'speech' && !draft.speechProvider) {
      defaults.speechProvider = p.id;
      defaults.speechModel = p.models[0] || 'tts-1';
    }
    patch({ providers, ...defaults });
    setProvider(null);
  }
  return (
    <Modal title="偏好设置" onClose={onClose} wide>
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
          <div className="settings-nav-foot">
            Livra · 灵伴
            <br />
            <span>v1.0 · 开源，自由生长</span>
          </div>
        </nav>
        <div className="settings-content">
          {tab === 'models' && (
            <>
              <Section title="模型连接">
                <div className="provider-list">
                  {draft.providers.map((p) => (
                    <div className="provider-card" key={p.id}>
                      <div className="provider-icon">
                        <Server size={19} />
                      </div>
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {{ chat: '对话', image: '生图', music: '音乐', speech: '语音' }[p.kind]} ·{' '}
                          {p.protocol} · {p.models.length} 个模型
                        </small>
                      </div>
                      {p.hasKey || p.apiKey ? (
                        <Badge color="green">已连接密钥</Badge>
                      ) : (
                        <Badge>无密钥</Badge>
                      )}
                      <IconButton
                        label={'编辑 ' + p.name}
                        onClick={() => setProvider(structuredClone(p))}
                      >
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label={'移除 ' + p.name} onClick={() => removeProvider(p.id)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <Button
                  className="add-connection"
                  onClick={() =>
                    setProvider(
                      providerSchema.parse({
                        id: crypto.randomUUID(),
                        name: '我的模型服务',
                        baseUrl: 'https://api.openai.com/v1',
                        apiKey: '',
                        models: [],
                      }),
                    )
                  }
                >
                  <Plus size={16} />
                  添加模型连接
                </Button>
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
                  <select
                    value={draft.toolPermission}
                    onChange={(e) => patch({ toolPermission: e.target.value as any })}
                  >
                    <option value="ask">生成媒体、写入记忆或调用外部工具前询问</option>
                    <option value="auto">自动执行人偶已启用的工具</option>
                  </select>
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
                      notify('Sakta 已连接，可以选择免费模型了');
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
            <>
              <Section title="显示模式">
                <div className="theme-options">
                  {[
                    { value: 'light', title: '浅色', icon: Sun },
                    { value: 'dark', title: '深色', icon: Moon },
                    { value: 'system', title: '跟随系统', icon: Monitor },
                  ].map(({ value, title, icon: Icon }) => (
                    <button
                      key={value}
                      className={`theme-option ${value} ${draft.theme === value ? 'selected' : ''}`}
                      onClick={() => patch({ theme: value as any })}
                    >
                      <div className="theme-preview">
                        <span />
                        <span />
                        <span />
                      </div>
                      <span>
                        <Icon size={15} />
                        {title}
                        {draft.theme === value && <Check size={14} />}
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="点缀色">
                <div className="accent-options">
                  {[
                    { value: 'sage', title: '朱砂', color: '#ad4733' },
                    { value: 'iris', title: '鸢尾紫', color: '#9385ac' },
                    { value: 'ocean', title: '雾海蓝', color: '#6b8fa5' },
                    { value: 'rose', title: '玫瑰灰', color: '#b1868f' },
                  ].map((s) => (
                    <button
                      key={s.value}
                      className={draft.accent === s.value ? 'selected' : ''}
                      onClick={() => patch({ accent: s.value as any })}
                    >
                      <span style={{ background: s.color }}>
                        {draft.accent === s.value && <Check size={15} />}
                      </span>
                      {s.title}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="动效偏好">
                <Toggle
                  label="减少动态效果"
                  description="简化过渡与装饰动画，关闭人偶的鼠标跟随。"
                  checked={draft.reducedMotion}
                  onChange={(v) => patch({ reducedMotion: v })}
                />
              </Section>
            </>
          )}
          {tab === 'language' && (
            <>
              <Section title="语言偏好">
                <Field label="界面语言">
                  <select
                    value={draft.locale}
                    onChange={(e) => patch({ locale: e.target.value as Settings['locale'] })}
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                  </select>
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
          {tab === 'voice' && (
            <>
              <Section title="声音" description="支持浏览器朗读、Fish Audio 和 OpenAI 兼容服务。">
                <Toggle
                  label="自动朗读回复"
                  description="伙伴回复完成后，朗读本次内容。浏览器可能需要先进行一次手动播放。"
                  checked={draft.autoSpeak}
                  onChange={(v) => patch({ autoSpeak: v })}
                />
                <ModelDefault
                  label="语音模型"
                  kind="speech"
                  draft={draft}
                  providerId={draft.speechProvider}
                  model={draft.speechModel}
                  onChange={(id, m) => patch({ speechProvider: id, speechModel: m })}
                />
                <div className="form-grid">
                  <Field
                    label="默认音色 ID"
                    hint={
                      draft.providers.find((p) => p.id === draft.speechProvider)?.protocol ===
                      'fish'
                        ? '填写 Fish Audio 音色的 reference_id，留空使用服务默认声音。'
                        : '语音服务的 voice ID 或浏览器声音名称。'
                    }
                  >
                    <input
                      value={draft.speechVoice}
                      onChange={(e) => patch({ speechVoice: e.target.value })}
                      placeholder="留空使用默认声音"
                    />
                  </Field>
                  <Field
                    label="朗读语言"
                    hint="auto 自动识别。可填 zh-CN、en、ja 等；混合语言推荐 auto。"
                  >
                    <input
                      value={draft.speechLanguage}
                      onChange={(e) => patch({ speechLanguage: e.target.value })}
                      placeholder="auto"
                    />
                  </Field>
                  <Field label={'语速 · ' + draft.speechSpeed.toFixed(1) + '×'}>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={draft.speechSpeed}
                      onChange={(e) => patch({ speechSpeed: Number(e.target.value) })}
                    />
                  </Field>
                  {draft.providers.find((p) => p.id === draft.speechProvider)?.protocol ===
                    'fish' && (
                    <Field label="Fish 合成偏好">
                      <select
                        value={draft.speechLatency}
                        onChange={(e) => patch({ speechLatency: e.target.value as any })}
                      >
                        <option value="balanced">均衡 · 较低延迟</option>
                        <option value="normal">音质优先</option>
                      </select>
                    </Field>
                  )}
                </div>
                <p className="setting-note">
                  人偶卡中的音色与朗读语言优先于这里的默认设置。Fish
                  的语言标签用于数字、日期等文本读法，不会改变音色与口音。
                </p>
              </Section>
              <Section title="语音输入">
                <p className="muted">
                  对话输入框的麦克风使用浏览器语音识别。可用性取决于浏览器，输入语言跟随界面语言。
                </p>
              </Section>
            </>
          )}
          {tab === 'search' && (
            <Section title="网页搜索" description="配置服务后，在人偶卡中启用网页搜索。">
              <Field label="搜索服务">
                <select
                  value={draft.searchEngine}
                  onChange={(e) => patch({ searchEngine: e.target.value as any })}
                >
                  <option value="searxng">SearXNG · 自部署</option>
                  <option value="tavily">Tavily</option>
                </select>
              </Field>
              <Field
                label="服务地址"
                hint={
                  draft.searchEngine === 'searxng'
                    ? '例如 https://search.example.com，服务需开启 JSON 输出。'
                    : '填写完整搜索地址，例如 https://api.tavily.com/search。'
                }
              >
                <input
                  type="url"
                  value={draft.searchUrl}
                  onChange={(e) => patch({ searchUrl: e.target.value })}
                  placeholder={
                    draft.searchEngine === 'searxng'
                      ? 'https://search.example.com'
                      : 'https://api.tavily.com/search'
                  }
                />
              </Field>
              {draft.searchEngine === 'tavily' && (
                <Field
                  label="搜索密钥"
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
                description="导出包括人偶、对话、记忆和作品。密钥与登录凭据不会包含在导出文件中。"
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
        <span className="muted">{tab === 'accounts' ? '账号操作立即生效' : '保存后生效'}</span>
        <div className="button-row">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" busy={saving} onClick={save}>
            保存设置
          </Button>
        </div>
      </div>
      {provider && (
        <ProviderEditor
          provider={provider}
          onClose={() => setProvider(null)}
          onSave={saveProvider}
          notify={notify}
        />
      )}
    </Modal>
  );
}
function ModelDefault({
  label,
  kind,
  draft,
  providerId,
  model,
  onChange,
}: {
  label: string;
  kind: Provider['kind'];
  draft: Settings;
  providerId: string;
  model: string;
  onChange: (id: string, m: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={providerId + '|' + model}
        onChange={(e) => {
          const [id, ...m] = e.target.value.split('|');
          onChange(id, m.join('|'));
        }}
      >
        <option value="|">{kind === 'speech' ? '使用浏览器朗读' : '暂未选择'}</option>
        {kind === 'chat' && draft.sakta?.connected && (
          <option value={'sakta|' + (providerId === 'sakta' ? model : '')}>
            Sakta · {providerId === 'sakta' && model ? model : '登录后在对话中选择'}
          </option>
        )}
        {draft.providers
          .filter((p) => p.kind === kind)
          .flatMap((p) =>
            p.models.map((m) => (
              <option key={p.id + m} value={p.id + '|' + m}>
                {p.name} · {m}
              </option>
            )),
          )}
      </select>
    </Field>
  );
}
function ProviderEditor({
  provider,
  onClose,
  onSave,
  notify,
}: {
  provider: Provider;
  onClose: () => void;
  onSave: (p: Provider) => void;
  notify: Notify;
}) {
  const [p, setP] = useState(provider),
    [modelsText, setModelsText] = useState(provider.models.join('\n')),
    [fetched, setFetched] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState('');
  const patch = (data: Partial<Provider>) => setP((prev) => ({ ...prev, ...data }));
  const selected = modelsText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const presets = [
    { name: 'OpenAI 兼容', protocol: 'openai', url: 'https://api.openai.com/v1' },
    { name: 'Anthropic', protocol: 'anthropic', url: 'https://api.anthropic.com/v1' },
    { name: 'Gemini', protocol: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
    { name: 'Ollama', protocol: 'openai', url: 'http://localhost:11434/v1' },
    { name: 'Fish Audio', protocol: 'fish', url: 'https://api.fish.audio/v1' },
  ];
  return (
    <Modal title={provider.hasKey ? '编辑模型连接' : '配置模型连接'} onClose={onClose}>
      <div className="provider-editor modal-body">
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
            <select
              value={p.kind}
              onChange={(e) =>
                patch({
                  kind: e.target.value as any,
                  ...((p.protocol === 'fish' && e.target.value !== 'speech') ||
                  (['music', 'speech'].includes(e.target.value) && p.protocol !== 'fish')
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
        </div>
        <Field label="接口协议">
          <select value={p.protocol} onChange={(e) => patch({ protocol: e.target.value as any })}>
            <option value="openai">OpenAI Chat / Images / Audio 兼容</option>
            {p.kind === 'speech' && <option value="fish">Fish Audio 原生语音</option>}
            {p.kind === 'chat' && (
              <>
                <option value="responses">OpenAI Responses</option>
                <option value="anthropic">Anthropic Messages</option>
              </>
            )}
            {['chat', 'image'].includes(p.kind) && (
              <option value="gemini">Google Gemini 原生</option>
            )}
          </select>
        </Field>
        <Field
          label="服务地址 Base URL"
          hint="包含版本路径，例如 /v1；请求将追加模型或生成功能的路径。"
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
                notify((e as Error).message, 'error');
              } finally {
                setLoading(false);
              }
            }}
          >
            <RefreshCw size={13} />
            {p.protocol === 'fish' ? '查看内置型号' : '拉取模型'}
          </Button>
        </div>
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
        {p.protocol === 'fish' && (
          <p className="info-box">
            推荐 s2.1-pro。s2.1-pro-free 可用于账号允许的测试额度。音色在「声音」或人偶卡中填写
            reference_id；密钥仅保存在后端。
          </p>
        )}
        {p.kind === 'music' && (
          <p className="info-box">
            音乐适配使用 POST /audio/generations，接受 model、prompt、lyrics、duration，并同步返回
            data[0].audio_url、url 或 b64_json。异步音乐服务可通过自定义 HTTP 工具接入。
          </p>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">已选 {selected.length} 个模型</span>
        <div className="button-row">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={() => onSave({ ...p, models: [...new Set(selected)] })}
          >
            确认连接
          </Button>
        </div>
      </div>
    </Modal>
  );
}

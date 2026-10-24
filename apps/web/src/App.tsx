import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import {
  Plus,
  Search,
  SlidersHorizontal,
  MessageCircle,
  Users,
  WandSparkles,
  Shapes,
  Grid2X2,
  PanelLeftOpen,
  ChevronDown,
  Sun,
  Moon,
  X,
  Check,
  ChevronRight,
  CircleHelp,
} from 'lucide-react';
import type {
  Settings,
  Conversation,
  Persona,
  LiveState,
  Mood,
  Message,
  Attachment,
  AgentEvent,
} from '@livra/shared';
import { api, post, put, streamRun, ApiError } from './api';
import { CommandMenu, type Command } from './CommandMenu';
import { MoreHorizontal, Pin, Trash2, Settings2 } from 'lucide-react';
import { dictionaries } from './i18n';
import { Button, IconButton, Field, Modal } from './ui';
import { Chat } from './Chat';
const SettingsPanel = lazy(() => import('./Settings').then((m) => ({ default: m.SettingsPanel })));
const PersonaLibrary = lazy(() =>
  import('./Personas').then((m) => ({ default: m.PersonaLibrary })),
);
const Studio = lazy(() => import('./Studio').then((m) => ({ default: m.Studio })));
const Tools = lazy(() => import('./Tools').then((m) => ({ default: m.Tools })));
const Gallery = lazy(() => import('./Gallery').then((m) => ({ default: m.Gallery })));
export type Notify = (message: string, kind?: 'error' | 'success') => void;
type View = 'chat' | 'personas' | 'studio' | 'tools' | 'gallery';
export type Approval = { id: string; runId: string; name: string; args: any };

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState(''),
    [locked, setLocked] = useState(false),
    [access, setAccess] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [personaId, setPersonaId] = useState('lumi');
  const [view, setView] = useState<View>('chat'),
    [settingsTab, setSettingsTab] = useState<string | null>(null),
    [sidebar, setSidebar] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false),
    [editingHistory, setEditingHistory] = useState<Conversation | null>(null),
    [historyTitle, setHistoryTitle] = useState(''),
    [personaToEdit, setPersonaToEdit] = useState(''),
    [pendingPrompt, setPendingPrompt] = useState('');
  const [smallScreen, setSmallScreen] = useState(() => matchMedia('(max-width:720px)').matches),
    sidebarRef = useRef<HTMLElement>(null);
  const [saktaEnabled, setSaktaEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [liveState, setLiveState] = useState<LiveState>('idle'),
    [mood, setMood] = useState<Mood>('neutral');
  const [approvals, setApprovals] = useState<Approval[]>([]),
    [artifactEpoch, setArtifactEpoch] = useState(0),
    [toast, setToast] = useState<{ message: string; kind: string } | null>(null);
  const runRef = useRef<{ id: string; controller: AbortController } | null>(null),
    selected = useRef<string | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify: Notify = (message, kind = 'success') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };
  async function bootstrap() {
    setLoading(true);
    setFatal('');
    try {
      const data = await api('/bootstrap');
      setSettings(data.settings);
      setConversations(data.conversations);
      setSaktaEnabled(data.saktaEnabled);
      setLocked(false);
      let savedId = '',
        savedView = '',
        savedPersona = '';
      try {
        savedId = sessionStorage.getItem('livra:conversation') || '';
        savedView = sessionStorage.getItem('livra:view') || '';
        savedPersona = sessionStorage.getItem('livra:persona') || '';
      } catch {}
      if (['chat', 'personas', 'studio', 'tools', 'gallery'].includes(savedView))
        setView(savedView as View);
      if (data.settings.personas.some((p: Persona) => p.id === savedPersona))
        setPersonaId(savedPersona);
      if (savedId && data.conversations.some((c: Conversation) => c.id === savedId)) {
        try {
          const c = await api<Conversation>('/conversations/' + savedId);
          selected.current = c.id;
          setConversation(c);
          setPersonaId(c.personaId);
        } catch {}
      }
    } catch (error) {
      if (error instanceof ApiError && error.locked) setLocked(true);
      else setFatal((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    bootstrap();
    return () => {
      runRef.current?.controller.abort();
    };
  }, []);
  useEffect(() => {
    if (loading) return;
    try {
      if (conversation) sessionStorage.setItem('livra:conversation', conversation.id);
      else sessionStorage.removeItem('livra:conversation');
      sessionStorage.setItem('livra:view', view);
      sessionStorage.setItem('livra:persona', personaId);
    } catch {}
  }, [conversation?.id, view, personaId, loading]);
  useEffect(() => {
    const media = matchMedia('(max-width:720px)');
    const change = () => {
      setSmallScreen(media.matches);
      if (!media.matches) setSidebar(false);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!sidebar || !smallScreen) return;
    const previous = document.activeElement as HTMLElement;
    const el = sidebarRef.current!;
    const items = () =>
      [...el.querySelectorAll<HTMLElement>('button,a[href]')].filter(
        (x) => !x.hasAttribute('disabled'),
      );
    items()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const options = items(),
        first = options[0],
        last = options.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => {
      el.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [sidebar, smallScreen]);
  useEffect(() => {
    if (!settings) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
    };
    apply();
    media.addEventListener('change', apply);
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
    document.documentElement.lang = settings.locale;
    return () => media.removeEventListener('change', apply);
  }, [settings?.theme, settings?.accent, settings?.reducedMotion, settings?.locale]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        newChat();
      }
      if (e.key === 'Escape') setSidebar(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy]);
  const saveSettings = async (value: Settings) => {
    const saved = await put<Settings>('/settings', value);
    setSettings(saved);
    return saved;
  };
  async function refreshHistory() {
    const data = await api('/bootstrap');
    setConversations(data.conversations);
  }
  function newChat(id?: string) {
    if (busy) {
      notify('先停止或等待当前任务完成', 'error');
      return;
    }
    selected.current = null;
    setConversation(null);
    if (id) setPersonaId(id);
    setView('chat');
    setMood('neutral');
    setSidebar(false);
  }
  async function openConversation(id: string) {
    if (busy) {
      notify('先停止或等待当前任务完成', 'error');
      return;
    }
    selected.current = id;
    setView('chat');
    setSidebar(false);
    try {
      const c = await api<Conversation>('/conversations/' + id);
      if (selected.current === id) {
        setConversation(c);
        setPersonaId(c.personaId);
        setMood('neutral');
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function changePersona(id: string) {
    if (busy) {
      notify('任务完成后可以切换伙伴', 'error');
      return;
    }
    if (conversation)
      try {
        const c = await api<Conversation>('/conversations/' + conversation.id, {
          method: 'PATCH',
          body: JSON.stringify({ personaId: id }),
        });
        setConversation(c);
      } catch (e) {
        notify((e as Error).message, 'error');
        return;
      }
    setPersonaId(id);
    setMood('neutral');
  }
  async function send(
    content: string,
    attachments: Attachment[],
    providerId: string,
    model: string,
    reasoning: string,
  ) {
    if (busy || !settings) return false;
    if (!providerId || !model) {
      setSettingsTab('models');
      notify('连接模型后，就能开始对话了');
      return false;
    }
    let c = conversation;
    try {
      if (!c) {
        c = await post<Conversation>('/conversations', { personaId });
        selected.current = c.id;
        setConversation(c);
        setConversations((list) => [c!, ...list]);
      }
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
    const controller = new AbortController();
    runRef.current = { id: '', controller };
    setBusy(true);
    setLiveState('thinking');
    setMood('thinking');
    const user: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      attachments,
      created: Date.now(),
    };
    setConversation((prev) => (prev ? { ...prev, messages: [...prev.messages, user] } : prev));
    let assistantId = '';
    let accepted = false;
    try {
      await streamRun(
        { conversationId: c!.id, providerId, model, content, attachments, reasoning },
        controller.signal,
        (event: AgentEvent) => {
          if (event.type === 'start') {
            accepted = true;
            runRef.current!.id = event.runId;
            assistantId = event.message.id;
            setConversation((prev) =>
              prev ? { ...prev, messages: [...prev.messages, event.message] } : prev,
            );
          }
          if (event.type === 'delta' || event.type === 'reasoning') {
            const key = event.type === 'delta' ? 'content' : 'reasoning';
            if (event.type === 'delta') setLiveState('thinking');
            setConversation((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === assistantId ? { ...m, [key]: (m[key] || '') + event.text } : m,
                    ),
                  }
                : prev,
            );
          }
          if (event.type === 'tool-start') {
            setLiveState('working');
            setConversation((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === assistantId ? { ...m, tools: [...(m.tools || []), event.tool] } : m,
                    ),
                  }
                : prev,
            );
          }
          if (event.type === 'tool-end') {
            setLiveState('thinking');
            setConversation((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === assistantId
                        ? {
                            ...m,
                            tools: m.tools?.map((t) => (t.id === event.tool.id ? event.tool : t)),
                          }
                        : m,
                    ),
                  }
                : prev,
            );
          }
          if (event.type === 'emotion') setMood(event.mood);
          if (event.type === 'approval')
            setApprovals((items) => [
              ...items,
              { id: event.id, runId: event.runId, name: event.name, args: event.args },
            ]);
          if (event.type === 'artifact') setArtifactEpoch((v) => v + 1);
          if (event.type === 'usage')
            setConversation((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === assistantId ? { ...m, usage: event.usage } : m,
                    ),
                  }
                : prev,
            );
          if (event.type === 'error' && !event.cancelled) {
            setLiveState('error');
            notify(event.message, 'error');
          }
        },
      );
    } catch (error) {
      if (!controller.signal.aborted) notify((error as Error).message, 'error');
    } finally {
      setBusy(false);
      setLiveState('idle');
      setMood((m) => (m === 'thinking' ? 'neutral' : m));
      setApprovals([]);
      runRef.current = null;
      try {
        const saved = await api<Conversation>('/conversations/' + c!.id);
        if (selected.current === saved.id) setConversation(saved);
        await refreshHistory();
      } catch {}
    }
    return accepted;
  }
  async function stop() {
    if (runRef.current?.id) await post(`/runs/${runRef.current.id}/stop`, {}).catch(() => {});
    runRef.current?.controller.abort();
  }
  async function approve(item: Approval, allow: boolean) {
    try {
      await post(`/runs/${item.runId}/approvals/${item.id}`, { allow });
      setApprovals((items) => items.filter((x) => x.id !== item.id));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function removeConversation(id: string) {
    if (!confirm('删除这段对话？此操作无法撤销。')) return;
    try {
      await api('/conversations/' + id, { method: 'DELETE' });
      setConversations((items) => items.filter((x) => x.id !== id));
      if (selected.current === id) newChat();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  async function updateHistory(c: Conversation, patch: Partial<Conversation>) {
    try {
      const updated = await api<Conversation>('/conversations/' + c.id, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setConversations((v) => v.map((x) => (x.id === c.id ? updated : x)));
      if (conversation?.id === c.id) setConversation(updated);
      setEditingHistory(null);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  if (loading)
    return (
      <div className="boot-screen">
        <div className="livra-logo">l</div>
        <p role="status">正在打开 Livra…</p>
      </div>
    );
  if (locked)
    return (
      <div className="boot-screen">
        <div className="livra-logo">l</div>
        <h1>进入 Livra</h1>
        <form
          className="access-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await post('/access', { password: access });
              await bootstrap();
            } catch (e) {
              setFatal((e as Error).message);
            }
          }}
        >
          <input
            type="password"
            aria-label="访问密码"
            placeholder="访问密码"
            autoComplete="current-password"
            value={access}
            onChange={(e) => setAccess(e.target.value)}
            required
          />
          <Button variant="primary" type="submit">
            进入
          </Button>
        </form>
        {fatal && (
          <p className="error-text" role="alert">
            {fatal}
          </p>
        )}
      </div>
    );
  if (fatal || !settings)
    return (
      <div className="boot-screen">
        <h1>无法连接</h1>
        <p role="alert">{fatal}</p>
        <Button onClick={bootstrap}>重新连接</Button>
      </div>
    );
  const t = dictionaries[settings.locale],
    persona = settings.personas.find((p) => p.id === personaId) || settings.personas[0];
  const nav = [
    { id: 'chat', label: t.space, icon: MessageCircle },
    { id: 'personas', label: t.personas, icon: Users },
    { id: 'studio', label: t.studio, icon: WandSparkles },
    { id: 'tools', label: t.tools, icon: Shapes },
    { id: 'gallery', label: t.gallery, icon: Grid2X2 },
  ] as const;
  const commands: Command[] = [
    {
      id: 'new',
      title: t.newChat,
      group: '操作',
      hint: 'Ctrl Shift O',
      icon: Plus,
      run: () => newChat(),
    },
    ...nav.map((n) => ({
      id: n.id,
      title: n.label,
      group: '页面',
      icon: n.icon,
      run: () => {
        setView(n.id);
        setSidebar(false);
      },
    })),
    {
      id: 'settings',
      title: '模型与偏好',
      group: '设置',
      icon: Settings2,
      run: () => setSettingsTab('models'),
    },
    ...settings.personas.map((p) => ({
      id: p.id,
      title: p.name,
      hint: p.mode === 'work' ? '工作' : '陪伴',
      group: '人偶',
      icon: Users,
      run: () => {
        setView('chat');
        void changePersona(p.id);
      },
    })),
    ...conversations.map((c) => ({
      id: c.id,
      title: c.title,
      group: '对话',
      icon: MessageCircle,
      run: () => void openConversation(c.id),
    })),
  ];
  return (
    <div className="app-shell">
      {sidebar && <div className="sidebar-backdrop" onClick={() => setSidebar(false)} />}
      <aside
        ref={sidebarRef}
        className={'sidebar ' + (sidebar ? 'open' : '')}
        aria-label="主导航"
        aria-hidden={smallScreen && !sidebar ? true : undefined}
        inert={smallScreen && !sidebar}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('chat');
          }}
          aria-label="Livra 首页"
        >
          <span className="livra-logo">l</span>
          <strong className="brand-wordmark">livra</strong>
          <span className="brand-local">灵伴</span>
        </a>
        <IconButton label="收起侧栏" className="sidebar-close" onClick={() => setSidebar(false)}>
          <X size={19} />
        </IconButton>
        <button className="sidebar-search" onClick={() => setCommandOpen(true)}>
          <Search size={17} />
          <span>快速访问</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button className="new-chat" onClick={() => newChat()}>
          <Plus size={18} />
          {t.newChat}
        </button>
        <nav className="main-nav">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              aria-current={view === id ? 'page' : undefined}
              className={view === id ? 'active' : ''}
              key={id}
              onClick={() => {
                setView(id);
                setSidebar(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="history-heading">
          <span>{t.recent}</span>
          <span>{conversations.length || ''}</span>
        </div>
        <div className="history-list">
          {[...conversations]
            .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated)
            .map((c) => (
              <div
                className={
                  'history-row ' + (selected.current === c.id && view === 'chat' ? 'active' : '')
                }
                key={c.id}
              >
                <button className="history-title" onClick={() => openConversation(c.id)}>
                  {c.pinned ? <Pin size={14} /> : <MessageCircle size={14} />}
                  <span>{c.title}</span>
                </button>
                <IconButton
                  label={'管理对话 ' + c.title}
                  onClick={() => {
                    setEditingHistory(c);
                    setHistoryTitle(c.title);
                  }}
                >
                  <MoreHorizontal size={16} />
                </IconButton>
              </div>
            ))}
          {!conversations.length && <p className="no-history">{t.empty}</p>}
        </div>
        <div className="sidebar-bottom">
          <button className="account-button" onClick={() => setSettingsTab('accounts')}>
            <span className="account-avatar">
              {settings.sakta?.connected ? (
                settings.sakta.name.slice(0, 1).toUpperCase()
              ) : (
                <UserRoundIcon />
              )}
            </span>
            <span>
              <strong>{settings.sakta?.connected ? settings.sakta.name : t.guest}</strong>
              <small>{settings.sakta?.connected ? 'Sakta 已连接' : '本机空间'}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="sidebar-utility">
            <button onClick={() => setSettingsTab('models')}>
              <Settings2 size={17} />
              {t.settings}
            </button>
            <a
              href="https://github.com/Saktawdi/livra"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub 源码"
            >
              <span>↗</span>
            </a>
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={smallScreen && sidebar}>
        <header className="topbar">
          <div>
            <IconButton
              label="展开侧栏"
              className="mobile-menu"
              onClick={() => setSidebar((v) => !v)}
            >
              <PanelLeftOpen size={20} />
            </IconButton>
            <span className="breadcrumb">
              {nav.find((n) => n.id === view)!.label}
              {view === 'chat' && conversation && (
                <>
                  <ChevronRight size={15} />
                  <strong>{conversation.title}</strong>
                </>
              )}
            </span>
          </div>
          <div className="topbar-right">
            <IconButton label="快速访问" onClick={() => setCommandOpen(true)}>
              <Search size={19} />
            </IconButton>
            <IconButton
              label="切换明暗模式"
              onClick={() =>
                saveSettings({
                  ...settings,
                  theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
                }).catch((e) => notify(e.message, 'error'))
              }
            >
              {document.documentElement.dataset.theme === 'dark' ? (
                <Sun size={19} />
              ) : (
                <Moon size={19} />
              )}
            </IconButton>
            <IconButton label={t.settings} onClick={() => setSettingsTab('models')}>
              <SlidersHorizontal size={19} />
            </IconButton>
          </div>
        </header>
        <main className={'main-content view-' + view}>
          <Suspense
            fallback={
              <div className="page-loader" role="status">
                <span className="loading-dot" />
                正在打开…
              </div>
            }
          >
            {view === 'chat' && (
              <Chat
                settings={settings}
                persona={persona}
                conversation={conversation}
                busy={busy}
                liveState={liveState}
                mood={mood}
                approvals={approvals}
                onApprove={approve}
                onSend={send}
                onStop={stop}
                onPersona={changePersona}
                onSettings={() => setSettingsTab('models')}
                onPersonaConfig={() => {
                  setPersonaToEdit(persona.id);
                  setView('personas');
                }}
                initialPrompt={pendingPrompt}
                onPromptUsed={() => setPendingPrompt('')}
                saveSettings={saveSettings}
                notify={notify}
              />
            )}
            {view === 'personas' && (
              <PersonaLibrary
                settings={settings}
                saveSettings={saveSettings}
                initialPersonaId={personaToEdit}
                onEditOpened={() => setPersonaToEdit('')}
                onSelect={(id) => newChat(id)}
                notify={notify}
              />
            )}
            {view === 'studio' && (
              <Studio
                settings={settings}
                onSettings={() => setSettingsTab('models')}
                onCreated={() => setArtifactEpoch((v) => v + 1)}
                onAgent={(prompt) => {
                  setPendingPrompt(prompt);
                  setView('chat');
                  if (persona.mode !== 'work') {
                    const worker = settings.personas.find((p) => p.mode === 'work');
                    if (worker) void changePersona(worker.id);
                  }
                }}
                notify={notify}
              />
            )}
            {view === 'tools' && (
              <Tools settings={settings} saveSettings={saveSettings} notify={notify} />
            )}
            {view === 'gallery' && (
              <Gallery
                settings={settings}
                saveSettings={saveSettings}
                epoch={artifactEpoch}
                notify={notify}
              />
            )}
          </Suspense>
        </main>
      </div>
      {commandOpen && <CommandMenu commands={commands} onClose={() => setCommandOpen(false)} />}
      {editingHistory && (
        <Modal title="管理对话" onClose={() => setEditingHistory(null)}>
          <div className="modal-body">
            <Field label="对话名称">
              <input
                autoFocus
                data-autofocus
                maxLength={100}
                value={historyTitle}
                onChange={(e) => setHistoryTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && historyTitle.trim())
                    void updateHistory(editingHistory, { title: historyTitle.trim() });
                }}
              />
            </Field>
            <Button
              onClick={() => updateHistory(editingHistory, { pinned: !editingHistory.pinned })}
            >
              <Pin size={16} />
              {editingHistory.pinned ? '取消固定' : '固定对话'}
            </Button>
          </div>
          <div className="modal-footer">
            <Button
              variant="danger"
              onClick={() => {
                void removeConversation(editingHistory.id);
                setEditingHistory(null);
              }}
            >
              <Trash2 size={16} />
              删除
            </Button>
            <div className="button-row">
              <Button onClick={() => setEditingHistory(null)}>取消</Button>
              <Button
                variant="primary"
                disabled={!historyTitle.trim()}
                onClick={() => updateHistory(editingHistory, { title: historyTitle.trim() })}
              >
                保存
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {settingsTab && (
        <Suspense fallback={null}>
          <SettingsPanel
            settings={settings}
            initialTab={settingsTab}
            saktaEnabled={saktaEnabled}
            saveSettings={saveSettings}
            onSettings={setSettings}
            onClose={() => setSettingsTab(null)}
            notify={notify}
          />
        </Suspense>
      )}
      {toast && (
        <div role="status" className={'toast ' + (toast.kind === 'error' ? 'error' : '')}>
          <span>{toast.kind === 'error' ? <CircleHelp size={19} /> : <Check size={19} />}</span>
          <p>{toast.message}</p>
          <IconButton label="关闭提示" onClick={() => setToast(null)}>
            <X size={17} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function UserRoundIcon() {
  return <Users size={18} />;
}

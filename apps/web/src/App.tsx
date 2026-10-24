import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import {
  Plus,
  Search,
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
  Attachment,
  ConversationOrganization,
  OrganizationAction,
} from '@livra/shared';
import { skinVariables, conversationOrganizationSchema } from '@livra/shared';
import { api, post, put, ApiError } from './api';
import { CommandMenu, type Command } from './CommandMenu';
import { Settings2 } from 'lucide-react';
import { dictionaries } from './i18n';
import { Button, IconButton } from './ui';
import { ConversationList } from './ConversationList';
import { Chat } from './Chat';
import { useSaktaModels } from './useSaktaModels';
import { useConversationRuns } from './useConversationRuns';
import { CompanionDock } from './CompanionDock';
import { Ambient } from './Ambient';
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
  const [appearancePreview, setAppearancePreview] = useState<Settings | null>(null);
  const skinProperties = useRef<string[]>([]);
  const appearanceSettings = appearancePreview || settings;
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [personaId, setPersonaId] = useState('lumi');
  const [organization, setOrganization] = useState<ConversationOrganization>(() =>
    conversationOrganizationSchema.parse({}),
  );
  const [draftGroupId, setDraftGroupId] = useState<string | null>(null);
  const remoteModels = useSaktaModels(settings?.sakta);
  const [view, setView] = useState<View>('chat'),
    [settingsTab, setSettingsTab] = useState<string | null>(null),
    [sidebar, setSidebar] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false),
    [personaToEdit, setPersonaToEdit] = useState(''),
    [pendingPrompt, setPendingPrompt] = useState('');
  const [studioTheme, setStudioTheme] = useState('');
  const [detachedPresence, setDetachedPresence] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const useTheme = (id: string) => {
    setStudioTheme(id);
    setView('studio');
  };
  const [smallScreen, setSmallScreen] = useState(() => matchMedia('(max-width:720px)').matches),
    sidebarRef = useRef<HTMLElement>(null);
  const [saktaEnabled, setSaktaEnabled] = useState(true);
  const [artifactEpoch, setArtifactEpoch] = useState(0),
    [toast, setToast] = useState<{ message: string; kind: string } | null>(null);
  const selected = useRef<string | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify: Notify = (message, kind = 'success') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };
  const taskRuns = useConversationRuns({
    notify,
    onArtifact: () => setArtifactEpoch((v) => v + 1),
    onComplete: async (saved) => {
      if (selected.current === saved.id) setConversation(saved);
      await refreshHistory();
      if (selected.current !== saved.id) notify('对话「' + saved.title + '」已结束');
    },
  });
  const activeSession = conversation ? taskRuns.sessions[conversation.id] : undefined;
  const busy = !!activeSession,
    liveState = activeSession?.state || 'idle',
    mood = activeSession?.mood || 'neutral';
  const visibleConversation = activeSession?.conversation || conversation;
  const creating = useRef(false);
  const draftGeneration = useRef(0);
  async function bootstrap() {
    setLoading(true);
    setFatal('');
    try {
      const data = await api('/bootstrap');
      setSettings(data.settings);
      setConversations(data.conversations);
      setOrganization(conversationOrganizationSchema.parse(data.conversationOrganization || {}));
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
    const settings = appearanceSettings;
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
    document.documentElement.dataset.skin = settings.appearance.skin;
    document.documentElement.dataset.density = settings.appearance.density;
    document.documentElement.dataset.bubble = settings.appearance.bubble;
    const root = document.documentElement,
      design = settings.appearance.design;
    for (const key of skinProperties.current) root.style.removeProperty(key);
    const variables = skinVariables(design);
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    skinProperties.current = Object.keys(variables);
    root.dataset.design = design ? 'custom' : '';
    root.dataset.navigation = design?.navigation || '';
    root.dataset.composer = design?.composer || '';
    document.documentElement.style.setProperty(
      '--bubble-radius',
      settings.appearance.radius + 'px',
    );
    return () => media.removeEventListener('change', apply);
  }, [appearanceSettings]);
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
    setOrganization(conversationOrganizationSchema.parse(data.conversationOrganization || {}));
  }
  function newChat(id?: string, groupId: string | null = null) {
    draftGeneration.current++;
    selected.current = null;
    setConversation(null);
    setDraftGroupId(groupId);
    if (id) setPersonaId(id);
    setView('chat');
    setSidebar(false);
  }
  async function openConversation(id: string) {
    draftGeneration.current++;
    selected.current = id;
    setView('chat');
    setSidebar(false);
    try {
      const c =
        taskRuns.sessions[id]?.conversation || (await api<Conversation>('/conversations/' + id));
      if (selected.current === id) {
        setConversation(c);
        setPersonaId(c.personaId);
        if (c.unread) {
          const read = await api<Conversation>('/conversations/' + id, {
            method: 'PATCH',
            body: JSON.stringify({ unread: false }),
          });
          setConversations((list) => list.map((x) => (x.id === id ? { ...x, unread: false } : x)));
          setOrganization((old) => ({
            ...old,
            entries: { ...old.entries, [id]: { ...old.entries[id], unread: false } },
          }));
          if (selected.current === id) setConversation(read);
        }
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
    if (!c && creating.current) return false;
    const generation = draftGeneration.current;
    try {
      if (!c) {
        creating.current = true;
        c = await post<Conversation>('/conversations', { personaId, groupId: draftGroupId });
        if (generation === draftGeneration.current && selected.current === null) {
          selected.current = c.id;
          setConversation(c);
        }
        setConversations((list) => [c!, ...list]);
      }
    } catch (error) {
      notify((error as Error).message, 'error');
      return false;
    } finally {
      creating.current = false;
    }
    return taskRuns.start(c, { content, attachments, providerId, model, reasoning });
  }
  const stop = () => taskRuns.stop(selected.current);
  const approve = taskRuns.approve;
  async function removeConversation(id: string) {
    await api('/conversations/' + id, { method: 'DELETE' });
    setConversations((items) => items.filter((x) => x.id !== id));
    if (selected.current === id) newChat();
    await refreshHistory();
  }

  async function updateHistory(c: Conversation, patch: Partial<Conversation>) {
    const updated = await api<Conversation>('/conversations/' + c.id, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setConversations((v) => v.map((x) => (x.id === c.id ? updated : x)));
    if (selected.current === c.id) setConversation(updated);
    await refreshHistory();
  }
  async function organizeHistory(action: OrganizationAction) {
    const next = await api<ConversationOrganization>('/conversation-organization', {
      method: 'PATCH',
      body: JSON.stringify(action),
    });
    setOrganization(next);
    if (draftGroupId && !next.groups.some((g) => g.id === draftGroupId)) setDraftGroupId(null);
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
      {appearanceSettings && <Ambient settings={appearanceSettings} />}
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
          <svg
            className="livra-mark"
            width="28"
            height="30"
            viewBox="0 0 28 30"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 4v15c0 4 3 7 7 7h9M12 4v13c0 2 1 3 3 3h7"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle cx="21" cy="6" r="3" fill="currentColor" />
          </svg>
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
        <ConversationList
          conversations={conversations}
          organization={organization}
          sessions={taskRuns.sessions}
          selectedId={view === 'chat' ? selected.current : null}
          onOpen={openConversation}
          onNew={(groupId) => newChat(undefined, groupId)}
          onOrganize={organizeHistory}
          onUpdate={updateHistory}
          onDelete={removeConversation}
          notify={notify}
        />
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
              {view === 'chat' &&
                !conversation &&
                draftGroupId &&
                organization.groups.some((g) => g.id === draftGroupId) && (
                  <small className="draft-group-label">
                    / {organization.groups.find((g) => g.id === draftGroupId)!.name} · 新对话
                  </small>
                )}
              {view === 'chat' && conversation && (
                <>
                  <ChevronRight size={15} />
                  <strong>{visibleConversation?.title}</strong>
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
                remoteModels={remoteModels}
                settings={{
                  ...settings,
                  reducedMotion: appearanceSettings?.reducedMotion ?? settings.reducedMotion,
                }}
                persona={persona}
                key={conversation?.id || 'draft'}
                conversation={visibleConversation}
                busy={busy}
                liveState={liveState}
                mood={mood}
                approvals={activeSession?.approvals || []}
                onApprove={approve}
                onSend={send}
                onStop={stop}
                onPersona={changePersona}
                onSettings={() => setSettingsTab('models')}
                onUseTheme={useTheme}
                onAppearancePreview={setAppearancePreview}
                detachedPresence={detachedPresence}
                onDetachPresence={() => setDetachedPresence(true)}
                focusRequest={focusRequest}
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
                requestedThemeId={studioTheme}
                onThemeUsed={() => setStudioTheme('')}
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
                onUseTheme={useTheme}
                onAppearancePreview={setAppearancePreview}
                notify={notify}
              />
            )}
          </Suspense>
        </main>
      </div>
      {(view !== 'chat' || detachedPresence) && (
        <CompanionDock
          settings={{
            ...settings,
            reducedMotion: appearanceSettings?.reducedMotion ?? settings.reducedMotion,
          }}
          persona={persona}
          sessions={taskRuns.sessions}
          selectedId={conversation?.id}
          onOpen={(id) => {
            if (id) void openConversation(id);
            else setView('chat');
            setFocusRequest((n) => n + 1);
          }}
          onDock={() => {
            setDetachedPresence(false);
            setView('chat');
          }}
        />
      )}
      {commandOpen && <CommandMenu commands={commands} onClose={() => setCommandOpen(false)} />}
      {settingsTab && (
        <Suspense fallback={null}>
          <SettingsPanel
            settings={settings}
            onDesignSkin={(prompt) => {
              const designer = settings.personas.find((p) => p.tools.includes('create_skin'));
              if (!designer) {
                notify('请先在人偶的工具能力中启用「设计应用皮肤」', 'error');
                return;
              }
              setSettingsTab(null);
              setAppearancePreview(null);
              setSidebar(false);
              setView('chat');
              if (designer && !persona.tools.includes('create_skin')) newChat(designer.id);
              setPendingPrompt(
                '请使用 create_skin 设计一套应用皮肤，生成可预览和复用的皮肤作品。我的需求：' +
                  prompt,
              );
            }}
            onPreview={setAppearancePreview}
            initialTab={settingsTab}
            saktaEnabled={saktaEnabled}
            saveSettings={saveSettings}
            onSettings={(next) => {
              setSettings(next);
              if (
                next.sakta?.connected &&
                settings.sakta?.connected &&
                next.sakta.name === settings.sakta.name
              )
                void remoteModels.refresh();
            }}
            onClose={() => {
              setAppearancePreview(null);
              setSettingsTab(null);
            }}
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

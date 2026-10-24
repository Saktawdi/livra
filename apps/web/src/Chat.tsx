import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Plus,
  Square,
  FileText,
  X,
  Brain,
  Mic,
  Volume2,
  VolumeX,
  Download,
  Check,
  LoaderCircle,
  CircleAlert,
  ShieldCheck,
  ArrowUpRight,
  MessageSquare,
  BriefcaseBusiness,
  Image,
  Presentation,
  Globe,
  Music2,
  PanelRight,
} from 'lucide-react';
import type {
  Attachment,
  Conversation,
  LiveState,
  Mood,
  Persona,
  Settings,
  ToolCall,
} from '@livra/shared';
import { download, readAttachment } from './api';
import { useVoice } from './useVoice';
import { useDraft } from './useDraft';
import { Presence } from './Presence';
import { ModelPicker } from './ModelPicker';
import { ComposerMetrics } from './ComposerMetrics';
import { ReasoningPicker } from './ReasoningPicker';
import { Avatar } from './Avatar';
import type { RemoteModels } from './useSaktaModels';
import { ArtifactPreview } from './ArtifactPreview';
import { Button, IconButton, Markdown, CopyButton, Modal } from './ui';
import type { Notify, Approval } from './App';

const toolNames: Record<string, string> = {
  create_skin: '设计应用皮肤',
  list_skins: '查找皮肤',
  list_tools: '检查工具',
  set_emotion: '更新情绪',
  remember: '保存记忆',
  web_search: '搜索资料',
  create_slides: '制作演示文稿',
  create_marp_theme: '设计主题',
  generate_image: '生成图像',
  generate_music: '生成音乐',
  create_persona: '设计人偶',
  list_live2d_models: '查找人偶形象',
};
const shortcuts = [
  {
    command: '/skin',
    label: '设计皮肤',
    icon: Image,
    text: '请用 create_skin 为我设计一套应用皮肤。我的风格要求是：',
    tool: 'create_skin',
  },
  {
    command: '/image',
    label: '生成图像',
    icon: Image,
    text: '帮我生成一幅图像。',
    tool: 'generate_image',
  },
  {
    command: '/slides',
    label: '制作演示',
    icon: Presentation,
    text: '帮我制作一份演示文稿。',
    tool: 'create_slides',
  },
  {
    command: '/research',
    label: '研究主题',
    icon: Globe,
    text: '帮我研究一个主题，列出来源并整理结论。',
    tool: 'web_search',
  },
  {
    command: '/music',
    label: '生成音乐',
    icon: Music2,
    text: '帮我创作一段音乐。',
    tool: 'generate_music',
  },
];

type Props = {
  settings: Settings;
  remoteModels: RemoteModels;
  persona: Persona;
  conversation: Conversation | null;
  busy: boolean;
  liveState: LiveState;
  mood: Mood;
  approvals: Approval[];
  onApprove: (a: Approval, v: boolean) => void;
  onSend: (
    text: string,
    attachments: Attachment[],
    provider: string,
    model: string,
    reasoning: string,
  ) => Promise<boolean>;
  onStop: () => void;
  onPersona: (id: string) => void;
  onSettings: () => void;
  onUseTheme: (id: string) => void;
  onAppearancePreview: (settings: Settings | null) => void;
  detachedPresence: boolean;
  onDetachPresence: () => void;
  focusRequest: number;
  onPersonaConfig: () => void;
  initialPrompt?: string;
  onPromptUsed: () => void;
  saveSettings: (s: Settings) => Promise<Settings>;
  notify: Notify;
};
export function Chat({
  settings,
  remoteModels,
  persona,
  conversation,
  busy,
  liveState,
  mood,
  approvals,
  onApprove,
  onSend,
  onStop,
  onPersona,
  onSettings,
  onUseTheme,
  onAppearancePreview,
  detachedPresence,
  onDetachPresence,
  focusRequest,
  onPersonaConfig,
  initialPrompt,
  onPromptUsed,
  saveSettings,
  notify,
}: Props) {
  const [draft, setDraft] = useDraft(conversation?.id);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [providerId, setProviderId] = useState(settings.defaultProvider),
    [model, setModel] = useState(settings.defaultModel),
    [reasoning, setReasoning] = useState('auto'),
    [listening, setListening] = useState(false),
    [mobilePresence, setMobilePresence] = useState(false),
    [artifactId, setArtifactId] = useState(''),
    [scrolled, setScrolled] = useState(false),
    [dragging, setDragging] = useState(false),
    [slashIndex, setSlashIndex] = useState(0),
    [slashHidden, setSlashHidden] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    scrollRef = useRef<HTMLDivElement>(null),
    recognitionRef = useRef<any>(null),
    wasBusy = useRef(false),
    nearBottom = useRef(true),
    submission = useRef(false),
    dragDepth = useRef(0);
  const [compact, setCompact] = useState(() => matchMedia('(max-width:940px)').matches);
  useEffect(() => {
    if (focusRequest) textRef.current?.focus();
  }, [focusRequest]);
  useEffect(() => {
    const media = matchMedia('(max-width:940px)');
    const change = () => {
      setCompact(media.matches);
      if (!media.matches) setMobilePresence(false);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const {
    speaking,
    preparing,
    stage: voiceStage,
    level,
    speak,
    stop: stopVoice,
  } = useVoice(settings, persona, notify);
  const options = [
    ...settings.providers
      .filter((p) => p.kind === 'chat')
      .flatMap((p) => p.models.map((m) => ({ provider: p.id, name: p.name, model: m }))),
    ...remoteModels.models.map((m) => ({ provider: 'sakta', name: 'Sakta · 账号模型', model: m })),
  ];
  const slashes = shortcuts.filter((s) => (s.command + ' ' + s.label).includes(draft.slice(0, 25)));
  const showSlash =
    draft.startsWith('/') && !draft.includes(' ') && !slashHidden && slashes.length > 0;
  useEffect(() => {
    setProviderId(settings.defaultProvider);
    setModel(settings.defaultModel);
  }, [settings.defaultProvider, settings.defaultModel]);
  useEffect(() => {
    if (providerId === 'sakta' && (remoteModels.loading || remoteModels.error)) return;
    if (!options.some((o) => o.provider === providerId && o.model === model)) {
      const first = options.find((o) => o.provider === providerId) || options[0];
      setProviderId(first?.provider || '');
      setModel(first?.model || '');
    }
  }, [JSON.stringify(options), remoteModels.loading, remoteModels.error, providerId, model]);
  useEffect(() => {
    if (initialPrompt) {
      setDraft(initialPrompt);
      onPromptUsed();
      textRef.current?.focus();
    }
  }, [initialPrompt]);
  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto';
      textRef.current.style.height = Math.min(176, textRef.current.scrollHeight) + 'px';
    }
  }, [draft]);
  useEffect(() => {
    if (nearBottom.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation?.messages, approvals]);
  useEffect(() => {
    nearBottom.current = true;
    setScrolled(false);
    setAttachments([]);
    stopVoice();
  }, [conversation?.id]);
  useEffect(() => () => recognitionRef.current?.abort(), []);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (wasBusy.current && settings.autoSpeak) {
      const last = conversation?.messages.at(-1);
      if (last?.role === 'assistant' && last.content && !last.error && !last.interrupted)
        void speak(last.content);
    }
    wasBusy.current = false;
  }, [busy]);
  async function addFiles(files: File[]) {
    try {
      if (attachments.length + files.length > 6) throw Error('最多添加 6 个附件');
      const items = await Promise.all(files.map(readAttachment));
      setAttachments((a) => [...a, ...items]);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function submit() {
    if ((!draft.trim() && !attachments.length) || busy || submission.current) return;
    if (
      providerId === 'sakta' &&
      remoteModels.loading &&
      !options.some((o) => o.provider === providerId && o.model === model)
    )
      return;
    if (!model || !providerId) {
      onSettings();
      return;
    }
    submission.current = true;
    const text = draft,
      files = attachments;
    setDraft('');
    setAttachments([]);
    nearBottom.current = true;
    try {
      if (!(await onSend(text, files, providerId, model, reasoning))) {
        setDraft((d) => d || text);
        setAttachments((a) => (a.length ? a : files));
      }
    } finally {
      submission.current = false;
    }
  }
  function useShortcut(s: (typeof shortcuts)[number]) {
    if (!persona.tools.includes(s.tool)) {
      const p = settings.personas.find((p) => p.tools.includes(s.tool));
      if (p) onPersona(p.id);
    }
    setDraft(s.text);
    setSlashHidden(true);
    textRef.current?.focus();
  }
  function dictate() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      notify('此浏览器不支持语音输入，请使用系统听写', 'error');
      return;
    }
    const r = new Recognition();
    r.lang = settings.locale;
    r.interimResults = false;
    r.onresult = (e: any) => setDraft((v) => v + (v ? ' ' : '') + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = (e: any) => {
      setListening(false);
      notify(e.error === 'not-allowed' ? '请允许使用麦克风' : '语音识别暂不可用', 'error');
    };
    recognitionRef.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }
  function selectModel(o: { provider: string; model: string }) {
    setProviderId(o.provider);
    setModel(o.model);
    saveSettings({ ...settings, defaultProvider: o.provider, defaultModel: o.model }).catch((e) =>
      notify(e.message, 'error'),
    );
  }
  const work = persona.mode === 'work',
    empty = !conversation?.messages.length;
  const presence = (
    <Presence
      settings={settings}
      persona={persona}
      state={speaking ? 'speaking' : listening ? 'listening' : liveState}
      mood={mood}
      audioLevel={level}
      conversation={conversation}
      onPersona={(id) => {
        onPersona(id);
        setMobilePresence(false);
      }}
      onSettings={onPersonaConfig}
      onArtifact={setArtifactId}
      notify={notify}
      saveSettings={saveSettings}
      paused={!!artifactId}
      onDetach={onDetachPresence}
    />
  );
  return (
    <div
      className={
        'chat-layout ' +
        (work ? 'mode-work' : 'mode-companion') +
        (empty ? ' is-empty' : '') +
        (detachedPresence ? ' presence-detached' : '')
      }
    >
      <section className="chat-main" aria-label="对话">
        <div className="chat-toolbar">
          <div className="mode-segment" role="group" aria-label="空间模式">
            {[
              { mode: 'companion', title: '相伴', icon: MessageSquare },
              { mode: 'work', title: '共事', icon: BriefcaseBusiness },
            ].map(({ mode, title, icon: Icon }) => (
              <button
                key={mode}
                disabled={busy}
                aria-pressed={persona.mode === mode}
                className={persona.mode === mode ? 'active' : ''}
                onClick={() => {
                  const p = settings.personas.find((p) => p.mode === mode);
                  if (p) onPersona(p.id);
                }}
              >
                <Icon size={16} />
                {title}
              </button>
            ))}
          </div>
          <div className="chat-toolbar-end">
            <button className="mobile-companion-toggle" onClick={() => setMobilePresence(true)}>
              <PanelRight size={17} />
              {persona.name}
            </button>
            {!empty && (
              <IconButton
                label="导出当前对话"
                onClick={() =>
                  download(
                    (conversation?.title || 'conversation') + '.md',
                    conversation!.messages
                      .map((m) => `## ${m.role === 'user' ? '我' : persona.name}\n\n${m.content}`)
                      .join('\n\n'),
                  )
                }
              >
                <Download size={18} />
              </IconButton>
            )}
          </div>
        </div>
        <div
          className="conversation-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            setScrolled(!nearBottom.current);
          }}
        >
          {empty ? (
            <div className="welcome">
              <span className="welcome-persona">
                <span className="online-dot" />
                {persona.name}
              </span>
              <h1>{work ? '今天，要完成什么？' : '今天，聊点什么？'}</h1>
              <p>{work ? '把任务交给我，我们一步步来。' : persona.greeting}</p>
            </div>
          ) : (
            <div className="message-list">
              {conversation!.messages.map((m, i) => (
                <article
                  key={m.id}
                  className={'message ' + m.role}
                  aria-label={m.role === 'user' ? '你的消息' : persona.name + '的回答'}
                >
                  <div
                    className="message-avatar"
                    style={
                      m.role === 'assistant'
                        ? ({ '--persona-color': persona.color } as React.CSSProperties)
                        : undefined
                    }
                  >
                    <Avatar
                      role={m.role}
                      src={m.role === 'user' ? settings.userAvatar : settings.agentAvatar}
                      name={m.role === 'assistant' ? persona.name : undefined}
                    />
                  </div>
                  <div className="message-body">
                    <div className="message-meta">
                      <strong>{m.role === 'assistant' ? persona.name : '我'}</strong>
                      <time>
                        {new Date(m.created).toLocaleTimeString(settings.locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    {!!m.attachments?.length && (
                      <div className="message-attachments">
                        {m.attachments.map((a, j) =>
                          a.type === 'image' ? (
                            <a key={j} href={a.data} target="_blank" rel="noreferrer">
                              <img src={a.data} alt={a.name} />
                            </a>
                          ) : (
                            <span key={j}>
                              <FileText size={16} />
                              {a.name}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {m.reasoning && (
                      <details className="reasoning">
                        <summary>
                          <Brain size={15} />
                          思考过程
                          <ChevronDown size={14} />
                        </summary>
                        <div>{m.reasoning}</div>
                      </details>
                    )}
                    {!!m.tools?.length && (
                      <div className="tool-timeline">
                        {m.tools.map((tool) => (
                          <ToolStep key={tool.id} tool={tool} onArtifact={setArtifactId} />
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <Markdown text={m.content} />
                    ) : busy && i === conversation!.messages.length - 1 && !m.tools?.length ? (
                      <div className="thinking-dots" role="status" aria-label="正在思考">
                        <i />
                        <i />
                        <i />
                      </div>
                    ) : null}
                    {m.error && (
                      <p className="message-error" role="alert">
                        <CircleAlert size={16} />
                        {m.error}
                      </p>
                    )}
                    {m.interrupted && <p className="interrupted">已停止</p>}
                    {m.role === 'assistant' &&
                      (m.error || m.interrupted) &&
                      i === conversation!.messages.length - 1 &&
                      !busy && (
                        <button
                          className="retry-edit"
                          onClick={() => {
                            const previous = conversation!.messages
                              .slice(0, i)
                              .findLast((x) => x.role === 'user');
                            if (previous) {
                              setDraft(previous.content);
                              setAttachments(previous.attachments || []);
                              textRef.current?.focus();
                            }
                          }}
                        >
                          编辑后重试
                          <ArrowUpRight size={15} />
                        </button>
                      )}
                    {m.role === 'assistant' &&
                      m.content &&
                      !(busy && i === conversation!.messages.length - 1) && (
                        <div className="message-actions">
                          <CopyButton text={m.content} />
                          <IconButton
                            label={
                              preparing
                                ? `${voiceStage} · 点击取消`
                                : speaking
                                  ? '停止朗读'
                                  : settings.speechMode === 'summary'
                                    ? '总结朗读回复'
                                    : '纯朗读回复'
                            }
                            onClick={() => speak(m.content)}
                          >
                            {preparing ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : speaking ? (
                              <VolumeX size={16} />
                            ) : (
                              <Volume2 size={16} />
                            )}
                          </IconButton>
                          {m.usage && <span>{m.usage.total.toLocaleString()} tokens</span>}
                        </div>
                      )}
                  </div>
                </article>
              ))}
              {approvals.map((item) => (
                <div className="approval-card" key={item.id}>
                  <ShieldCheck size={24} />
                  <div>
                    <strong>准备{toolNames[item.name] || item.name}</strong>
                    <p>
                      {item.name === 'remember'
                        ? '将写入这位人偶的长期记忆。'
                        : '需要你的允许才能继续。'}
                    </p>
                    {(item.args.content || item.args.prompt || item.args.query) && (
                      <blockquote className="approval-summary">
                        {String(item.args.content || item.args.prompt || item.args.query)}
                      </blockquote>
                    )}
                    {settings.customTools.find((t) => t.name === item.name) && (
                      <p>
                        服务：
                        {
                          new URL(settings.customTools.find((t) => t.name === item.name)!.endpoint)
                            .host
                        }
                      </p>
                    )}
                    <details>
                      <summary>查看调用参数</summary>
                      <pre>{JSON.stringify(item.args, null, 2)}</pre>
                    </details>
                    <div className="button-row">
                      <Button onClick={() => onApprove(item, false)}>跳过</Button>
                      <Button variant="primary" onClick={() => onApprove(item, true)}>
                        允许执行
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {scrolled && (
          <button
            className="scroll-latest"
            onClick={() => {
              if (scrollRef.current)
                scrollRef.current.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: settings.reducedMotion ? 'instant' : 'smooth',
                });
              nearBottom.current = true;
              setScrolled(false);
            }}
          >
            <ArrowDown size={17} />
            最新回复
          </button>
        )}
        <div className="composer-wrap">
          <div
            className={'composer ' + (busy ? 'is-busy' : '') + (dragging ? ' drag-over' : '')}
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current++;
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              e.preventDefault();
              if (--dragDepth.current <= 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              void addFiles([...e.dataTransfer.files]);
            }}
          >
            {dragging && (
              <div className="drop-target">
                <Plus size={25} />
                松开，添加附件
              </div>
            )}
            {attachments.length > 0 && (
              <div className="attachment-row">
                {attachments.map((a, i) => (
                  <div className="attachment-chip" key={i}>
                    {a.type === 'image' ? (
                      <img src={a.data} alt={a.name} />
                    ) : (
                      <FileText size={17} />
                    )}
                    <span>{a.name}</span>
                    <IconButton
                      label={'移除 ' + a.name}
                      onClick={() => setAttachments((v) => v.filter((_, j) => j !== i))}
                    >
                      <X size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            {showSlash && (
              <div className="slash-menu" role="listbox" aria-label="快捷工具">
                {slashes.map((s, i) => (
                  <button
                    role="option"
                    aria-selected={i === slashIndex}
                    className={i === slashIndex ? 'active' : ''}
                    key={s.command}
                    onClick={() => useShortcut(s)}
                  >
                    <s.icon size={18} />
                    <strong>{s.label}</strong>
                    <code>{s.command}</code>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textRef}
              aria-label="消息输入框"
              rows={2}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSlashHidden(false);
                setSlashIndex(0);
              }}
              placeholder={
                busy
                  ? '可以先写下你的下一条消息…'
                  : work
                    ? '描述任务，或输入 / 选择工具'
                    : '和' + persona.name + '说点什么…'
              }
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (showSlash && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
                  e.preventDefault();
                  if (e.key === 'Escape') setSlashHidden(true);
                  else if (e.key === 'Enter') useShortcut(slashes[slashIndex] || slashes[0]);
                  else
                    setSlashIndex(
                      (i) =>
                        (i + (e.key === 'ArrowDown' ? 1 : -1) + slashes.length) % slashes.length,
                    );
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  void addFiles([...e.clipboardData.files]);
                }
              }}
            />
            <div className="composer-bottom">
              <div className="composer-tools">
                <IconButton label="添加附件" onClick={() => fileRef.current?.click()}>
                  <Plus size={21} />
                </IconButton>
                <input
                  hidden
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.ts,.js,.py,.html,.css,.xml,.yaml,.yml,.log"
                  onChange={(e) => {
                    void addFiles([...(e.target.files || [])]);
                    e.target.value = '';
                  }}
                />
                <ModelPicker
                  options={options}
                  provider={providerId}
                  model={model}
                  remote={remoteModels}
                  busy={busy}
                  onSelect={selectModel}
                  onSettings={onSettings}
                />
                {model && (
                  <ReasoningPicker value={reasoning} onChange={setReasoning} disabled={busy} />
                )}
              </div>
              <div className="composer-right">
                <IconButton
                  label={listening ? '停止语音输入' : '语音输入'}
                  className={listening ? 'recording' : ''}
                  onClick={dictate}
                >
                  <Mic size={19} />
                </IconButton>
                {busy ? (
                  <button className="send-button stop" aria-label="停止生成" onClick={onStop}>
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label="发送消息"
                    disabled={
                      (!draft.trim() && !attachments.length) ||
                      (providerId === 'sakta' &&
                        remoteModels.loading &&
                        !options.some((o) => o.provider === providerId && o.model === model))
                    }
                    onClick={submit}
                  >
                    <ArrowUp size={21} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <ComposerMetrics
            conversation={conversation}
            persona={persona}
            settings={settings}
            provider={providerId}
            model={model}
            draft={draft}
            attachments={attachments}
            busy={busy}
          />
          {empty && (
            <div className={'start-actions ' + (work ? 'task-actions' : 'talk-actions')}>
              {work
                ? [
                    {
                      title: '研究一个主题',
                      detail: '搜索、整理、保留来源',
                      icon: Globe,
                      text: '我想研究一个主题，请先帮我确认研究范围和期望的交付形式。',
                    },
                    {
                      title: '制作一份演示',
                      detail: '从结构到 Marp 成稿',
                      icon: Presentation,
                      text: '帮我制作一份 Marp 演示文稿。请先问我主题、受众和页数。',
                    },
                    {
                      title: '创作图像或音乐',
                      detail: '描述想法，生成作品',
                      icon: Image,
                      text: '我想创作一份作品，先帮我确定适合的形式和风格。',
                    },
                  ].map(({ title, detail, icon: Icon, text }) => (
                    <button
                      key={title}
                      onClick={() => {
                        setDraft(text);
                        textRef.current?.focus();
                      }}
                    >
                      <span className="start-icon">
                        <Icon size={22} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ))
                : ['随便聊聊', '理清一件事', '找点新鲜事'].map((title, i) => (
                    <button
                      key={title}
                      onClick={() => {
                        setDraft(
                          [
                            '想和你聊聊天。',
                            '有件事想和你一起理一理。',
                            '最近有什么有趣的事可以尝试？',
                          ][i],
                        );
                        textRef.current?.focus();
                      }}
                    >
                      {title}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
            </div>
          )}
          {listening && (
            <div className="dictation-status" role="status">
              正在聆听，再次点击麦克风结束
            </div>
          )}
        </div>
      </section>
      {!compact && !detachedPresence && <div className="desktop-presence">{presence}</div>}
      {mobilePresence && (
        <Modal title={persona.name} onClose={() => setMobilePresence(false)}>
          <div className="mobile-presence">{presence}</div>
        </Modal>
      )}
      {artifactId && (
        <ArtifactPreview
          id={artifactId}
          onUseTheme={onUseTheme}
          onAppearancePreview={onAppearancePreview}
          onClose={() => setArtifactId('')}
          settings={settings}
          saveSettings={saveSettings}
          notify={notify}
        />
      )}
    </div>
  );
}
function ToolStep({ tool, onArtifact }: { tool: ToolCall; onArtifact: (id: string) => void }) {
  const result = tool.result as any;
  const declined = !!result?.declined;
  return (
    <div className={'tool-step ' + tool.status}>
      <details>
        <summary>
          {tool.status === 'running' ? (
            <LoaderCircle size={16} className="spin" />
          ) : tool.status === 'error' ? (
            <CircleAlert size={16} />
          ) : (
            <Check size={16} />
          )}
          <span>{toolNames[tool.name] || tool.name}</span>
          <small>
            {tool.status === 'running'
              ? '进行中'
              : tool.status === 'error'
                ? '失败'
                : declined
                  ? '已跳过'
                  : '完成'}
          </small>
          <ChevronDown size={14} />
        </summary>
        <pre>{JSON.stringify(result || tool.args, null, 2).slice(0, 5000)}</pre>
      </details>
      {result?.artifactId && (
        <button className="tool-artifact-link" onClick={() => onArtifact(result.artifactId)}>
          <FileText size={18} />
          <span>{result.title}</span>
          <ArrowUpRight size={16} />
        </button>
      )}
    </div>
  );
}

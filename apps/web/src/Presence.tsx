import { useEffect, useState } from 'react';
import {
  Hand,
  Timer,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronDown,
  Check,
  Brain,
  Settings2,
  ArrowUpRight,
  FileText,
  LoaderCircle,
  CircleCheck,
  CircleAlert,
  Layers,
} from 'lucide-react';
import type { Conversation, LiveState, Memory, Mood, Persona, Settings } from '@livra/shared';
import { useFocus } from './useFocus';
import { LiveAvatar } from './LiveAvatar';
import { api, post } from './api';
import { IconButton, Button, Modal, Field } from './ui';
import type { Notify } from './App';

export function Presence({
  settings,
  persona,
  state,
  mood,
  audioLevel,
  conversation,
  onPersona,
  onSettings,
  onArtifact,
  notify,
  saveSettings,
}: {
  settings: Settings;
  persona: Persona;
  state: LiveState;
  mood: Mood;
  audioLevel: { current: number | undefined };
  conversation: Conversation | null;
  onPersona: (id: string) => void;
  onSettings: () => void;
  onArtifact: (id: string) => void;
  notify: Notify;
  saveSettings: (s: Settings) => Promise<Settings>;
}) {
  const [choosing, setChoosing] = useState(false),
    [tab, setTab] = useState('activity'),
    [localMood, setLocalMood] = useState<Mood | null>(null),
    [greeting, setGreeting] = useState(false),
    [memoryOpen, setMemoryOpen] = useState(false),
    [memories, setMemories] = useState<Memory[]>([]),
    [memory, setMemory] = useState('');
  const { remaining, timerOn, timerVisible, start, toggle, end } = useFocus(notify);
  useEffect(() => {
    if (!localMood) return;
    const id = setTimeout(() => {
      setLocalMood(null);
      setGreeting(false);
    }, 3500);
    return () => clearTimeout(id);
  }, [localMood, greeting]);
  const tools = conversation?.messages.flatMap((m) => m.tools || []) || [];
  const artifacts = tools.map((t) => t.result as any).filter((r) => r?.artifactId);
  const work = persona.mode === 'work';
  const status =
    state === 'thinking'
      ? '思考中'
      : state === 'speaking'
        ? '正在说话'
        : state === 'working'
          ? '执行中'
          : state === 'listening'
            ? '正在听你说'
            : state === 'error'
              ? '需要检查'
              : '在这里';
  function wave() {
    setLocalMood(localMood === 'happy' ? 'excited' : 'happy');
    setGreeting(true);
  }
  async function openMemory() {
    setMemoryOpen(true);
    try {
      setMemories((await api<Memory[]>('/memories')).filter((m) => m.personaId === persona.id));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  return (
    <aside className={'presence-panel ' + (work ? 'work' : 'companion')} aria-label="人偶与任务">
      <div className="presence-top">
        <button
          className="presence-persona"
          onClick={() => setChoosing(true)}
          aria-label="切换人偶"
        >
          <span
            className="persona-monogram"
            style={{ '--persona-color': persona.color } as React.CSSProperties}
          >
            {persona.name.slice(0, 1)}
          </span>
          <span>
            <strong>{persona.name}</strong>
            <small>{work ? '工作搭档' : '陪伴人偶'}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <IconButton
          label={settings.autoSpeak ? '关闭自动朗读' : '开启自动朗读'}
          onClick={() =>
            saveSettings({ ...settings, autoSpeak: !settings.autoSpeak }).catch((e) =>
              notify(e.message, 'error'),
            )
          }
        >
          {settings.autoSpeak ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </IconButton>
      </div>
      <div className="presence-stage">
        <span className="presence-status">
          <i className={state !== 'idle' ? 'active' : ''} />
          {status}
        </span>
        <div className="stage-arch" />
        <LiveAvatar
          persona={persona}
          state={state}
          mood={localMood || mood}
          audioLevel={audioLevel}
          reducedMotion={settings.reducedMotion}
          compact={work}
          onTap={wave}
        />
        {greeting && (
          <div className="presence-bubble" role="status">
            {persona.name}向你打了个招呼。
          </div>
        )}
        {timerVisible && (
          <div className="focus-clock">
            <span>专注</span>
            <strong>
              {Math.floor(remaining / 60)
                .toString()
                .padStart(2, '0')}
              :{(remaining % 60).toString().padStart(2, '0')}
            </strong>
            <IconButton label={timerOn ? '暂停专注' : '继续专注'} onClick={toggle}>
              {timerOn ? <Pause size={16} /> : <Play size={16} />}
            </IconButton>
            <IconButton label="结束专注" onClick={end}>
              <X size={16} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="presence-actions">
        <button onClick={wave}>
          <Hand size={17} />
          打个招呼
        </button>
        <button aria-pressed={timerVisible} onClick={start}>
          <Timer size={17} />
          专注 25 分钟
        </button>
      </div>
      {work && (
        <div className="execution-dock">
          <div className="dock-tabs">
            <button
              className={tab === 'activity' ? 'active' : ''}
              onClick={() => setTab('activity')}
            >
              执行{tools.length > 0 && <span>{tools.length}</span>}
            </button>
            <button
              className={tab === 'artifacts' ? 'active' : ''}
              onClick={() => setTab('artifacts')}
            >
              作品{artifacts.length > 0 && <span>{artifacts.length}</span>}
            </button>
          </div>
          <div className="dock-content">
            {tab === 'activity' ? (
              tools.length ? (
                tools.map((t) => (
                  <div className="execution-step" key={t.id}>
                    {t.status === 'running' ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : t.status === 'error' ? (
                      <CircleAlert size={16} />
                    ) : (
                      <CircleCheck size={16} />
                    )}
                    <span>
                      {(
                        {
                          create_slides: '制作演示文稿',
                          generate_image: '生成图像',
                          web_search: '搜索资料',
                          set_emotion: '更新情绪',
                          remember: '保存记忆',
                          create_marp_theme: '设计主题',
                          create_persona: '设计人偶',
                          generate_music: '生成音乐',
                          list_tools: '检查可用工具',
                        } as any
                      )[t.name] || t.name}
                    </span>
                    <small>
                      {t.status === 'running' ? '进行中' : t.status === 'done' ? '完成' : '失败'}
                    </small>
                  </div>
                ))
              ) : (
                <div className="dock-empty">
                  <Layers size={23} />
                  <p>执行步骤会显示在这里</p>
                </div>
              )
            ) : artifacts.length ? (
              artifacts.map((a) => (
                <button
                  className="dock-artifact"
                  key={a.artifactId}
                  onClick={() => onArtifact(a.artifactId)}
                >
                  <FileText size={19} />
                  <span>{a.title}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <div className="dock-empty">
                <FileText size={23} />
                <p>任务产物就地预览</p>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="presence-foot">
        <button onClick={openMemory}>
          <Brain size={17} />
          记忆
        </button>
        <button onClick={onSettings}>
          <Settings2 size={17} />
          配置
        </button>
        <span title={persona.language === 'auto' ? '跟随用户语言' : persona.language}>
          {persona.language === 'auto' ? '自动语言' : persona.language}
        </span>
      </div>
      {choosing && (
        <Modal title="选择人偶" onClose={() => setChoosing(false)}>
          <div className="persona-picker">
            {settings.personas.map((p) => (
              <button
                key={p.id}
                className={p.id === persona.id ? 'selected' : ''}
                onClick={() => {
                  onPersona(p.id);
                  setChoosing(false);
                }}
              >
                <span
                  className="persona-monogram"
                  style={{ '--persona-color': p.color } as React.CSSProperties}
                >
                  {p.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.mode === 'work' ? '工作' : '陪伴'} · {p.description.slice(0, 56)}
                  </small>
                </span>
                {p.id === persona.id && <Check size={18} />}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {memoryOpen && (
        <Modal title={persona.name + '的记忆'} onClose={() => setMemoryOpen(false)}>
          <div className="modal-body">
            <div className="memory-list">
              {memories.length ? (
                memories.map((m) => (
                  <div key={m.id}>
                    <Brain size={17} />
                    <p>{m.content}</p>
                    <IconButton
                      label="移除记忆"
                      onClick={async () => {
                        try {
                          await api('/memories/' + m.id, { method: 'DELETE' });
                          setMemories((v) => v.filter((x) => x.id !== m.id));
                        } catch (e) {
                          notify((e as Error).message, 'error');
                        }
                      }}
                    >
                      <X size={16} />
                    </IconButton>
                  </div>
                ))
              ) : (
                <p className="muted">还没有记忆。你可以告诉它一件想被记住的事。</p>
              )}
            </div>
            <Field label="添加记忆">
              <textarea
                rows={3}
                maxLength={600}
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="例如：我习惯用中文讨论工作。"
              />
            </Field>
            <Button
              variant="primary"
              disabled={!memory.trim()}
              onClick={async () => {
                try {
                  const m = await post<Memory>('/memories', {
                    personaId: persona.id,
                    content: memory.trim(),
                  });
                  setMemories((v) => [...v, m]);
                  setMemory('');
                } catch (e) {
                  notify((e as Error).message, 'error');
                }
              }}
            >
              保存记忆
            </Button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

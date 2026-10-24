import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  ArrowUpRight,
  Pencil,
  Download,
  Upload,
  Trash2,
  Eye,
  Wrench,
  Brain,
} from 'lucide-react';
import {
  personaSchema,
  defaultPersonas,
  type Persona,
  type Settings,
  type ToolInfo,
  type Memory,
} from '@livra/shared';
import { api, download, post } from './api';
import { PageIntro, Button, IconButton, Modal, Field, Badge, Toggle, Empty } from './ui';
import { LiveAvatar } from './LiveAvatar';
import type { Notify } from './App';

export function PersonaLibrary({
  settings,
  saveSettings,
  onSelect,
  notify,
  initialPersonaId,
  onEditOpened,
}: {
  settings: Settings;
  saveSettings: (s: Settings) => Promise<Settings>;
  onSelect: (id: string) => void;
  notify: Notify;
  initialPersonaId?: string;
  onEditOpened?: () => void;
}) {
  const [filter, setFilter] = useState('all'),
    [editing, setEditing] = useState<Persona | null>(null),
    [tools, setTools] = useState<ToolInfo[]>([]),
    [memories, setMemories] = useState<Memory[]>([]),
    [memoryPersona, setMemoryPersona] = useState<Persona | null>(null),
    [saving, setSaving] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState(settings.personas[0]?.id || '');
  useEffect(() => {
    if (initialPersonaId) {
      const p = settings.personas.find((p) => p.id === initialPersonaId);
      if (p) void edit(p);
      onEditOpened?.();
    }
  }, [initialPersonaId]);
  async function edit(p: Persona) {
    try {
      setTools(await api('/tools'));
      setEditing(structuredClone(p));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function save(p: Persona) {
    const parsed = personaSchema.safeParse(p);
    if (!parsed.success) {
      notify(parsed.error.issues[0].message, 'error');
      return;
    }
    setSaving(true);
    try {
      const personas = settings.personas.some((x) => x.id === p.id)
        ? settings.personas.map((x) => (x.id === p.id ? p : x))
        : [...settings.personas, p];
      await saveSettings({ ...settings, personas });
      setEditing(null);
      notify('人偶卡已保存');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="content-page persona-page">
      <PageIntro
        eyebrow="A PERSONALITY FOR EVERY POSSIBILITY"
        title="人偶"
        description="设定人格、声音和能力。"
        action={
          <div className="button-row">
            <Button onClick={() => importRef.current?.click()}>
              <Upload size={15} />
              导入人偶卡
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                edit({
                  ...structuredClone(defaultPersonas[0]),
                  id: crypto.randomUUID(),
                  name: '新的伙伴',
                  subtitle: '你的新搭档',
                  description: '',
                  systemPrompt: '你是一位友善、可靠的数字伙伴。',
                  greeting: '你好，很高兴认识你。',
                })
              }
            >
              <Plus size={16} />
              创建人偶
            </Button>
          </div>
        }
      />
      <input
        hidden
        type="file"
        ref={importRef}
        accept="application/json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 100000) throw Error('人偶卡最大 100 KB');
            const parsed = personaSchema.parse({
              ...JSON.parse(await file.text()),
              id: crypto.randomUUID(),
            });
            await edit(parsed);
          } catch (e) {
            notify('人偶卡格式有误：' + (e as Error).message, 'error');
          }
          e.target.value = '';
        }}
      />
      <div className="page-filter">
        <div className="filter-tabs">
          {[
            { id: 'all', label: '全部伙伴' },
            { id: 'companion', label: '陪伴型' },
            { id: 'work', label: '工作型' },
          ].map((f) => (
            <button
              className={filter === f.id ? 'active' : ''}
              key={f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="muted">{settings.personas.length} 位人偶</span>
      </div>
      <div className="persona-grid">
        {settings.personas
          .filter((p) => filter === 'all' || p.mode === filter)
          .map((p) => (
            <article
              className="persona-card"
              key={p.id}
              style={{ '--persona-color': p.color } as React.CSSProperties}
            >
              <div className="persona-art">
                <PersonaPortrait
                  persona={p}
                  reducedMotion={settings.reducedMotion}
                  active={previewId === p.id && !editing}
                  onActivate={() => setPreviewId(p.id)}
                />
                <Badge>{p.mode === 'companion' ? '陪伴' : '工作'}</Badge>
              </div>
              <div className="persona-card-body">
                <div className="persona-title">
                  <h2>{p.name}</h2>
                  <div>
                    <IconButton label={'编辑 ' + p.name} onClick={() => edit(p)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      label={'导出 ' + p.name}
                      onClick={() =>
                        download(
                          p.name + '.persona.json',
                          JSON.stringify(p, null, 2),
                          'application/json',
                        )
                      }
                    >
                      <Download size={15} />
                    </IconButton>
                  </div>
                </div>
                <p className="persona-card-subtitle">{p.subtitle}</p>
                <p className="persona-description">{p.description}</p>
                <div className="persona-tags">
                  <span>
                    <Wrench size={12} />
                    {p.tools.length} 项能力
                  </span>
                  <span>{p.language === 'auto' ? '多语言' : p.language}</span>
                  <button
                    onClick={async () => {
                      try {
                        setMemories(await api('/memories'));
                        setMemoryPersona(p);
                      } catch (e) {
                        notify((e as Error).message, 'error');
                      }
                    }}
                  >
                    <Brain size={12} />
                    记忆
                  </button>
                </div>
                <button className="persona-start" onClick={() => onSelect(p.id)}>
                  和{p.name}开始对话
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          ))}
      </div>

      {editing && (
        <PersonaEditor
          persona={editing}
          tools={tools}
          saving={saving}
          onSave={save}
          onClose={() => setEditing(null)}
          onDelete={
            settings.personas.some((p) => p.id === editing.id) && settings.personas.length > 1
              ? async () => {
                  if (!confirm('删除这张人偶卡？')) return;
                  try {
                    await saveSettings({
                      ...settings,
                      personas: settings.personas.filter((p) => p.id !== editing.id),
                    });
                    setEditing(null);
                    notify('人偶卡已删除');
                  } catch (e) {
                    notify((e as Error).message, 'error');
                  }
                }
              : undefined
          }
        />
      )}
      {memoryPersona && (
        <MemoryEditor
          persona={memoryPersona}
          memories={memories.filter((m) => m.personaId === memoryPersona.id)}
          onClose={() => setMemoryPersona(null)}
          onChange={() => api('/memories').then(setMemories)}
          notify={notify}
        />
      )}
    </div>
  );
}
function PersonaPortrait({
  persona,
  reducedMotion,
  active,
  onActivate,
}: {
  persona: Persona;
  reducedMotion: boolean;
  active: boolean;
  onActivate: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="persona-portrait" ref={host}>
      <div className="portrait-window" />
      {visible && active ? (
        <LiveAvatar
          persona={persona}
          compact
          paused={reducedMotion}
          reducedMotion={reducedMotion}
        />
      ) : (
        <button
          className="portrait-activate"
          aria-label={'预览 ' + persona.name + ' 的形象'}
          onClick={onActivate}
        >
          <strong>{persona.name.slice(0, 1)}</strong>
          <span>
            <Eye size={15} />
            预览形象
          </span>
        </button>
      )}
    </div>
  );
}
function PersonaEditor({
  persona,
  tools,
  onClose,
  onSave,
  onDelete,
  saving,
}: {
  persona: Persona;
  tools: ToolInfo[];
  onClose: () => void;
  onSave: (p: Persona) => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const [p, setP] = useState(persona),
    [tab, setTab] = useState('personality');
  const patch = (data: Partial<Persona>) => setP((prev) => ({ ...prev, ...data }));
  const live = (data: Partial<Persona['live']>) => patch({ live: { ...p.live, ...data } });
  return (
    <Modal title="编辑人偶" onClose={onClose} wide>
      <div className="persona-editor">
        <div className="persona-editor-preview">
          <LiveAvatar persona={p} mood="happy" />
          <div>
            <h2>{p.name}</h2>
            <p>{p.subtitle}</p>
            <Badge>{p.mode === 'companion' ? '陪伴型' : '工作型'}</Badge>
          </div>
        </div>
        <div className="persona-editor-form">
          <div className="filter-tabs">
            <button
              className={tab === 'personality' ? 'active' : ''}
              onClick={() => setTab('personality')}
            >
              人格与语言
            </button>
            <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
              Live2D
            </button>
            <button className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>
              工具能力
            </button>
          </div>
          {tab === 'personality' && (
            <>
              <div className="form-grid">
                <Field label="名字">
                  <input
                    value={p.name}
                    maxLength={50}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
                <Field label="类型">
                  <select value={p.mode} onChange={(e) => patch({ mode: e.target.value as any })}>
                    <option value="companion">陪伴型</option>
                    <option value="work">工作型</option>
                  </select>
                </Field>
              </div>
              <Field label="一句话介绍">
                <input value={p.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
              </Field>
              <Field label="关于这位伙伴">
                <textarea
                  rows={2}
                  value={p.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </Field>
              <Field label="人格与系统提示">
                <textarea
                  rows={6}
                  value={p.systemPrompt}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                />
              </Field>
              <Field label="初次见面的问候">
                <textarea
                  rows={2}
                  value={p.greeting}
                  onChange={(e) => patch({ greeting: e.target.value })}
                />
              </Field>
              <div className="form-grid">
                <Field label="回复语言" hint="auto 使用全局语言偏好。">
                  <input value={p.language} onChange={(e) => patch({ language: e.target.value })} />
                </Field>
                <Field
                  label="人偶音色 ID"
                  hint="Fish 填 reference_id；其他服务填 voice ID，或浏览器声音名称。"
                >
                  <input
                    value={p.voice}
                    onChange={(e) => patch({ voice: e.target.value })}
                    placeholder="留空使用默认声音"
                  />
                </Field>
                <Field label="朗读语言" hint="auto 使用全局声音设置。Fish 用于数字与日期的读法。">
                  <input
                    value={p.voiceLanguage}
                    onChange={(e) => patch({ voiceLanguage: e.target.value })}
                    placeholder="auto / zh-CN / en / ja"
                  />
                </Field>
                <Field label="代表符号">
                  <input
                    value={p.symbol}
                    maxLength={8}
                    onChange={(e) => patch({ symbol: e.target.value })}
                  />
                </Field>
                <Field label="人偶色彩">
                  <input
                    type="color"
                    value={p.color}
                    onChange={(e) => patch({ color: e.target.value })}
                  />
                </Field>
              </div>
            </>
          )}
          {tab === 'live' && (
            <>
              <div className="preset-row">
                <button onClick={() => live(structuredClone(defaultPersonas[0].live))}>
                  Hiyori 示例
                </button>
                <button onClick={() => live(structuredClone(defaultPersonas[1].live))}>
                  Haru 示例
                </button>
              </div>
              <Field
                label="模型地址"
                hint="支持 Cubism 3 / 4 的 .model3.json；可使用本地 /models/ 路径或支持跨域的远程地址。"
              >
                <input
                  value={p.live.modelUrl}
                  onChange={(e) => live({ modelUrl: e.target.value })}
                />
              </Field>
              <Field label="Cubism Core 路径" hint="默认随项目部署，可由管理员替换本地运行库。">
                <input value={p.live.coreUrl} onChange={(e) => live({ coreUrl: e.target.value })} />
              </Field>
              <div className="form-grid">
                <Field label={'缩放 · ' + p.live.scale.toFixed(2)}>
                  <input
                    type="range"
                    min="0.2"
                    max="2"
                    step="0.05"
                    value={p.live.scale}
                    onChange={(e) => live({ scale: Number(e.target.value) })}
                  />
                </Field>
                <Field label={'垂直位置 · ' + p.live.offsetY.toFixed(2)}>
                  <input
                    type="range"
                    min="-0.5"
                    max="0.5"
                    step="0.02"
                    value={p.live.offsetY}
                    onChange={(e) => live({ offsetY: Number(e.target.value) })}
                  />
                </Field>
                <Field label="待机动作组">
                  <input
                    value={p.live.idleMotion}
                    onChange={(e) => live({ idleMotion: e.target.value })}
                  />
                </Field>
                <Field label="点击动作组">
                  <input
                    value={p.live.tapMotion}
                    onChange={(e) => live({ tapMotion: e.target.value })}
                  />
                </Field>
              </div>
              <Toggle
                label="目光跟随鼠标"
                checked={p.live.followCursor}
                onChange={(v) => live({ followCursor: v })}
              />
              <h3>情绪 → 表情映射</h3>
              <p className="muted">
                填写模型中实际存在的表情名称；留空表示不切换。语言模型通过 set_emotion
                驱动这些表情。
              </p>
              <div className="form-grid">
                {Object.entries({
                  neutral: '自然',
                  happy: '开心',
                  thinking: '思考',
                  concerned: '关心',
                  excited: '兴奋',
                  calm: '平静',
                }).map(([key, title]) => (
                  <Field key={key} label={title}>
                    <input
                      value={p.live.expressions[key as keyof typeof p.live.expressions] || ''}
                      onChange={(e) =>
                        live({ expressions: { ...p.live.expressions, [key]: e.target.value } })
                      }
                    />
                  </Field>
                ))}
              </div>
              <p className="setting-note">
                内置 Live2D 官方 Haru 与 Hiyori
                示例。人格与模型独立，可以共享形象或连接你自己的授权模型。
              </p>
            </>
          )}
          {tab === 'tools' && (
            <>
              <p className="muted">
                只有启用的工具会出现在这位伙伴的模型上下文中。未配置服务的工具会保持不可用状态。
              </p>
              <div className="persona-tool-list">
                {tools.map((tool) => (
                  <label key={tool.name}>
                    <input
                      type="checkbox"
                      checked={p.tools.includes(tool.name)}
                      disabled={tool.name === 'list_tools'}
                      onChange={(e) =>
                        patch({
                          tools: e.target.checked
                            ? [...p.tools, tool.name]
                            : p.tools.filter((t) => t !== tool.name),
                        })
                      }
                    />
                    <span>
                      <strong>{tool.title}</strong>
                      <small>{tool.description}</small>
                    </span>
                    <Badge color={tool.available ? 'green' : ''}>
                      {tool.available ? '就绪' : '待连接'}
                    </Badge>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        {onDelete ? (
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={14} />
            删除人偶
          </Button>
        ) : (
          <span />
        )}
        <div className="button-row">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" busy={saving} onClick={() => onSave(p)}>
            保存人偶卡
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function MemoryEditor({
  persona,
  memories,
  onClose,
  onChange,
  notify,
}: {
  persona: Persona;
  memories: Memory[];
  onClose: () => void;
  onChange: () => Promise<any>;
  notify: Notify;
}) {
  const [text, setText] = useState('');
  return (
    <Modal title={persona.name + '的记忆'} onClose={onClose}>
      <div className="modal-body">
        <p className="muted">你可以查看、添加或删除这位伙伴记住的事情。</p>
        <div className="memory-list">
          {memories.map((m) => (
            <div key={m.id}>
              <Brain size={15} />
              <p>
                {m.content}
                <small>{new Date(m.created).toLocaleDateString()}</small>
              </p>
              <IconButton
                label="删除这条记忆"
                onClick={async () => {
                  try {
                    await api('/memories/' + m.id, { method: 'DELETE' });
                    await onChange();
                  } catch (e) {
                    notify((e as Error).message, 'error');
                  }
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
        {!memories.length && (
          <Empty
            symbol={<Brain size={25} />}
            title="还没有记忆"
            description="添加一件希望它记住的事。"
          />
        )}
        <Field label="添加一条记忆">
          <textarea
            rows={3}
            value={text}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
            placeholder="例如：我喜欢下雨天和爵士乐。"
          />
        </Field>
        <Button
          variant="primary"
          disabled={!text.trim()}
          onClick={async () => {
            try {
              await post('/memories', { personaId: persona.id, content: text.trim() });
              setText('');
              await onChange();
              notify('记忆已保存');
            } catch (e) {
              notify((e as Error).message, 'error');
            }
          }}
        >
          <Plus size={14} />
          记住这件事
        </Button>
      </div>
    </Modal>
  );
}

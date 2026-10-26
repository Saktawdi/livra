import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Shapes,
  Sparkles,
  Globe,
  Image,
  Presentation,
  Music2,
  Palette,
  Heart,
  Brain,
  List,
  Plug,
} from 'lucide-react';
import { toolSchema, type CustomTool, type Settings, type ToolInfo } from '@livra/shared';
import { api } from './api';
import { PageIntro, Button, IconButton, Badge, Modal, Field, Toggle } from './ui';
import type { Notify } from './App';
const icons: Record<string, any> = {
  list_tools: List,
  set_emotion: Heart,
  remember: Brain,
  web_search: Globe,
  generate_image: Image,
  generate_music: Music2,
  create_slides: Presentation,
  create_marp_theme: Palette,
  create_skin: Palette,
  list_skins: Palette,
  create_persona: Sparkles,
};
export function Tools({
  settings,
  saveSettings,
  notify,
}: {
  settings: Settings;
  saveSettings: (s: Settings) => Promise<Settings>;
  notify: Notify;
}) {
  const [tools, setTools] = useState<ToolInfo[]>([]),
    [filter, setFilter] = useState(''),
    [category, setCategory] = useState('all'),
    [editing, setEditing] = useState<CustomTool | null>(null),
    [saving, setSaving] = useState(false);
  const refresh = () =>
    api<ToolInfo[]>('/tools')
      .then(setTools)
      .catch((e) => notify(e.message, 'error'));
  useEffect(() => {
    refresh();
  }, [settings]);
  async function save(tool: CustomTool) {
    const parsed = toolSchema.safeParse(tool);
    if (!parsed.success) {
      notify(parsed.error.issues[0].message, 'error');
      return;
    }
    if (tools.some((t) => t.name === tool.name && t.category !== 'custom')) {
      notify('这个名字已被内置工具使用', 'error');
      return;
    }
    setSaving(true);
    try {
      const customTools = settings.customTools.some((t) => t.name === tool.name)
        ? settings.customTools.map((t) => (t.name === tool.name ? tool : t))
        : [...settings.customTools, tool];
      await saveSettings({ ...settings, customTools });
      setEditing(null);
      notify('工具已注册，可以在人偶卡中启用');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }
  const filtered = tools.filter(
    (t) =>
      (category === 'all' || t.category === category) &&
      (t.title.includes(filter) || t.name.includes(filter) || t.description.includes(filter)),
  );
  return (
    <div className="content-page tools-page">
      <PageIntro
        eyebrow="LITTLE TOOLS. BIG POSSIBILITIES."
        title="工具"
        description="为人偶启用能力，或接入自己的服务。"
        action={
          <Button
            variant="primary"
            onClick={() =>
              setEditing({
                name: 'my_tool',
                title: '我的工具',
                description: '描述工具的用途与适用场景',
                endpoint: 'https://example.com/api/tool',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                },
                enabled: true,
                apiKey: '',
              })
            }
          >
            <Plus size={16} />
            注册工具
          </Button>
        }
      />
      <div className="toolbox-summary">
        <div>
          <Shapes size={23} />
          <span>
            <strong>{tools.length}</strong> 项已注册能力
          </span>
        </div>
        <div>
          <span className="status-dot" />
          <span>
            <strong>{tools.filter((t) => t.available).length}</strong> 项已就绪
          </span>
        </div>
      </div>
      <div className="page-filter">
        <div className="filter-tabs">
          {[
            { id: 'all', title: '全部能力' },
            { id: 'create', title: '创作' },
            { id: 'live', title: '人偶与记忆' },
            { id: 'research', title: '研究' },
            { id: 'custom', title: '自定义' },
          ].map((c) => (
            <button
              className={category === c.id ? 'active' : ''}
              key={c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.title}
            </button>
          ))}
        </div>
        <div className="inline-search">
          <Search size={15} />
          <input
            placeholder="搜索工具…"
            aria-label="搜索工具"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="tool-grid">
        {filtered.map((tool) => {
          const Icon = icons[tool.name] || Plug;
          return (
            <article className="tool-card" key={tool.name}>
              <div className="tool-card-heading">
                <span className={'tool-icon ' + tool.category}>
                  <Icon size={23} />
                </span>
                <Badge color={tool.available ? 'green' : ''}>
                  {tool.available ? '已就绪' : '等待连接'}
                </Badge>
              </div>
              <h3>{tool.title}</h3>
              <code>{tool.name}</code>
              <p>{tool.description}</p>
              <div className="tool-card-footer">
                <span>{tool.category === 'custom' ? 'HTTP 扩展' : '内置工具'}</span>
                {tool.category === 'custom' ? (
                  <div>
                    <IconButton
                      label={'编辑 ' + tool.title}
                      onClick={() =>
                        setEditing(settings.customTools.find((t) => t.name === tool.name)!)
                      }
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label={'删除 ' + tool.title}
                      onClick={async () => {
                        if (!confirm('移除这个自定义工具？')) return;
                        try {
                          await saveSettings({
                            ...settings,
                            customTools: settings.customTools.filter((t) => t.name !== tool.name),
                          });
                          notify('工具已移除');
                        } catch (e) {
                          notify((e as Error).message, 'error');
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ) : (
                  <span>
                    {settings.personas.filter((p) => p.tools.includes(tool.name)).length}{' '}
                    位伙伴已启用
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!filtered.length && <p className="muted no-results">没有找到匹配的工具。</p>}
      {editing && (
        <ToolEditor
          tool={editing}
          isExisting={settings.customTools.some((t) => t.name === editing.name)}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={save}
          notify={notify}
        />
      )}
    </div>
  );
}
function ToolEditor({
  tool,
  isExisting,
  saving,
  onClose,
  onSave,
  notify,
}: {
  tool: CustomTool;
  isExisting: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (t: CustomTool) => void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(tool),
    [schema, setSchema] = useState(JSON.stringify(tool.inputSchema, null, 2));
  const patch = (p: Partial<CustomTool>) => setDraft((t) => ({ ...t, ...p }));
  return (
    <Modal title="注册工具" onClose={onClose}>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="工具标识" hint="字母开头，可含数字、下划线和连字符。">
            <input
              value={draft.name}
              disabled={isExisting}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="显示名称">
            <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
          </Field>
        </div>
        <Field label="用途说明" hint="模型会据此判断何时调用工具，请描述清楚适用场景。">
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
        <Field label="HTTP POST 地址">
          <input
            type="url"
            value={draft.endpoint}
            onChange={(e) => patch({ endpoint: e.target.value })}
          />
        </Field>
        <Field
          label="Bearer 密钥（可选）"
          hint={draft.hasKey ? '已保存密钥；不编辑则保留。' : undefined}
        >
          <input
            type="password"
            autoComplete="off"
            value={draft.apiKey || ''}
            placeholder={draft.hasKey ? '••••••••' : ''}
            onChange={(e) => patch({ apiKey: e.target.value })}
          />
        </Field>
        <Field label="参数 JSON Schema">
          <textarea
            className="code-editor"
            rows={10}
            spellCheck={false}
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
          />
        </Field>
        <Toggle
          label="启用这个工具"
          checked={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
        <p className="setting-note">
          参数作为 JSON 请求体提交，服务返回 JSON 结果。注册后，还需在人偶卡中开启这项能力。
        </p>
      </div>
      <div className="modal-footer">
        <span />
        <div className="button-row">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            busy={saving}
            onClick={() => {
              try {
                onSave({ ...draft, inputSchema: JSON.parse(schema) });
              } catch {
                notify('JSON Schema 格式有误', 'error');
              }
            }}
          >
            保存工具
          </Button>
        </div>
      </div>
    </Modal>
  );
}

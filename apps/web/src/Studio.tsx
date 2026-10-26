import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Music2,
  Presentation,
  Palette,
  Sparkles,
  ArrowUpRight,
  Plus,
  X,
  Download,
  Square,
  WandSparkles,
  ArrowRight,
  CircleHelp,
  Maximize2,
  ImagePlus,
  Check,
  Clock3,
} from 'lucide-react';
import type { Artifact, Settings } from '@livra/shared';
import { applyMarpTheme, marpThemeName } from '@livra/shared';
import { api, post, download, readAttachment } from './api';
import { Field, Button, IconButton, Badge, Modal, Select } from './ui';
import type { Notify } from './App';
import { useSessionState } from './useSessionState';
import './studio.css';

const initialMarkdown =
  '---\nmarp: true\ntheme: default\npaginate: true\n---\n\n# 项目提案\n\n### 主题 · 目标 · 下一步\n\n在这里写下项目简介。\n\n---\n\n# 实施计划\n\n- 一个明确的目标\n- 三个有力的观点\n- 一个值得行动的下一步\n\n---\n\n# 下一步\n\n**明确负责人和完成时间。**\n';
const initialTheme =
  '/* @theme livra */\n@import "default";\nsection {\n  background: #f8f7f4;\n  color: #252722;\n  font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;\n  padding: 72px;\n}\nh1 { color: #ad4733; font-weight: 600; }\nh2, h3 { color: #62665e; }\nstrong { color: #ad4733; }\nsection::after { color: #8e9586; }';
export function Studio({
  settings,
  onSettings,
  onCreated,
  onAgent,
  notify,
  requestedThemeId,
  onThemeUsed,
}: {
  settings: Settings;
  onSettings: () => void;
  onCreated: () => void;
  onAgent: (p: string) => void;
  notify: Notify;
  requestedThemeId: string;
  onThemeUsed: () => void;
}) {
  const [tab, setTab] = useSessionState('tab', 'image'),
    [prompt, setPrompt] = useSessionState('prompt', ''),
    [lyrics, setLyrics] = useSessionState('lyrics', ''),
    [duration, setDuration] = useSessionState('duration', 30),
    [size, setSize] = useSessionState('size', '1024x1024'),
    [reference, setReference] = useState(''),
    [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<Artifact | null>(null),
    [error, setError] = useState(''),
    [zoom, setZoom] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0),
    [referenceDragging, setReferenceDragging] = useState(false);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const [themes, setThemes] = useState<Artifact[]>([]),
    [themeId, setThemeId] = useSessionState('themeId', '');
  const appliedTheme = themes.find((t) => t.id === themeId)?.data.css as string | undefined;
  const [markdown, setMarkdown] = useSessionState('markdown', initialMarkdown),
    [theme, setTheme] = useSessionState('theme', initialTheme.replace('@import "default";\n', '')),
    [themeName, setThemeName] = useSessionState('themeName', 'livra'),
    [title, setTitle] = useSessionState('title', '未命名演示'),
    [preview, setPreview] = useState(''),
    [previewError, setPreviewError] = useState(''),
    [previewBusy, setPreviewBusy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    referenceRef = useRef<HTMLInputElement>(null);
  const kind = tab === 'music' ? 'music' : 'image';
  const options = settings.providers
    .filter((p) => p.kind === kind)
    .flatMap((p) => p.models.map((m) => ({ id: p.id, model: m, name: p.name })));
  useEffect(() => {
    if (tab === 'slides' || requestedThemeId)
      api<Artifact[]>('/artifacts')
        .then((items) => setThemes(items.filter((a) => a.kind === 'theme')))
        .catch((e) => notify(e.message, 'error'));
  }, [tab, requestedThemeId]);
  function chooseTheme(id: string) {
    setThemeId(id);
    const css = themes.find((t) => t.id === id)?.data.css;
    const name = css ? marpThemeName(css) || 'default' : 'default';
    setMarkdown((m) => applyMarpTheme(m, name));
  }
  useEffect(() => {
    if (!requestedThemeId || !themes.some((t) => t.id === requestedThemeId)) return;
    setTab('slides');
    chooseTheme(requestedThemeId);
    onThemeUsed();
  }, [requestedThemeId, themes]);
  useEffect(() => {
    setResult(null);
    setError('');
  }, [tab]);
  useEffect(() => {
    const id = kind === 'image' ? settings.imageProvider : settings.musicProvider,
      m = kind === 'image' ? settings.imageModel : settings.musicModel;
    const valid = (value: string) => options.some((o) => o.id + '|' + o.model === value);
    setSelection((current) =>
      valid(current)
        ? current
        : id && m && valid(id + '|' + m)
          ? id + '|' + m
          : options.length
            ? options[0].id + '|' + options[0].model
            : '',
    );
  }, [
    kind,
    settings.providers,
    settings.imageProvider,
    settings.imageModel,
    settings.musicProvider,
    settings.musicModel,
  ]);
  useEffect(() => {
    if (!['slides', 'theme'].includes(tab)) return;
    const abort = new AbortController();
    setPreviewBusy(true);
    const timer = setTimeout(() => {
      post(
        '/slides/preview',
        {
          markdown:
            tab === 'theme'
              ? `---\ntheme: ${themeName}\n---\n# 项目提案\n\n## 主题排版预览\n\n正文示例：清晰的标题与可读的内容。\n\n---\n\n# 内容页面`
              : markdown,
          ...(tab === 'theme' ? { theme } : appliedTheme ? { theme: appliedTheme } : {}),
        },
        { signal: abort.signal },
      )
        .then((d) => {
          setPreview(d.html);
          setPreviewError('');
        })
        .catch((e) => {
          if (!abort.signal.aborted) setPreviewError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setPreviewBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [tab, markdown, theme, themeName, appliedTheme]);
  useEffect(() => () => controller.current?.abort(), []);
  async function addReference(file?: File) {
    if (!file) return;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw Error('参考图支持 PNG、JPEG 和 WebP');
      const attachment = await readAttachment(file);
      setReference(attachment.data);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }
  async function generate() {
    if (busy) return;
    if (['image', 'music'].includes(tab) && !selection) {
      onSettings();
      return;
    }
    if (['image', 'music'].includes(tab) && !prompt.trim()) {
      notify('请填写创作描述', 'error');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      let name, args: any;
      if (tab === 'image') {
        name = 'generate_image';
        args = { prompt, size, ...(reference ? { image: reference } : {}) };
      } else if (tab === 'music') {
        name = 'generate_music';
        args = { prompt, lyrics, duration };
      } else if (tab === 'theme') {
        name = 'create_marp_theme';
        args = { name: themeName, css: theme };
      } else {
        name = 'create_slides';
        args = { title, markdown, ...(themeId ? { themeId } : {}) };
      }
      const [providerId, ...model] = selection.split('|');
      const data = await post(
        '/tools/execute',
        { name, args, providerId, model: model.join('|') },
        { signal: abort.signal },
      );
      const artifact = await api<Artifact>('/artifacts/' + data.artifactId, {
        signal: abort.signal,
      });
      setResult(artifact);
      if (artifact.kind === 'theme')
        setThemes((items) => [artifact, ...items.filter((t) => t.id !== artifact.id)]);
      onCreated();
      notify('作品已保存');
    } catch (e) {
      if (abort.signal.aborted) setError('创作已停止，你可以调整后再试。');
      else setError((e as Error).message);
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  const tabs = [
    {
      id: 'image',
      name: '图像',
      icon: Image,
      title: '让脑海里的画面，成为作品。',
    },
    {
      id: 'music',
      name: '音乐',
      icon: Music2,
      title: '给此刻的灵感，一段旋律。',
    },
    {
      id: 'slides',
      name: '演示文稿',
      icon: Presentation,
      title: '把一个好想法，讲得更清楚。',
    },
    {
      id: 'theme',
      name: 'Marp 主题',
      icon: Palette,
      title: '为你的表达，定下自己的风格。',
    },
  ];
  const currentTab = tabs.find((item) => item.id === tab) || tabs[0];
  const askAgent = () =>
    onAgent(
      tab === 'image'
        ? '我想创作一张图片。请先帮我完善画面描述、构图和风格，再使用 generate_image 完成创作。'
        : tab === 'music'
          ? '我想创作一段音乐。请先帮我确定曲风、乐器、氛围和时长，再使用 generate_music 完成创作。'
          : tab === 'slides'
            ? '帮我生成一份完整的 Marp 演示文稿。请先问我主题、受众和页数，再使用 create_slides 工具完成并保存。'
            : '帮我设计一款独特的 Marp 演示文稿主题。请先询问我想要的配色、风格和用途，生成完整 CSS 后使用 create_marp_theme 工具保存。',
    );
  return (
    <div
      className="content-page studio-page"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void generate();
        }
      }}
    >
      <div className="studio-navigation">
        <div className="studio-tabs" role="tablist" aria-label="创作类型">
          {tabs.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              disabled={busy}
              onClick={() => setTab(id)}
              role="tab"
              id={'studio-tab-' + id}
              aria-controls="studio-workbench"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || busy) return;
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? tabs.length - 1
                      : (tabs.findIndex((item) => item.id === tab) +
                          (e.key === 'ArrowRight' ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                setTab(tabs[next].id);
                document.getElementById('studio-tab-' + tabs[next].id)?.focus();
              }}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </div>
        <div className="studio-navigation-actions">
          <span className="studio-draft-note">
            <Check size={12} />
            草稿自动保留
          </span>
          <Button variant="ghost" onClick={askAgent} disabled={busy}>
            <Sparkles size={15} />
            和伙伴一起创作
            <ArrowUpRight size={14} />
          </Button>
        </div>
      </div>
      <div
        className={'studio-workbench ' + (['slides', 'theme'].includes(tab) ? 'editor-mode' : '')}
        id="studio-workbench"
        role="tabpanel"
        aria-labelledby={'studio-tab-' + currentTab.id}
      >
        <div className="studio-controls">
          {['image', 'music'].includes(tab) ? (
            <>
              <Field label={tab === 'image' ? '画面描述' : '音乐灵感'}>
                <textarea
                  rows={5}
                  placeholder={
                    tab === 'image'
                      ? '一间雨天的独立书店，温暖的灯光落在旧书页上。窗外是模糊的城市，水彩质感，安静而治愈…'
                      : '一首适合雨天阅读的轻爵士。柔和的钢琴、低音提琴与轻微的雨声，节奏松弛，带一点温暖的怀旧感…'
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </Field>
              <button
                className="inspiration-link"
                onClick={() =>
                  setPrompt(
                    tab === 'image'
                      ? '一座漂浮在云海上的小屋，屋前种满鼠尾草与野花，柔和的晨光，细腻的纸张纹理，温暖的插画风格。'
                      : '轻柔的原声吉他与钢琴对话，像午后穿过树叶的光。温暖、通透、有呼吸感，无人声。',
                  )
                }
              >
                <Sparkles size={13} />
                填入示例
              </button>
              {tab === 'image' ? (
                <>
                  <Field label="参考图（可选）">
                    <div
                      className={'reference-upload' + (referenceDragging ? ' is-dragging' : '')}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setReferenceDragging(true);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          setReferenceDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setReferenceDragging(false);
                        void addReference(e.dataTransfer.files[0]);
                      }}
                    >
                      {reference ? (
                        <>
                          <img src={reference} alt="参考图" />
                          <IconButton label="移除参考图" onClick={() => setReference('')}>
                            <X size={14} />
                          </IconButton>
                        </>
                      ) : (
                        <button onClick={() => referenceRef.current?.click()}>
                          <ImagePlus size={22} />
                          <span>
                            添加参考图<small>点击上传，或拖动图片到这里</small>
                          </span>
                          <Plus size={15} />
                        </button>
                      )}
                    </div>
                    <input
                      type="file"
                      hidden
                      ref={referenceRef}
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        await addReference(file);
                      }}
                    />
                  </Field>
                  <Field label="画面比例">
                    <div className="ratio-options">
                      {[
                        { value: '1024x1024', label: '1:1', shape: 'square' },
                        { value: '1536x1024', label: '3:2', shape: 'landscape' },
                        { value: '1024x1536', label: '2:3', shape: 'portrait' },
                      ].map((s) => (
                        <button
                          key={s.value}
                          className={size === s.value ? 'active' : ''}
                          onClick={() => setSize(s.value)}
                          aria-pressed={size === s.value}
                        >
                          <span className={s.shape} />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="歌词（可选）">
                    <textarea
                      rows={4}
                      placeholder="把想唱的话，写在这里。"
                      value={lyrics}
                      onChange={(e) => setLyrics(e.target.value)}
                    />
                  </Field>
                  <Field label={'时长 · ' + duration + ' 秒'}>
                    <input
                      type="range"
                      min={5}
                      max={180}
                      step={5}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    />
                  </Field>
                </>
              )}
              <Field label={tab === 'image' ? '图像模型' : '音乐模型'}>
                <Select
                  value={selection}
                  onChange={setSelection}
                  searchable
                  options={[
                    { value: '', label: '选择已连接的模型' },
                    ...options.map((o) => ({
                      value: o.id + '|' + o.model,
                      label: o.model,
                      group: o.name,
                    })),
                  ]}
                />
              </Field>
              {!options.length && (
                <button className="text-link" onClick={onSettings}>
                  连接{tab === 'image' ? '图像' : '音乐'}模型
                  <ArrowUpRight size={13} />
                </button>
              )}
            </>
          ) : (
            <>
              {tab === 'slides' ? (
                <>
                  <Field label="作品标题">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </Field>
                  <Field label="主题">
                    <Select
                      value={themeId}
                      onChange={chooseTheme}
                      options={[
                        { value: '', label: '默认' },
                        ...themes.map((t) => ({ value: t.id, label: t.title })),
                      ]}
                    />
                  </Field>
                  <Field label="Marp Markdown">
                    <textarea
                      className="code-editor"
                      spellCheck={false}
                      rows={20}
                      value={markdown}
                      onChange={(e) => setMarkdown(e.target.value)}
                    />
                  </Field>
                  <button
                    className="inspiration-link"
                    onClick={() =>
                      onAgent(
                        '帮我生成一份完整的 Marp 演示文稿。请先问我主题、受众和页数，再使用 create_slides 工具完成并保存。',
                      )
                    }
                  >
                    <Sparkles size={14} />让 Agent 帮我创作
                    <ArrowUpRight size={12} />
                  </button>
                </>
              ) : (
                <>
                  <Field label="主题名称">
                    <input
                      value={themeName}
                      onChange={(e) => {
                        const name = e.target.value;
                        setThemeName(name);
                        setTheme((t) =>
                          t.replace(/\/\*\s*@theme[^*]*\*\//, `/* @theme ${name} */`),
                        );
                      }}
                    />
                  </Field>
                  <Field label="主题 CSS">
                    <textarea
                      className="code-editor"
                      spellCheck={false}
                      rows={20}
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                    />
                  </Field>
                  <button
                    className="inspiration-link"
                    onClick={() =>
                      onAgent(
                        '帮我设计一款独特的 Marp 演示文稿主题。请先询问我想要的配色、风格和用途，生成完整 CSS 后使用 create_marp_theme 工具保存。',
                      )
                    }
                  >
                    <Sparkles size={14} />让 AI 设计主题
                    <ArrowUpRight size={12} />
                  </button>
                </>
              )}
            </>
          )}
          {error && (
            <div className="error-box" role="alert">
              <CircleHelp size={16} />
              {error}
            </div>
          )}
          <div className="studio-generate">
            {busy ? (
              <>
                <Button variant="primary" busy>
                  正在创作… {elapsed}s
                </Button>
                <IconButton label="停止创作" onClick={() => controller.current?.abort()}>
                  <Square size={15} />
                </IconButton>
              </>
            ) : (
              <Button variant="primary" onClick={generate}>
                <WandSparkles size={16} />
                {tab === 'image'
                  ? '开始生图'
                  : tab === 'music'
                    ? '生成音乐'
                    : tab === 'slides'
                      ? '保存演示文稿'
                      : '保存主题'}
                <ArrowRight size={15} />
              </Button>
            )}
          </div>
          <p className="studio-save-note">
            {['image', 'music'].includes(tab)
              ? '生成后自动保存到作品集'
              : '保存后可在作品集中再次使用'}
            <kbd>Ctrl ↵</kbd>
          </p>
        </div>
        <div className={'studio-canvas canvas-' + tab} aria-busy={busy || previewBusy}>
          {!['slides', 'theme'].includes(tab) && (
            <div className="canvas-heading">
              <span>
                <i className="canvas-status-dot" />
                {busy ? '创作进行中' : result ? '你的作品' : '创作预览'}
              </span>
              <span className="canvas-format">
                {tab === 'image' ? size.replace('x', ' × ') : duration + ' 秒'}
              </span>
            </div>
          )}
          {['slides', 'theme'].includes(tab) ? (
            <>
              <div className="canvas-heading">
                <span role="status">{previewBusy ? '正在更新预览…' : '实时预览'}</span>
                <Badge>{tab === 'slides' ? 'MARP' : 'CSS THEME'}</Badge>
              </div>
              {previewError ? (
                <div className="error-box">{previewError}</div>
              ) : !preview && previewBusy ? (
                <div className="studio-preview-loading" role="status">
                  <Presentation size={28} />
                  <span>正在准备预览…</span>
                  <i />
                </div>
              ) : (
                <iframe
                  className="slide-preview"
                  sandbox=""
                  srcDoc={preview}
                  title="演示文稿预览"
                  aria-busy={previewBusy}
                />
              )}
              {result && (
                <div className="studio-result-footer">
                  <CheckIcon />
                  <span>已保存：{result.title}</span>
                  <Button
                    onClick={() =>
                      download(
                        result.kind === 'theme' ? themeName + '.css' : title + '.md',
                        result.kind === 'theme' ? result.data.css : result.data.markdown,
                      )
                    }
                  >
                    <Download size={14} />
                    下载源文件
                  </Button>
                </div>
              )}
            </>
          ) : busy ? (
            <div className="generation-wait">
              <div className="generation-orbit">
                <Sparkles size={35} />
                <i />
                <i />
              </div>
              <h2>正在生成</h2>
              <p>
                {tab === 'image' ? '正在描绘你的灵感，稍等片刻。' : '正在谱写你的旋律，稍等片刻。'}
              </p>
              <span className="generation-time">
                <Clock3 size={13} />
                {elapsed} 秒
              </span>
              <div className="loading-bars">
                <i />
                <i />
                <i />
              </div>
            </div>
          ) : result ? (
            <div className="studio-result">
              {result.kind === 'image' ? (
                <div className="generated-images">
                  {result.data.images.map((image: string, index: number) => (
                    <div key={index}>
                      <img src={image} alt={result.title} />
                      <div>
                        <IconButton label="放大图片" onClick={() => setZoom(image)}>
                          <Maximize2 size={17} />
                        </IconButton>
                        <a
                          href={image}
                          download={`livra-image-${index + 1}.png`}
                          className="icon-button"
                          aria-label="下载图片"
                        >
                          <Download size={17} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="audio-result">
                  <div className="vinyl">
                    <Music2 size={38} />
                  </div>
                  <h2>{result.title}</h2>
                  <audio controls src={result.data.audio} />
                  <a
                    href={result.data.audio}
                    download="livra-music.mp3"
                    className="button secondary"
                  >
                    <Download size={15} />
                    下载音频
                  </a>
                </div>
              )}
              <div className="studio-result-caption">
                <div>
                  <Badge color="green">已保存</Badge>
                  <small>{result.data.model}</small>
                </div>
                <p>{result.data.prompt}</p>
              </div>
            </div>
          ) : (
            <div className="studio-empty">
              <div
                className={'studio-artwork ' + (tab === 'music' ? 'musical' : '')}
                aria-hidden="true"
              >
                <div className="artwork-frame">
                  <span className="artwork-topline">
                    <i />
                    <i />
                    <i />
                  </span>
                  {tab === 'image' ? (
                    <div className="artwork-landscape">
                      <span className="artwork-sun" />
                      <span className="artwork-mountain back" />
                      <span className="artwork-mountain front" />
                      <span className="artwork-grain" />
                    </div>
                  ) : (
                    <div className="artwork-wave">
                      {[18, 28, 42, 25, 54, 72, 46, 84, 60, 38, 68, 48, 30, 50, 24, 14].map(
                        (height, index) => (
                          <i key={index} style={{ height: height + '%' }} />
                        ),
                      )}
                    </div>
                  )}
                  <div className="artwork-caption">
                    <span />
                    <i />
                    <i />
                  </div>
                </div>
                <span className="artwork-spark">
                  <Sparkles size={18} />
                </span>
              </div>
              <span className="studio-empty-eyebrow">
                {tab === 'image' ? 'A LITTLE IDEA, A NEW PERSPECTIVE' : 'FIND YOUR OWN RHYTHM'}
              </span>
              <h2>{currentTab.title}</h2>
              <p>
                {tab === 'image'
                  ? '填写画面描述，或添加参考图。生成结果会显示在这里。'
                  : '描述曲风、乐器和氛围，按需填写歌词。'}
              </p>
              <button
                className="studio-empty-start"
                onClick={() =>
                  document.querySelector<HTMLTextAreaElement>('.studio-controls textarea')?.focus()
                }
              >
                {tab === 'image' ? '写下第一句灵感' : '写下你想听的声音'}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      {zoom && (
        <Modal title="作品预览" wide onClose={() => setZoom(null)}>
          <div className="image-zoom">
            <img src={zoom} alt="生成作品" />
          </div>
        </Modal>
      )}
    </div>
  );
}
function CheckIcon() {
  return <span className="status-dot" />;
}

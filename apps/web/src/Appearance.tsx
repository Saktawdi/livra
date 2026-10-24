import { useEffect, useRef, useState } from 'react';
import type { Settings, Artifact } from '@livra/shared';
import { skinPackageSchema, skinSettings } from '@livra/shared';
import { Button, Field, Section, Select, Toggle } from './ui';
import { api, download } from './api';
import { SkinPreview } from './SkinArtifact';
import type { Notify } from './App';

export const skins = [
  {
    id: 'orbit',
    name: 'ORBIT · 深空',
    description: '星轨 Canvas · 悬浮导航 · 透明空间',
    theme: 'dark',
  },
  {
    id: 'paper',
    name: 'FOLIO · 纸页',
    description: '书刊衬线 · 墨线分隔 · 平面阅读',
    theme: 'light',
  },
  { id: 'veil', name: 'VEIL · 轻透', description: '柔光场 · 岛屿布局 · 轻盈气泡', theme: 'light' },
] as const;

async function readBackground(file: File) {
  if (!/^image\/(png|jpeg|webp|avif)$/.test(file.type) || file.size > 20_000_000)
    throw Error('请选择 20 MB 以内的 PNG、JPEG、WebP 或 AVIF 图片');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, 1920 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * ratio);
    canvas.height = Math.round(image.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('无法读取图片');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.84);
    if (result.length > 4_000_000) throw Error('图片过大，请使用更小的图片');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Appearance({
  settings,
  patch,
  notify,
  onDesign,
}: {
  settings: Settings;
  patch: (p: Partial<Settings>) => void;
  notify: Notify;
  onDesign: (prompt: string) => void;
}) {
  const a = settings.appearance;
  const update = (p: Partial<typeof a>) => patch({ appearance: { ...a, ...p } });
  const file = useRef<HTMLInputElement>(null),
    imported = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [savedSkins, setSavedSkins] = useState<Artifact[]>([]),
    [loadingSkins, setLoadingSkins] = useState(true),
    [skinError, setSkinError] = useState('');
  const [skinRequest, setSkinRequest] = useState(
    '深空、科幻而简洁，轻薄的悬浮导航，玻璃输入区，缓慢流动的星光。',
  );
  useEffect(() => {
    const controller = new AbortController();
    api<Artifact[]>('/artifacts', { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted) setSavedSkins(items.filter((a) => a.kind === 'skin'));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSkinError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSkins(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="appearance-editor">
      {a.design ? (
        <SkinPreview
          skin={{
            version: 2,
            name: settings.activeSkinName || '自定义空间',
            description: '',
            appearance: a,
            theme: settings.theme,
            accent: settings.accent,
          }}
        />
      ) : (
        <div className={'appearance-live-preview preview-' + a.skin} aria-label="实时聊天外观预览">
          <div
            className="appearance-preview-image"
            style={{
              backgroundImage: a.backgroundImage
                ? `url(${JSON.stringify(a.backgroundImage)})`
                : undefined,
              opacity: a.backgroundOpacity,
              filter: `blur(${a.backgroundBlur}px)`,
              backgroundPosition: a.backgroundPosition,
            }}
          />
          <div className="preview-navigation">
            <span>livra</span>
            <i />
            <i />
            <i />
          </div>
          <div className="preview-conversation">
            <small>即时预览</small>
            <h4>
              {a.skin === 'orbit'
                ? '给灵感，一片宇宙。'
                : a.skin === 'paper'
                  ? '把思绪，写成新的一页。'
                  : '让每一天，轻一点。'}
            </h4>
            <div className="message user">
              <div className="message-body">一起探索新的想法吧。</div>
            </div>
            <div className="message assistant">
              <div className="message-body">我在这里，随时出发。</div>
            </div>
            <div className="preview-composer">
              写下此刻的想法…<span>↑</span>
            </div>
          </div>
        </div>
      )}
      <Section
        title="让 Agent 设计皮肤"
        description="描述想要的空间，伙伴会生成可预览、复用的皮肤作品。"
      >
        <Field label="你想要怎样的空间？">
          <textarea
            rows={3}
            maxLength={4000}
            value={skinRequest}
            onChange={(e) => setSkinRequest(e.target.value)}
          />
        </Field>
        <Button disabled={!skinRequest.trim()} onClick={() => onDesign(skinRequest)}>
          带到对话中设计
        </Button>
      </Section>
      <Section
        title="皮肤 · 不同的空间"
        description="所有调整即时预览，保存后保留；取消会恢复之前的外观。"
      >
        <div className="skin-catalog">
          {skins.map((s) => (
            <button
              key={s.id}
              className={'skin-choice ' + s.id}
              aria-pressed={!a.design && a.skin === s.id}
              onClick={() =>
                patch({
                  appearance: { ...a, skin: s.id, design: undefined },
                  theme: s.theme,
                  activeSkinName: '',
                })
              }
            >
              <div className="skin-mini">
                <i />
                <div>
                  <span />
                  <span />
                  <b />
                </div>
                <em>✧</em>
              </div>
              <strong>{s.name}</strong>
              <small>{s.description}</small>
            </button>
          ))}
        </div>
        {a.design && (
          <div className="saved-skin-summary">
            <strong>{settings.activeSkinName || '自定义空间'}</strong>
            <span className="muted">正在使用生成的设计</span>
          </div>
        )}
        <Field label="作品中的皮肤">
          <Select
            value=""
            loading={loadingSkins}
            error={skinError}
            placeholder={savedSkins.length ? '选择已生成的皮肤…' : '生成的皮肤会保存在这里'}
            searchable
            options={savedSkins.map((item) => ({
              value: item.id,
              label: item.title,
              description: item.data.skin?.description,
            }))}
            onChange={(id) => {
              const item = savedSkins.find((s) => s.id === id);
              const parsed = skinPackageSchema.safeParse(item?.data.skin);
              if (parsed.success) patch(skinSettings(parsed.data));
              else notify('皮肤格式无效', 'error');
            }}
          />
        </Field>
        <div className="row gap skin-file-actions">
          <Button
            onClick={() =>
              download(
                'livra-skin.json',
                JSON.stringify(
                  {
                    version: 2,
                    name:
                      settings.activeSkinName ||
                      skins.find((s) => s.id === a.skin)?.name ||
                      '我的皮肤',
                    description: '',
                    appearance: a,
                    theme: settings.theme,
                    accent: settings.accent,
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            导出皮肤
          </Button>
          <Button onClick={() => imported.current?.click()}>导入皮肤</Button>
        </div>
        <input
          ref={imported}
          hidden
          type="file"
          accept=".json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              if (f.size > 4_100_000) throw Error('皮肤文件过大');
              const raw = JSON.parse(await f.text());
              const parsed = skinPackageSchema.parse(raw);
              patch(skinSettings(parsed));
            } catch {
              notify('皮肤文件格式无效', 'error');
            }
          }}
        />
      </Section>
      <Section title="色彩与形态">
        <div className="form-grid">
          <Field label="显示模式">
            <Select
              value={settings.theme}
              onChange={(v) => patch({ theme: v as Settings['theme'] })}
              options={[
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
                { value: 'system', label: '跟随系统' },
              ]}
            />
          </Field>
          <Field label="点缀色">
            <Select
              value={settings.accent}
              onChange={(v) => patch({ accent: v as Settings['accent'] })}
              options={[
                { value: 'sage', label: '鼠尾草' },
                { value: 'iris', label: '鸢尾紫' },
                { value: 'ocean', label: '雾海蓝' },
                { value: 'rose', label: '玫瑰灰' },
              ]}
            />
          </Field>
          <Field label="聊天气泡">
            <Select
              value={a.bubble}
              onChange={(v) => update({ bubble: v as typeof a.bubble })}
              options={[
                { value: 'soft', label: '柔和填充' },
                { value: 'line', label: '细线轮廓' },
                { value: 'plain', label: '纯文字' },
              ]}
            />
          </Field>
          <Field label="空间密度">
            <Select
              value={a.density}
              onChange={(v) => update({ density: v as typeof a.density })}
              options={[
                { value: 'comfortable', label: '舒展' },
                { value: 'compact', label: '紧凑' },
              ]}
            />
          </Field>
          <Field label={`气泡圆角 · ${a.radius}px`}>
            <input
              type="range"
              min="0"
              max="28"
              value={a.radius}
              onChange={(e) => update({ radius: +e.target.value })}
            />
          </Field>
        </div>
      </Section>
      <Section
        title="你的背景"
        description="上传的图片会随偏好设置保存，也可以使用 HTTPS 图片地址。"
      >
        <div className="row gap">
          <Button disabled={uploading} onClick={() => file.current?.click()}>
            {uploading ? '正在处理图片…' : '上传背景图'}
          </Button>
          <Button disabled={!a.backgroundImage} onClick={() => update({ backgroundImage: '' })}>
            移除背景
          </Button>
        </div>
        <input
          ref={file}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setUploading(true);
            try {
              update({ backgroundImage: await readBackground(f) });
            } catch (err) {
              notify((err as Error).message, 'error');
            } finally {
              setUploading(false);
            }
          }}
        />
        <Field label="背景图地址">
          <input
            type="url"
            placeholder="https://…"
            value={a.backgroundImage.startsWith('data:') ? '' : a.backgroundImage}
            onChange={(e) => update({ backgroundImage: e.target.value })}
          />
        </Field>
        {a.backgroundImage && (
          <img className="background-thumbnail" src={a.backgroundImage} alt="当前背景" />
        )}
        <div className="form-grid">
          <Field label={`背景强度 · ${Math.round(a.backgroundOpacity * 100)}%`}>
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              value={a.backgroundOpacity}
              onChange={(e) => update({ backgroundOpacity: +e.target.value })}
            />
          </Field>
          <Field label={`模糊 · ${a.backgroundBlur}px`}>
            <input
              type="range"
              min="0"
              max="30"
              value={a.backgroundBlur}
              onChange={(e) => update({ backgroundBlur: +e.target.value })}
            />
          </Field>
          <Field label="背景对齐">
            <Select
              value={a.backgroundPosition}
              onChange={(v) => update({ backgroundPosition: v as typeof a.backgroundPosition })}
              options={[
                { value: 'center', label: '居中' },
                { value: 'top', label: '顶部' },
                { value: 'bottom', label: '底部' },
              ]}
            />
          </Field>
        </div>
      </Section>
      <Section title="环境动效">
        <Toggle
          label="Canvas 环境动画"
          description="深空星轨与柔光流动；纸页皮肤保持安静。"
          checked={a.animation}
          onChange={(animation) => update({ animation })}
        />
        <Toggle
          label="减少动态效果"
          description="停止环境动画并减少人偶跟随与过渡。"
          checked={settings.reducedMotion}
          onChange={(reducedMotion) => patch({ reducedMotion })}
        />
      </Section>
    </div>
  );
}

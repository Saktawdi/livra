import { useEffect, useState, type CSSProperties } from 'react';
import { Download, Eye, Check, RotateCcw } from 'lucide-react';
import {
  skinPackageSchema,
  skinSettings,
  skinVariables,
  type Settings,
  type SkinPackage,
} from '@livra/shared';
import { Button } from './ui';
import { download } from './api';
import type { Notify } from './App';

export type AppearancePreview = (settings: Settings | null) => void;
export function SkinPreview({ skin, compact = false }: { skin: SkinPackage; compact?: boolean }) {
  const d = skin.appearance.design;
  const vars = {
    ...skinVariables(d),
    '--bubble-radius': skin.appearance.radius + 'px',
  } as CSSProperties;
  const color = d?.motion.color || '#88bfff';
  const effect = d?.motion.effect || 'none';
  return (
    <div
      className="skin-render"
      style={vars}
      data-navigation={d?.navigation}
      data-composer={d?.composer}
      data-bubble={skin.appearance.bubble}
      role="img"
      aria-label={skin.name + ' · 皮肤预览'}
    >
      {skin.appearance.backgroundImage && (
        <div
          className="skin-render-glow"
          style={{
            backgroundImage: `url(${JSON.stringify(skin.appearance.backgroundImage)})`,
            backgroundPosition: skin.appearance.backgroundPosition,
            filter: `blur(${skin.appearance.backgroundBlur}px)`,
            opacity: skin.appearance.backgroundOpacity,
          }}
        />
      )}
      <div
        className="skin-render-glow"
        style={{
          backgroundImage:
            effect === 'grid'
              ? `linear-gradient(${color}30 1px, transparent 1px),linear-gradient(90deg,${color}30 1px,transparent 1px)`
              : effect !== 'none'
                ? `radial-gradient(ellipse at 80% 10%, ${color}80, transparent 70%)`
                : undefined,
          backgroundSize: effect === 'grid' ? '32px 32px' : undefined,
        }}
      />
      <aside>
        <b>l.</b>
        <i />
        <i />
        <i />
      </aside>
      <main>
        <small>{compact ? 'GENERATED SPACE' : '你的下一种空间'}</small>
        <h4>{skin.name}</h4>
        <p className="skin-render-message">给灵感一个新的起点。</p>
        {!compact && <p>我在这里，和你一起把想法变成现实。</p>}
        <div className="skin-render-composer">
          <span>写下此刻的想法…</span>
          <b>↑</b>
        </div>
        {d && (
          <div className="skin-render-swatches">
            {Object.values(d.palette)
              .slice(0, 6)
              .map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
          </div>
        )}
      </main>
    </div>
  );
}
export function SkinArtifact({
  value,
  settings,
  saveSettings,
  onPreview,
  notify,
}: {
  value: unknown;
  settings: Settings;
  saveSettings: (s: Settings) => Promise<Settings>;
  onPreview: AppearancePreview;
  notify: Notify;
}) {
  const parsed = skinPackageSchema.safeParse(value);
  const [previewing, setPreviewing] = useState(false),
    [saving, setSaving] = useState(false);
  useEffect(() => () => onPreview(null), [onPreview]);
  if (!parsed.success) return <p className="error-box">皮肤格式无效，无法预览或应用。</p>;
  const skin = parsed.data;
  return (
    <div className="skin-artifact">
      <SkinPreview skin={skin} />
      {skin.description && <p className="skin-artifact-description">{skin.description}</p>}
      <div className="skin-artifact-controls">
        <Button
          aria-pressed={previewing}
          onClick={() => {
            onPreview(previewing ? null : { ...settings, ...skinSettings(skin) });
            setPreviewing(!previewing);
          }}
        >
          {previewing ? <RotateCcw size={15} /> : <Eye size={15} />}
          {previewing ? '退出页面预览' : '在当前页面预览'}
        </Button>
        <Button
          variant="primary"
          busy={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await saveSettings({ ...settings, ...skinSettings(skin) });
              onPreview(null);
              setPreviewing(false);
              notify('已应用皮肤「' + skin.name + '」');
            } catch (e) {
              notify((e as Error).message, 'error');
            } finally {
              setSaving(false);
            }
          }}
        >
          <Check size={15} />
          应用皮肤
        </Button>
        <Button
          onClick={() =>
            download(skin.name + '.skin.json', JSON.stringify(skin, null, 2), 'application/json')
          }
        >
          <Download size={15} />
          导出皮肤
        </Button>
      </div>
      {previewing && (
        <p className="setting-note" role="status">
          正在临时预览。关闭作品会恢复；点击「应用皮肤」后保存。
        </p>
      )}
    </div>
  );
}

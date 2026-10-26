import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { liveModelCatalog, liveModelSchema, personaSchema, type Settings } from '@livra/shared';
import { LiveAvatar } from './LiveAvatar';
import { Button } from './ui';
import type { Notify } from './App';

export function PersonaArtifact({
  persona,
  liveModel,
  settings,
  saveSettings,
  notify,
}: {
  persona: unknown;
  liveModel?: unknown;
  settings: Settings;
  saveSettings: (s: Settings) => Promise<Settings>;
  notify: Notify;
}) {
  const [saving, setSaving] = useState(false),
    [added, setAdded] = useState(false);
  const parsed = personaSchema.safeParse(persona);
  if (!parsed.success)
    return (
      <p className="error-box" role="alert">
        这张人偶卡的配置不完整。
      </p>
    );
  const p = parsed.data;
  const parsedShape = liveModelSchema.safeParse(liveModel);
  const shape =
    liveModelCatalog(settings).find((m) => m.live.modelUrl === p.live.modelUrl) ||
    (parsedShape.success && parsedShape.data.live.modelUrl === p.live.modelUrl
      ? parsedShape.data
      : undefined);
  return (
    <div className="persona-artifact">
      <div className="persona-artifact-stage">
        <LiveAvatar persona={p} reducedMotion={settings.reducedMotion} />
      </div>
      <div className="persona-artifact-copy">
        <span className="persona-artifact-type">
          {p.mode === 'work' ? '工作搭档' : '陪伴人偶'}
          {shape ? ' · ' + shape.name : ''}
        </span>
        <h2>{p.name}</h2>
        <p>{p.description}</p>
        {shape?.license && (
          <p className="muted">
            <a href={shape.licenseUrl || shape.sourceUrl} target="_blank" rel="noreferrer">
              {shape.sourceName} · {shape.license}
            </a>
          </p>
        )}
        <Button
          variant="primary"
          busy={saving}
          disabled={added}
          onClick={async () => {
            setSaving(true);
            try {
              await saveSettings({
                ...settings,
                personas: [...settings.personas, { ...p, id: crypto.randomUUID() }],
                liveModels:
                  shape?.sourceId &&
                  !settings.liveModels.some(
                    (m) => m.id === shape.id || m.live.modelUrl === shape.live.modelUrl,
                  )
                    ? [...settings.liveModels, shape]
                    : settings.liveModels,
              });
              setAdded(true);
              notify('人偶已添加');
            } catch (e) {
              notify((e as Error).message, 'error');
            } finally {
              setSaving(false);
            }
          }}
        >
          {added ? <Check size={16} /> : <Plus size={16} />}
          {added ? '已添加到人偶' : '添加人偶'}
        </Button>
      </div>
    </div>
  );
}

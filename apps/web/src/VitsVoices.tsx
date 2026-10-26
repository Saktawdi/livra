import { useCallback, useEffect, useState } from 'react';
import type { Settings, VitsCatalog } from '@livra/shared';
import { api } from './api';
import { Field, Select } from './ui';

export function VitsVoices({
  model,
  value,
  onChange,
}: {
  model: Settings['speechVitsModel'];
  value: string;
  onChange: (value: string) => void;
}) {
  const [catalog, setCatalog] = useState<VitsCatalog | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<VitsCatalog>('/speech/voices' + (revision ? '?refresh=true' : ''), {
      signal: controller.signal,
    })
      .then((data) => {
        setCatalog(data);
        setError(data.error || '');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  const item = catalog?.models.find((m) => m.id === model);
  return (
    <Field
      label="VITS 音色"
      hint={
        item ? `${item.voices.length} 个远端音色 · 留空跟随默认` : '从公共 Space 加载可用角色音色'
      }
    >
      <Select
        aria-label="VITS 音色"
        searchable
        value={value}
        onChange={onChange}
        loading={loading}
        error={error}
        onRetry={refresh}
        options={[
          { value: '', label: '使用默认音色', description: item?.defaultVoice },
          ...(value && !item?.voices.includes(value)
            ? [{ value, label: value, description: '已保存 · 待远端确认' }]
            : []),
          ...(item?.voices || []).map((voice) => ({ value: voice, label: voice })),
        ]}
      />
      <button className="text-link" onClick={refresh} disabled={loading}>
        刷新音色库
      </button>
    </Field>
  );
}

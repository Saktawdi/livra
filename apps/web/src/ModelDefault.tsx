import type { Provider, Settings } from '@livra/shared';
import { Field, Select } from './ui';
import { useSaktaModels } from './useSaktaModels';
export function ModelDefault({
  label,
  kind,
  draft,
  providerId,
  model,
  onChange,
}: {
  label: string;
  kind: Provider['kind'];
  draft: Settings;
  providerId: string;
  model: string;
  onChange: (id: string, m: string) => void;
}) {
  const remote = useSaktaModels(kind === 'chat' ? draft.sakta : undefined);
  const remoteModels = [
    ...new Set([...(providerId === 'sakta' && model ? [model] : []), ...remote.models]),
  ];
  return (
    <Field label={label}>
      <Select
        value={providerId ? providerId + '|' + model : '|'}
        onChange={(value) => {
          const [id, ...m] = value.split('|');
          onChange(id, m.join('|'));
        }}
        searchable
        loading={remote.loading}
        error={remote.error}
        onRetry={remote.connected ? remote.refresh : undefined}
        options={[
          { value: '|', label: '暂未选择' },
          ...remoteModels.map((m) => ({ value: 'sakta|' + m, label: m, group: 'Sakta' })),
          ...draft.providers
            .filter((p) => p.kind === kind)
            .flatMap((p) =>
              p.models.map((m) => ({ value: p.id + '|' + m, label: m, group: p.name })),
            ),
        ]}
      />
    </Field>
  );
}

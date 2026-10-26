import { flattenCatalog } from '@livra/shared';
import type { RuntimeStore } from './store.ts';
import { network, readJson } from './network.ts';

type Snapshot = { id: string; at: number; entries: Record<string, unknown> };
// Same hourly cache and stale fallback as Lumen, persisted in the current workspace.
export class ModelCatalogService {
  private pending = new Map<string, Promise<Record<string, unknown>>>();
  constructor(private store: RuntimeStore) {}
  async load(workspace: string, force = false): Promise<Record<string, unknown>> {
    const saved = this.store.get<Snapshot>(workspace, 'model-catalog', 'models.dev');
    if (!force && saved && Date.now() - saved.at < 3600000) return saved.entries;
    const pending = this.pending.get(workspace);
    if (pending) return pending;
    const request = (async () => {
      try {
        const data = await readJson(
          await network('https://models.dev/api.json', {
            signal: AbortSignal.timeout(30000),
          }),
          32000000,
        );
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw Error('模型能力目录格式无效');
        const entries = flattenCatalog(data);
        if (!Object.keys(entries).length) throw Error('模型能力目录为空');
        this.store.put(workspace, 'model-catalog', { id: 'models.dev', at: Date.now(), entries });
        return entries;
      } catch (error) {
        if (saved) return saved.entries;
        throw error;
      } finally {
        this.pending.delete(workspace);
      }
    })();
    this.pending.set(workspace, request);
    return request;
  }
}

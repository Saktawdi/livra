import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  builtInLiveModels,
  liveModelCatalog,
  liveModelSchema,
  type LiveModel,
  type LiveModelSource,
  type LiveModelSourceResult,
  type Settings,
} from '@livra/shared';
import { network, readJson, safeError, validateUrl } from './network.ts';
import type { RuntimeStore as Store } from './store.ts';

type Request = typeof network;
type Cached = {
  id: string;
  key: string;
  models: LiveModel[];
  updatedAt: number;
  truncated: boolean;
};
const trustedHosts = new Set([
  'api.github.com',
  'raw.githubusercontent.com',
  'fastly.jsdelivr.net',
  'model.hacxy.cn',
]);
const emptyExpressions = {
  neutral: '',
  happy: '',
  thinking: '',
  concerned: '',
  excited: '',
  calm: '',
};
const digest = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value))).slice(0, 20);
const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');
const parentPath = (value: string) =>
  value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';
function validPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length < 1000 &&
    !/[\\?#\u0000-\u001f]/.test(path) &&
    !path.startsWith('/') &&
    !path.split('/').some((p) => p === '.' || p === '..' || !p)
  );
}

export class LiveModelService {
  private pending = new Map<string, Promise<LiveModelSourceResult>>();
  private recent = new Map<string, { at: number; result: LiveModelSourceResult }>();
  constructor(
    private store: Store,
    private request: Request = network,
  ) {}

  private fetch(url: string, init: RequestInit = {}) {
    const parsed = validateUrl(url);
    return this.request(
      url,
      {
        ...init,
        headers: { 'User-Agent': 'Livra-Live2D-Catalog', ...init.headers },
        signal: AbortSignal.any([
          AbortSignal.timeout(12000),
          ...(init.signal ? [init.signal] : []),
        ]),
      },
      undefined,
      parsed.protocol === 'https:' && trustedHosts.has(parsed.hostname),
    );
  }
  private async json(url: string, limit = 6_000_000, signal?: AbortSignal) {
    return readJson(await this.fetch(url, { signal }), limit);
  }

  private entry(
    source: LiveModelSource,
    name: string,
    modelUrl: string,
    sourceUrl: string,
    description: string,
  ): LiveModel {
    return liveModelSchema.parse({
      id: `remote:${source.id}:${digest(modelUrl)}`,
      name: name.slice(0, 80),
      description: description.slice(0, 500),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl,
      license: source.license,
      ...(source.licenseUrl ? { licenseUrl: source.licenseUrl } : {}),
      live: { modelUrl, expressions: emptyExpressions },
    });
  }

  private async discover(source: LiveModelSource) {
    const models: LiveModel[] = [];
    let truncated = false;
    if (source.kind === 'static') {
      const url = new URL(source.url);
      if (!url.pathname.endsWith('.json'))
        url.pathname = url.pathname.replace(/\/?$/, '/') + 'model_list.json';
      const data = await this.json(url.href);
      if (!Array.isArray(data.models)) throw Error('来源缺少 models 目录');
      const paths = data.models.flatMap((group: unknown) =>
        Array.isArray(group) ? group : [group],
      );
      for (const path of [...new Set(paths)]) {
        if (!validPath(path)) continue;
        if (models.length >= 500) {
          truncated = true;
          break;
        }
        const modelUrl = new URL(
          `model/${encodePath(path)}/index.json`,
          source.assetBaseUrl || url.href,
        ).href;
        models.push(
          this.entry(
            source,
            path.split('/').at(-1)!,
            modelUrl,
            source.licenseUrl || source.url,
            path.replaceAll('/', ' · '),
          ),
        );
      }
    } else {
      const url = new URL(source.url);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (url.hostname !== 'github.com' || parts.length < 2 || (parts[2] && parts[2] !== 'tree'))
        throw Error('填写 GitHub 仓库或 tree/版本/目录 地址');
      const [owner, repository] = parts;
      if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repository))
        throw Error('GitHub 仓库地址无效');
      const ref =
        parts[3] ||
        (await this.json(`https://api.github.com/repos/${owner}/${repository}`, 200000))
          .default_branch;
      const prefix = parts.slice(4).join('/');
      const treeRef = prefix ? `${ref}:${prefix}` : ref;
      const data = await this.json(
        `https://api.github.com/repos/${owner}/${repository}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
      );
      if (!Array.isArray(data.tree)) throw Error('GitHub 未返回资源目录');
      truncated = !!data.truncated;
      const blobs = new Set<string>(
        data.tree
          .filter((item: any) => item.type === 'blob' && validPath(item.path))
          .map((item: any) => (prefix ? `${prefix}/${item.path}` : item.path)),
      );
      const mocFolders = new Set([...blobs].filter((path) => /\.moc$/.test(path)).map(parentPath));
      for (const path of [...blobs].sort()) {
        if (!validPath(path) || (prefix && !path.startsWith(prefix + '/'))) continue;
        if (
          !/\.model3?\.json$/i.test(path) &&
          !(/(^|\/)index\.json$/i.test(path) && mocFolders.has(parentPath(path)))
        )
          continue;
        const name = parentPath(path).split('/').at(-1) || repository;
        // The five installed samples remain available without a remote download.
        if (
          owner === 'Live2D' &&
          repository === 'CubismWebSamples' &&
          builtInLiveModels.some((m) => m.name === name)
        )
          continue;
        if (models.length >= 500) {
          truncated = true;
          break;
        }
        const assetPath = prefix ? path.slice(prefix.length + 1) : path;
        const modelUrl = source.assetBaseUrl
          ? new URL(encodePath(assetPath), source.assetBaseUrl.replace(/\/?$/, '/')).href
          : `https://raw.githubusercontent.com/${owner}/${repository}/${encodeURIComponent(ref)}/${encodePath(path)}`;
        const sourceUrl = `https://github.com/${owner}/${repository}/tree/${encodeURIComponent(ref)}/${encodePath(parentPath(path))}`;
        models.push(
          this.entry(
            source,
            name,
            modelUrl,
            sourceUrl,
            assetPath.split('/').slice(0, -1).join(' · '),
          ),
        );
      }
    }
    if (!models.length) throw Error('此来源中没有找到可识别的 Live2D 模型');
    return { models, truncated };
  }

  async source(
    settings: Settings,
    workspace: string,
    id: string,
    refresh = false,
  ): Promise<LiveModelSourceResult> {
    const source = settings.liveModelSources.find((s) => s.id === id);
    if (!source) throw Object.assign(Error('形象来源不存在'), { statusCode: 404 });
    if (!source.enabled) return { id, status: 'disabled', models: [] };
    const key = digest(JSON.stringify(source));
    const cache = this.store.get<Cached>(workspace, 'live-model-cache', id);
    const cached = cache?.key === key ? cache : undefined;
    const cacheResult = (status: 'ready' | 'stale'): LiveModelSourceResult => ({
      id,
      status,
      models: cached!.models,
      updatedAt: cached!.updatedAt,
      truncated: cached!.truncated,
    });
    if (!refresh && cached && Date.now() - cached.updatedAt < 6 * 60 * 60 * 1000)
      return cacheResult('ready');
    const taskKey = `${workspace}:${id}:${key}`;
    const recent = this.recent.get(taskKey);
    if (recent && Date.now() - recent.at < (refresh ? 1500 : 30000)) return recent.result;
    if (this.pending.has(taskKey)) return this.pending.get(taskKey)!;
    const task = (async (): Promise<LiveModelSourceResult> => {
      try {
        const result = await this.discover(source);
        const updatedAt = Date.now();
        this.store.put(workspace, 'live-model-cache', { id, key, ...result, updatedAt });
        return { id, status: 'ready', ...result, updatedAt };
      } catch (error) {
        return {
          ...(cached ? cacheResult('stale') : { id, models: [] }),
          status: cached ? 'stale' : 'error',
          error: safeError(error),
        };
      }
    })();
    this.pending.set(taskKey, task);
    try {
      const result = await task;
      this.recent.set(taskKey, { at: Date.now(), result });
      if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value!);
      return result;
    } finally {
      this.pending.delete(taskKey);
    }
  }

  async catalog(settings: Settings, workspace: string) {
    const sources = await Promise.all(
      settings.liveModelSources
        .filter((s) => s.enabled)
        .map((s) => this.source(settings, workspace, s.id)),
    );
    const models = liveModelCatalog(settings);
    const urls = new Set(models.map((m) => m.live.modelUrl));
    for (const source of sources)
      for (const model of source.models) {
        if (!urls.has(model.live.modelUrl) && !models.some((m) => m.id === model.id)) {
          models.push(model);
          urls.add(model.live.modelUrl);
        }
      }
    return { models, sources };
  }

  async resolve(settings: Settings, workspace: string, id: string, signal?: AbortSignal) {
    const local = liveModelCatalog(settings).find((m) => m.id === id);
    if (local) return local;
    const sourceId = /^remote:([\w-]+):[\da-f]{20}$/.exec(id)?.[1];
    if (!sourceId) throw Error('形象不存在，请调用 list_live2d_models 重新选择');
    const source = await this.source(settings, workspace, sourceId);
    const model = source.models.find((m) => m.id === id);
    if (!model) throw Error('形象不存在或来源已关闭，请重新选择');
    const data = await this.json(model.live.modelUrl, 500000, signal);
    const cubism4 = !!data.FileReferences;
    const refs = cubism4 ? data.FileReferences : data;
    const mocPath = cubism4 ? refs.Moc : refs.model;
    const textures = cubism4 ? refs.Textures : refs.textures;
    if (
      typeof mocPath !== 'string' ||
      !Array.isArray(textures) ||
      !textures.length ||
      textures.some((t: unknown) => typeof t !== 'string')
    )
      throw Error('模型配置缺少模型文件或纹理');
    const response = await this.fetch(new URL(mocPath, model.live.modelUrl).href, {
      headers: { Range: 'bytes=0-7' },
      signal,
    });
    if (!response.ok) throw Error(`模型文件无法读取（HTTP ${response.status}）`);
    const reader = response.body?.getReader();
    if (!reader) throw Error('模型文件为空');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < 8) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    if (
      cubism4
        ? bytes.subarray(0, 4).toString() !== 'MOC3'
        : bytes.subarray(0, 3).toString() !== 'moc'
    )
      throw Error('模型文件格式与配置不一致');
    if (cubism4 && bytes[4] > 4) throw Error('此形象需要 Cubism 5，当前支持 Cubism 2 / 3 / 4');
    const motions = cubism4 ? refs.Motions : refs.motions;
    const groups = Object.keys(motions && typeof motions === 'object' ? motions : {});
    const idleMotion = groups.find((s) => /^idle$/i.test(s)) || groups[0] || '';
    const tapMotion =
      groups.find((s) => /^(tap_?body|tap|wave|flick_head)$/i.test(s)) || idleMotion;
    return liveModelSchema.parse({
      ...model,
      live: { ...model.live, idleMotion, tapMotion, expressions: emptyExpressions },
    });
  }
}

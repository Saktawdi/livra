// Ported from lumen-utools/src/model-catalog.ts.
import type { ModelConfig } from './index';

type Entry = {
  id: string;
  providerId: string;
  modelId?: string;
  name?: string;
  alias?: string;
  aliases?: string[];
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  reasoning_options?: { type: string; values?: string[] }[];
};
type Row = {
  model: Entry;
  publisher: string;
  identity: string;
  signature?: string;
};
type Index = {
  full: Map<string, Row[]>;
  ids: Map<string, Row[]>;
  aliases: Map<string, Row[]>;
  variants: Map<string, Row[]>;
  results: Map<string, Entry | null>;
};

const text = (value: unknown) => (typeof value === 'string' ? value.normalize('NFKC').trim() : '');
const tokens = (id: string) =>
  text(id)
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1-$2')
    .match(/[\p{L}\p{N}]+/gu) || [];
// Keep numeric boundaries: 4.1 and 4-1 agree, while 4 and 4.1 stay distinct.
export const normalize = (id: string) => tokens(id).join('-');
const providerKey = (id: string) => normalize(id).replace(/-/g, '');
const bare = (id: string) => id.slice(id.lastIndexOf('/') + 1);
const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const publishers = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'alibaba',
  'moonshotai',
  'xai',
  'mistral',
  'cohere',
  'zai',
  'minimax',
]);
const publisherAliases: Record<string, string> = {
  deepseekai: 'deepseek',
  mistralai: 'mistral',
  qwen: 'alibaba',
  moonshot: 'moonshotai',
  zhipu: 'zai',
  zhipuai: 'zai',
};
const publisher = (id: string) => publisherAliases[providerKey(id)] || providerKey(id);
const referenceKey = (id: string) => {
  const parts = id.split('/');
  return [...parts.slice(0, -1).map(publisher), normalize(parts.at(-1)!)].join('/');
};

// Deployment labels can decorate a model, but size, architecture and modality
// tokens (mini/pro/lite/flash/codex/vision/etc.) are never discarded.
const modifiers = new Set([
  'latest',
  'preview',
  'stable',
  'nightly',
  'beta',
  'alpha',
  'experimental',
  'exp',
  'free',
  'online',
  'chat',
  'instruct',
  'instruction',
  'thinking',
  'nonthinking',
  'nothinking',
  'reasoning',
  'high',
  'low',
  'medium',
  'minimal',
  'xhigh',
  'none',
  'disabled',
  'tiered',
  'agent',
  'antigravity',
  'cc',
  'format',
  'custom',
  'proxy',
  'api',
  'official',
  '免费',
  '官方',
  '直连',
  '逆向',
]);
const validMonthDay = (month: string, day: string) =>
  Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31;
const dateLength = (parts: string[]) => {
  const last = parts.at(-1) || '';
  if (/^20\d{6}$/.test(last) && validMonthDay(last.slice(4, 6), last.slice(6, 8))) return 1;
  if (/^\d{4}$/.test(last) && validMonthDay(last.slice(0, 2), last.slice(2, 4))) return 1;
  const end = parts.slice(-3);
  if (
    /^20\d{2}$/.test(end[0] || '') &&
    /^\d{2}$/.test(end[1] || '') &&
    /^\d{2}$/.test(end[2] || '') &&
    validMonthDay(end[1], end[2])
  )
    return 3;
  return 0;
};
const variants = (id: string) => {
  const parts = tokens(id);
  const result = [parts.join('-')];
  while (parts.length > 1) {
    const effort = parts.at(-2) === 'extra' && /^(?:low|high)$/.test(parts.at(-1)!) ? 2 : 0;
    const count = dateLength(parts) || effort || (modifiers.has(parts.at(-1)!) ? 1 : 0);
    if (!count || parts.length <= count) break;
    parts.splice(-count);
    result.push(parts.join('-'));
  }
  return result;
};

export function flattenCatalog(raw: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [pid, provider] of Object.entries(raw || {})) {
    if (!provider || typeof provider !== 'object') continue;
    const models = (provider as { models?: unknown }).models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
    for (const [key, value] of Object.entries(models)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const model = value as Record<string, unknown>;
      result[pid + '/' + key] = {
        ...model,
        id: text(model.id) || text(model.modelId) || key,
        providerId: text(model.providerId) || pid,
      };
    }
  }
  return result;
}

const toConfig = (model: Entry): ModelConfig => {
  const levels = new Set<string>();
  let reasoningMode: ModelConfig['reasoningMode'] = 'effort';
  for (const option of model.reasoning_options || []) {
    if (option.type === 'effort') for (const level of option.values || []) levels.add(level);
    if (option.type === 'toggle') {
      levels.add('none');
      reasoningMode = 'toggle';
    }
    if (option.type === 'budget') reasoningMode = 'budget';
  }
  return {
    vision: (model.modalities?.input || []).includes('image'),
    reasoning: model.reasoning === true,
    tools: model.tool_call !== false,
    context: model.limit?.context,
    output: model.limit?.output,
    levels: [...levels],
    reasoningMode,
    matchedId: model.id,
    source: 'models.dev',
  };
};
const signature = (model: Entry) => {
  const { matchedId: _id, source: _source, ...config } = toConfig(model);
  return JSON.stringify({
    ...config,
    levels: [...(config.levels || [])].sort(),
  });
};
const add = (map: Map<string, Row[]>, key: string, row: Row) => {
  if (!key) return;
  const rows = map.get(key) || [];
  if (!rows.includes(row)) rows.push(row);
  map.set(key, rows);
};
const buildIndex = (raw: Record<string, unknown>): Index => {
  const index: Index = {
    full: new Map(),
    ids: new Map(),
    aliases: new Map(),
    variants: new Map(),
    results: new Map(),
  };
  const entries = Object.entries(raw).flatMap<[string, unknown]>(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    if ('models' in value) return Object.entries(flattenCatalog({ [key]: value }));
    return [[key, value]];
  });
  for (const [key, value] of entries) {
    const record = value as Record<string, unknown>;
    const id = text(record.id) || text(record.modelId) || key;
    const providerId =
      text(record.providerId) || (key.includes('/') ? key.slice(0, key.indexOf('/')) : '');
    const model = { ...record, id, providerId } as Entry;
    const variantKeys = variants(bare(id));
    const row: Row = {
      model,
      publisher: publisher(providerId),
      identity: variantKeys.at(-1)!,
    };
    // Model ids are authoritative; display names and declared aliases have
    // their own lower-priority index so they cannot mask an actual model id.
    const ids = [...new Set([id, text(record.modelId)].filter(Boolean))];
    for (const value of ids) {
      add(index.full, referenceKey(value), row);
      add(index.ids, normalize(bare(value)), row);
      if (providerId) add(index.full, referenceKey(providerId + '/' + value), row);
      for (const variant of (value === id ? variantKeys : variants(bare(value))).slice(1))
        add(index.variants, variant, row);
    }
    const labels = [text(record.name), text(record.displayName)].filter(
      (label) =>
        /\d/.test(label) || ids.some((value) => normalize(bare(value)) === normalize(label)),
    );
    for (const alias of [text(record.alias), ...strings(record.aliases), ...labels]) {
      add(index.aliases, normalize(alias), row);
      add(index.aliases, normalize(bare(alias)), row);
    }
  }
  return index;
};

const select = (matches: Row[], scopes: string[]): Entry | null | undefined => {
  let rows = [...new Set(matches)];
  for (const scope of scopes) {
    const own = rows.filter((row) => row.publisher === scope);
    if (own.length) {
      rows = own;
      break;
    }
    // A named original publisher must not resolve to a different publisher.
    // Unknown gateway namespaces may still borrow original model metadata.
    if (publishers.has(scope)) {
      const namespaced = rows.filter((row) =>
        row.model.id
          .split('/')
          .slice(0, -1)
          .some((part) => publisher(part) === scope),
      );
      if (!namespaced.length) return undefined;
      rows = namespaced;
      break;
    }
  }
  // Aliases shared by different models remain ambiguous even if capabilities
  // happen to agree. Duplicate gateway entries of the same model are allowed.
  if (new Set(rows.map((row) => row.identity)).size > 1) return null;
  const originals = rows.filter((row) => publishers.has(row.publisher));
  if (originals.length) rows = originals;
  if (
    rows.length > 1 &&
    new Set(rows.map((row) => (row.signature ??= signature(row.model)))).size > 1
  )
    return null;
  return rows[0]?.model || null;
};

const cache = new WeakMap<object, Index>();
export function matchModel(id: string, raw: Record<string, unknown>): ModelConfig | null {
  const query = text(id);
  if (!query || !raw || typeof raw !== 'object') return null;
  let index = cache.get(raw);
  if (!index) {
    index = buildIndex(raw);
    cache.set(raw, index);
  }
  if (index.results.has(query)) {
    const cached = index.results.get(query);
    return cached ? toConfig(cached) : null;
  }
  const scopes = query
    .split('/')
    .slice(0, -1)
    .reverse()
    .filter((part) => !/^models?$/i.test(part))
    .map(publisher);
  const keys = [...new Set([normalize(query), normalize(bare(query))])];
  const lookup = (map: Map<string, Row[]>, key: string) => {
    let rows = map.get(key);
    if (
      rows?.length &&
      (map === index.full || map === index.ids) &&
      !rows.some((row) => publishers.has(row.publisher))
    ) {
      // e.g. gateway "gemini-3-flash" vs original "gemini-3-flash-preview".
      // An original release alias can resolve conflicting gateway metadata;
      // an exact original id or an explicitly named gateway still takes priority.
      const originals = (index.variants.get(key.split('/').at(-1)!) || []).filter((row) =>
        publishers.has(row.publisher),
      );
      if (originals.length) rows = [...rows, ...originals];
    }
    return rows?.length ? select(rows, scopes) : undefined;
  };
  const finish = (model: Entry | null) => {
    if (index.results.size >= 4096) index.results.clear();
    index.results.set(query, model);
    return model ? toConfig(model) : null;
  };

  const complete = lookup(index.full, referenceKey(query));
  if (complete !== undefined) return finish(complete);

  for (const map of [index.ids, index.aliases]) {
    for (const key of keys) {
      const found = lookup(map, key);
      if (found !== undefined) return finish(found);
    }
  }
  const simplified = variants(bare(query));
  // Prefer a real id at every level before considering a release alias.
  for (const key of simplified) {
    for (const map of [index.full, index.ids, index.variants, index.aliases]) {
      const found = lookup(map, key);
      if (found !== undefined) return finish(found);
    }
  }
  // Remove routing prefixes only at whole token boundaries. The suffix rules
  // above preserve versions and model variants, avoiding arbitrary includes().
  for (const key of simplified) {
    const parts = key.split('-');
    for (let start = 1; start < parts.length - 1; start++) {
      const tail = parts.slice(start);
      const compact = tail.join('');
      if (!/^[a-z]/.test(tail[0]) || (compact.length < 4 && !/^o\d+$/.test(compact))) continue;
      for (const map of [index.full, index.ids, index.variants, index.aliases]) {
        const found = lookup(map, tail.join('-'));
        if (found !== undefined) return finish(found);
      }
    }
  }
  return finish(null);
}

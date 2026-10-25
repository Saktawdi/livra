import { environment } from './environment.ts';
import type { Settings } from '@livra/shared';
import { endpoint, network, readJson, safeError } from './network.ts';

// Ported from lumen-utools/runtime/search.cjs: rotate the starting key for
// each search, then try the remaining keys once on recoverable failures.
const cursors = new Map<string, number>();
async function withKeys<T>(
  id: string,
  keys: string[],
  signal: AbortSignal,
  operation: (key: string) => Promise<T>,
): Promise<T> {
  const pool = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (!pool.length) pool.push('');
  const start = (cursors.get(id) || 0) % pool.length;
  cursors.set(id, (start + 1) % pool.length);
  let last: unknown;
  for (let offset = 0; offset < pool.length; offset++) {
    signal.throwIfAborted();
    try {
      return await operation(pool[(start + offset) % pool.length]);
    } catch (error) {
      signal.throwIfAborted();
      last = error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      const status = (error as { status?: number })?.status;
      // AnySearch REST reports quota exhaustion as 402 (MCP uses 429).
      if (![401, 402, 403, 408, 429, 500, 502, 503, 504].includes(status || 0)) throw error;
    }
  }
  throw last;
}

export const anySearchEndpoint = 'https://api.anysearch.com/v1/search';
export async function searchWeb(settings: Settings, query: string, signal: AbortSignal) {
  const keys = settings.searchKeys ?? (settings.searchKey ? [settings.searchKey] : []);
  try {
    return await withKeys(
      'search:' + settings.searchEngine + ':' + (settings.searchUrl || anySearchEndpoint),
      keys,
      signal,
      (key) => searchWithKey(settings, query, key, signal),
    );
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw Object.assign(
      Error(safeError(error, [...keys.map((key) => key.trim()), settings.searchKey?.trim()])),
      {
        status: (error as { status?: number })?.status,
      },
    );
  }
}
async function searchWithKey(settings: Settings, query: string, key: string, signal: AbortSignal) {
  if (!query.trim()) throw Error('请输入搜索内容');
  const base =
    settings.searchUrl ||
    (settings.searchEngine === 'anysearch' ? anySearchEndpoint : environment.SEARXNG_URL);
  if (!base) throw Error('请先配置搜索服务');
  let data: any;
  if (settings.searchEngine === 'anysearch') {
    const response = await network(
      base,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ query, max_results: 6, language: settings.locale, format: 'json' }),
      },
      undefined,
      new URL(base).origin === 'https://api.anysearch.com',
    );
    // Anonymous quota responses may contain generated credentials. Never expose that body.
    if (!response.ok) {
      await response.body?.cancel();
      const hints: Record<number, string> = {
        401: '密钥无效',
        402: '搜索额度已用尽，请在设置中配置密钥',
        403: '账号或密钥不可用',
        429: '请求过于频繁，请稍后再试',
      };
      throw Object.assign(
        Error(
          `AnySearch HTTP ${response.status}：${hints[response.status] || '搜索服务暂时不可用'}`,
        ),
        { status: response.status },
      );
    }
    data = await readJson(response);
    if (data.code !== 0 || !Array.isArray(data.data?.results))
      throw Object.assign(Error('AnySearch 返回无效结果'), {
        status: data.code === 42901 ? 429 : data.code,
      });
    data = data.data;
  } else if (settings.searchEngine === 'tavily') {
    data = await readJson(
      await network(base, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(key ? { api_key: key } : {}), query, max_results: 6 }),
      }),
    );
    if (typeof data.code === 'number' && data.code !== 0)
      throw Object.assign(Error('搜索接口返回错误'), {
        status: data.code === 42901 ? 429 : data.code,
      });
  } else {
    const url = new URL(endpoint(base, 'search'));
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    data = await readJson(
      await network(url.href, {
        signal,
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      }),
    );
  }
  return (Array.isArray(data.results) ? data.results : [])
    .filter((r: any) => typeof r.url === 'string' && /^https?:\/\//.test(r.url))
    .slice(0, 6)
    .map((r: any) => ({
      title: String(r.title || r.url).slice(0, 500),
      url: r.url,
      content: String(r.content || r.snippet || '').slice(0, 3000),
    }));
}

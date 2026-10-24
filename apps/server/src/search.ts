import type { Settings } from '@livra/shared';
import { endpoint, network, readJson } from './network.ts';

export const anySearchEndpoint = 'https://api.anysearch.com/v1/search';
export async function searchWeb(settings: Settings, query: string, signal: AbortSignal) {
  const base =
    settings.searchUrl ||
    (settings.searchEngine === 'anysearch' ? anySearchEndpoint : process.env.SEARXNG_URL);
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
          ...(settings.searchKey ? { Authorization: `Bearer ${settings.searchKey}` } : {}),
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
      throw Error(
        `AnySearch HTTP ${response.status}：${hints[response.status] || '搜索服务暂时不可用'}`,
      );
    }
    data = await readJson(response);
    if (data.code !== 0 || !Array.isArray(data.data?.results))
      throw Error('AnySearch 返回无效结果');
    data = data.data;
  } else if (settings.searchEngine === 'tavily') {
    data = await readJson(
      await network(base, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: settings.searchKey, query, max_results: 6 }),
      }),
    );
  } else {
    const url = new URL(endpoint(base, 'search'));
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    data = await readJson(await network(url.href, { signal }));
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

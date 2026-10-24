import { environment } from './environment.ts';
import { z } from 'zod';
import { endpoint, network, readJson, safeError, UpstreamResponseError } from './network.ts';

export function saktaApiBaseUrl() {
  const base = (environment.SAKTA_BASE_URL ?? 'https://api.sakta.top').trim().replace(/\/+$/, '');
  if (!base) throw Object.assign(Error('管理员已关闭 Sakta 接入'), { statusCode: 404 });
  return base.endsWith('/v1') ? base : base + '/v1';
}

const modelList = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

export function saktaRequest(path: string, init: RequestInit = {}) {
  const url = endpoint(saktaApiBaseUrl(), path);
  // TUN proxies can resolve this fixed HTTPS service into the 198.18.0.0/15
  // benchmark range. This exception does not permit loopback or LAN addresses.
  const allowProxyDns = new URL(url).origin === 'https://api.sakta.top';
  return network(url, init, environment.ALLOW_PRIVATE_ENDPOINTS === 'true', allowProxyDns);
}

export async function listSaktaModels(token: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const data = await readJson(
      await saktaRequest('models', {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      }),
    );
    const parsed = modelList.safeParse(data);
    if (!parsed.success) throw Error('Sakta 模型接口未返回有效的 data 模型数组');
    // Model IDs are opaque: preserve namespace prefixes when sending them back.
    return [...new Set(parsed.data.data.map((model) => model.id))].sort();
  } catch (error) {
    const status =
      error instanceof UpstreamResponseError && error.status >= 400
        ? error.status
        : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
          ? 504
          : 502;
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? `（${safeError(error.cause, [token])}）`
        : '';
    const detail = safeError(error, [token]) + cause;
    const message =
      status === 401
        ? 'Sakta 登录已失效，请重新登录'
        : status === 403
          ? 'Sakta 拒绝访问，请检查账号状态和模型权限'
          : `Sakta 模型列表加载失败：${detail}`;
    throw Object.assign(Error(message), { statusCode: status });
  }
}

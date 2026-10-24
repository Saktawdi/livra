import { Buffer } from 'buffer';

export function validateUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw Error('仅支持不含用户凭据的 HTTP(S) 地址');
  return url;
}
export type Transport = (
  url: string,
  init?: RequestInit,
  allowPrivate?: boolean,
  allowProxyDns?: boolean,
) => Promise<Response>;
export const usesNetworkRelay = () =>
  typeof document !== 'undefined' && !!document.querySelector('meta[name="livra-network-relay"]');
export const assetRequestUrl = (url: string) =>
  usesNetworkRelay()
    ? '/__livra_transport?asset=1&url=' + encodeURIComponent(validateUrl(url).href)
    : url;
export const browserNetwork: Transport = async (url, init = {}) => {
  const parsed = validateUrl(url);
  const signal = AbortSignal.any([
    AbortSignal.timeout(900_000),
    ...(init.signal ? [init.signal] : []),
  ]);
  const headers = new Headers(init.headers);
  headers.delete('User-Agent');
  try {
    const relay = usesNetworkRelay();
    if (relay) headers.set('X-Livra-Transport', 'web');
    const response = await fetch(
      relay ? '/__livra_transport?url=' + encodeURIComponent(parsed.href) : parsed,
      { ...init, headers, credentials: 'omit', redirect: 'error', signal },
    );
    if (relay && response.headers.get('X-Livra-Relay-Error') === '1') {
      const data = await response
        .clone()
        .json()
        .catch(() => null);
      if (data?.error) throw Error(data.error);
    }
    return response;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof Error && error.message.startsWith('无法连接上游服务：')) throw error;
    throw new Error('无法连接 ' + parsed.origin + '，请检查服务地址及网络连接。', { cause: error });
  }
};
let transport: Transport = browserNetwork;
export function configureTransport(value: Transport) {
  transport = value;
}
export const network: Transport = (...args) => transport(...args);

export class UpstreamResponseError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function readJson(response: Response, limit = 4_000_000): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('服务返回空响应');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw Error('服务响应超过大小限制');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UpstreamResponseError(`服务未返回 JSON（HTTP ${response.status}）`, response.status);
  }
  if (!response.ok)
    throw new UpstreamResponseError(
      `HTTP ${response.status}: ${String(data.error?.message || data.msg || data.message || response.statusText).slice(0, 400)}`,
      response.status,
    );
  return data;
}
export const endpoint = (base: string, path: string) =>
  base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
export function safeError(error: unknown, secrets: (string | undefined)[] = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter((x): x is string => !!x))
    message = message.split(secret).join('[redacted]');
  return message.slice(0, 800);
}

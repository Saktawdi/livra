import { Buffer } from 'buffer';

export function validateUrl(value: string) {
 const url = new URL(value);
 if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('仅支持不含用户凭据的 HTTP(S) 地址');
 return url;
}
export type Transport = (url: string, init?: RequestInit, allowPrivate?: boolean, allowProxyDns?: boolean) => Promise<Response>;
let transport: Transport = async (url, init = {}) => {
 const parsed = validateUrl(url);
 const signal = AbortSignal.any([AbortSignal.timeout(180_000), ...(init.signal ? [init.signal] : [])]);
 const headers = new Headers(init.headers);
 headers.delete('User-Agent');
 try {
  return await fetch(parsed, { ...init, headers, credentials: 'omit', redirect: 'error', signal });
 } catch (error) {
  if (signal.aborted) throw signal.reason;
  throw new Error('无法直连 ' + parsed.origin + '：请检查网络、服务地址及该服务的跨域许可（CORS）。', { cause: error });
 }
};
export function configureTransport(value: Transport) { transport = value; }
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

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as transport } from 'undici';

export function privateAddress(ip: string): boolean {
  let value = ip.toLowerCase();
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (mapped) {
    const high = parseInt(mapped[1], 16),
      low = parseInt(mapped[2], 16);
    value = [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  value = value.replace(/^::ffff:/, '');
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    value === '::' || value === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value) || !isIP(value)
  );
}
export function validateUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw Error('仅支持不含用户凭据的 HTTP(S) 地址');
  return url;
}
const agents = new Map<boolean, Agent>();
function agent(allowPrivate: boolean) {
  if (!agents.has(allowPrivate))
    agents.set(
      allowPrivate,
      new Agent({
        connect: {
          lookup: ((hostname: string, options: any, callback: any) => {
            lookup(hostname, { all: true })
              .then((addresses) => {
                if (!allowPrivate && addresses.some((a) => privateAddress(a.address)))
                  throw Error('目标是内网地址。自部署管理员可设置 ALLOW_PRIVATE_ENDPOINTS=true');
                if (!addresses.length) throw Error('无法解析服务地址');
                if (options?.all) callback(null, addresses);
                else callback(null, addresses[0].address, addresses[0].family);
              })
              .catch((error) => callback(error));
          }) as any,
        },
      }),
    );
  return agents.get(allowPrivate)!;
}
export async function network(
  url: string,
  init: RequestInit = {},
  allowPrivate = process.env.ALLOW_PRIVATE_ENDPOINTS === 'true',
) {
  const parsed = validateUrl(url);
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(literal) && privateAddress(literal)) throw Error('禁止请求内网地址');
  const result = await transport(parsed, {
    ...(init as any),
    dispatcher: agent(allowPrivate),
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(init.signal ? [init.signal] : [])]),
  });
  return result as unknown as Response;
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
    throw Error(`服务未返回 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok)
    throw Error(
      `HTTP ${response.status}: ${String(data.error?.message || data.msg || data.message || response.statusText).slice(0, 400)}`,
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

import { configureTransport, validateUrl } from '../../../packages/runtime/src/network.ts';
export {
  network,
  readJson,
  safeError,
  validateUrl,
  endpoint,
  UpstreamResponseError,
} from '../../../packages/runtime/src/network.ts';
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
export function networkAddressBlocked(ip: string, allowPrivate = false, allowProxyDns = false) {
  const proxyDnsAddress = isIP(ip) === 4 && /^198\.(18|19)\./.test(ip);
  return !allowPrivate && privateAddress(ip) && !(allowProxyDns && proxyDnsAddress);
}
const agents = new Map<string, Agent>();
function agent(allowPrivate: boolean, allowProxyDns: boolean) {
  const key = `${allowPrivate}:${allowProxyDns}`;
  if (!agents.has(key))
    agents.set(
      key,
      new Agent({
        connect: {
          lookup: ((hostname: string, options: any, callback: any) => {
            lookup(hostname, { all: true })
              .then((addresses) => {
                if (
                  addresses.some((a) =>
                    networkAddressBlocked(a.address, allowPrivate, allowProxyDns),
                  )
                )
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
  return agents.get(key)!;
}
async function serverNetwork(
  url: string,
  init: RequestInit = {},
  allowPrivate = process.env.ALLOW_PRIVATE_ENDPOINTS === 'true',
  allowProxyDns = false,
) {
  const parsed = validateUrl(url);
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && networkAddressBlocked(literal, allowPrivate, allowProxyDns))
    throw Error('禁止请求内网地址');
  const result = await transport(parsed, {
    ...(init as any),
    dispatcher: agent(allowPrivate, allowProxyDns),
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(init.signal ? [init.signal] : [])]),
  });
  return result as unknown as Response;
}

configureTransport(serverNetwork);

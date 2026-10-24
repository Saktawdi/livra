import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EnvHttpProxyAgent, fetch as upstreamFetch } from 'undici';

export const relayPath = '/__livra_transport';
export const relayMeta = '<meta name="livra-network-relay" content="available">';
const hopHeaders =
  /^(host|connection|keep-alive|transfer-encoding|te|trailer|upgrade|proxy-.*|cookie|origin|referer|sec-.*|x-livra-transport)$/i;

function systemProxy() {
  if (process.platform !== 'win32') return '';
  try {
    const text = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1500,
      },
    );
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(text)) return '';
    const raw = text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/)?.[1]?.trim();
    const value =
      raw?.match(/(?:^|;)https=([^;]+)/)?.[1] || raw?.split(';')[0]?.replace(/^http=/, '');
    return value ? (/^\w+:\/\//.test(value) ? value : 'http://' + value) : '';
  } catch {
    return '';
  }
}

export function createDispatcher() {
  const windowsProxy = systemProxy();
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY;
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY;
  const noProxy = (process.env.no_proxy ?? process.env.NO_PROXY ?? '').trim();
  return new EnvHttpProxyAgent({
    httpProxy: httpProxy ?? windowsProxy,
    httpsProxy: httpsProxy ?? httpProxy ?? windowsProxy,
    noProxy: noProxy === '*' ? '*' : ['localhost', '127.0.0.1', '[::1]', noProxy].join(','),
    connect: { timeout: 20_000 },
    headersTimeout: 900_000,
    bodyTimeout: 900_000,
  });
}

function targetUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('仅支持不含用户凭据的 HTTP(S) 地址');
  return url;
}

// Only bytes cross this boundary. Settings, Agent execution and storage stay in the browser.
export function createNetworkRelay({ dispatcher, timeout = 900_000 } = {}) {
  let sharedDispatcher = dispatcher;
  const relay = async (request, response, next) => {
    const localUrl = new URL(request.url, 'http://localhost');
    if (localUrl.pathname !== relayPath) {
      next?.();
      return false;
    }
    const asset = localUrl.searchParams.get('asset') === '1';
    const origin = request.headers.origin;
    let sameHost = !origin;
    try {
      if (origin) sameHost = new URL(origin).host === request.headers.host;
    } catch {}
    const allowedAsset =
      asset && request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin';
    if (
      (!allowedAsset && request.headers['x-livra-transport'] !== 'web') ||
      !sameHost ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
    ) {
      response.writeHead(403);
      response.end();
      return true;
    }
    const abort = new AbortController();
    const cancel = () => {
      if (!response.writableEnded) abort.abort();
    };
    request.once('aborted', cancel);
    response.once('close', cancel);
    try {
      let target = targetUrl(localUrl.searchParams.get('url'));
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers))
        if (!hopHeaders.test(name) && value !== undefined) headers.set(name, String(value));
      if (asset)
        for (const name of [...headers.keys()])
          if (/authorization|api.?key|token|secret/i.test(name)) headers.delete(name);
      // Undici decodes response compression; do not request a second browser decoding pass.
      headers.set('accept-encoding', 'identity');
      let method = request.method || 'GET';
      let body = ['GET', 'HEAD'].includes(method) ? undefined : Readable.toWeb(request);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]);
      sharedDispatcher ||= createDispatcher();
      let upstream;
      for (let redirects = 0; ; redirects++) {
        upstream = await upstreamFetch(target, {
          method,
          headers,
          body,
          duplex: 'half',
          redirect: 'manual',
          signal,
          dispatcher: sharedDispatcher,
        });
        if (
          ![301, 302, 303, 307, 308].includes(upstream.status) ||
          !upstream.headers.get('location')
        )
          break;
        await upstream.body?.cancel();
        if (redirects >= 4) throw Error('服务重定向次数过多');
        const nextTarget = targetUrl(new URL(upstream.headers.get('location'), target).href);
        if (nextTarget.origin !== target.origin)
          for (const name of [...headers.keys()])
            if (/authorization|api.?key|token|secret/i.test(name)) headers.delete(name);
        if (
          upstream.status === 303 ||
          ([301, 302].includes(upstream.status) && method === 'POST')
        ) {
          method = 'GET';
          body = undefined;
          headers.delete('content-type');
          headers.delete('content-length');
        } else if (body) throw Error('服务要求重定向上传，请使用最终接口地址');
        target = nextTarget;
      }
      response.statusCode = upstream.status;
      for (const [name, value] of upstream.headers)
        if (
          !hopHeaders.test(name) &&
          !/^(content-encoding|content-length|set-cookie|access-control-.*)$/i.test(name)
        )
          response.setHeader(name, value);
      response.setHeader('Cache-Control', asset ? 'private, max-age=3600' : 'no-store');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      if (upstream.body && request.method !== 'HEAD')
        await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(502, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Livra-Relay-Error': '1',
        });
        const detail = error.cause?.message || error.message || '连接失败';
        response.end(
          JSON.stringify({ error: '无法连接上游服务：' + String(detail).slice(0, 400) }),
        );
      } else if (!response.destroyed) response.destroy();
    } finally {
      request.removeListener('aborted', cancel);
      response.removeListener('close', cancel);
    }
    return true;
  };
  relay.close = () => sharedDispatcher?.close();
  return relay;
}

export function networkRelayPlugin() {
  const install = (server) => {
    const relay = createNetworkRelay();
    server.middlewares.use((request, response, next) => {
      void relay(request, response, next);
    });
    server.httpServer?.once('close', () => {
      void relay.close();
    });
  };
  return {
    name: 'livra-network-relay',
    configureServer: install,
    configurePreviewServer: install,
    transformIndexHtml: (html) => html.replace('</head>', relayMeta + '</head>'),
  };
}

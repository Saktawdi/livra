import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNetworkRelay, relayMeta, relayPath } from './network-relay.mjs';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

// The browser owns the workspace. This host serves files and streams upstream bytes.
export function staticServer({ root = resolve('apps/web/dist'), migrate, relay = true } = {}) {
  root = resolve(root);
  const networkRelay = relay ? createNetworkRelay() : undefined;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (pathname === relayPath && networkRelay) {
        await networkRelay(request, response);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405);
        response.end();
        return;
      }
      if (pathname === '/__livra_migration' && migrate) {
        if (
          request.headers['sec-fetch-site'] !== 'same-origin' ||
          request.headers['x-livra-migration'] !== 'local'
        ) {
          response.writeHead(403);
          response.end();
          return;
        }
        const snapshot = await migrate(request);
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(snapshot));
        return;
      }
      if (pathname.startsWith('/api/') || pathname === '/__livra_migration') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ error: 'Livra runs in your browser. No local API server is required.' }),
        );
        return;
      }
      let path = resolve(root, '.' + pathname);
      if (path !== root && !path.startsWith(root + sep)) {
        response.writeHead(403);
        response.end();
        return;
      }
      let info = await stat(path).catch(() => undefined);
      if (info?.isDirectory()) {
        path = resolve(path, 'index.html');
        info = await stat(path).catch(() => undefined);
      }
      if (!info?.isFile()) {
        if (extname(pathname)) {
          response.writeHead(404);
          response.end();
          return;
        }
        path = resolve(root, 'index.html');
        info = await stat(path);
      }
      response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      response.setHeader(
        'Cache-Control',
        path.endsWith('.html')
          ? 'no-store'
          : pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
      );
      if (path.endsWith('index.html')) {
        const tags =
          (migrate ? '<meta name="livra-legacy-migration" content="available">' : '') +
          (relay ? relayMeta : '');
        const html = (await readFile(path, 'utf8')).replace('</head>', tags + '</head>');
        response.end(request.method === 'HEAD' ? undefined : html);
        return;
      }
      response.setHeader('Content-Length', info.size);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(path)
        .on('error', () => response.destroy())
        .pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end('Unable to serve this file. Build the web app first.');
    }
  });
  server.once('close', () => {
    void networkRelay?.close();
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = staticServer();
  const port = Number(process.env.PORT || 3400);
  server.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`Livra frontend: http://localhost:${port}`),
  );
}

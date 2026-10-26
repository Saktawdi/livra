import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { Agent, fetch as upstreamFetch } from 'undici';

const { createNetworkRelay, createDispatcher } = await import('../scripts/' + 'network-relay.mjs');

test('NO_PROXY wildcard bypasses a configured proxy for local endpoints beyond localhost', async (t) => {
  const keys = ['http_proxy', 'https_proxy', 'no_proxy'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.http_proxy = process.env.https_proxy = 'http://127.0.0.1:1';
  process.env.no_proxy = '*';
  const dispatcher = createDispatcher();
  const server = createServer((_request, response) => response.end('direct connection'));
  t.after(async () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    server.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      dispatcher.close(),
    ]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.2', resolve));
  const port = (server.address() as { port: number }).port;
  const response = await upstreamFetch('http://127.0.0.2:' + port, {
    dispatcher,
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(await response.text(), 'direct connection');
});

async function fixture(t: TestContext, handler: RequestListener) {
  const upstream = createServer(handler);
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const relay = createNetworkRelay({ dispatcher: new Agent(), timeout: 5000 });
  const gateway = createServer((req, res) => {
    void relay(req, res);
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const address = (server: typeof gateway) =>
    'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const base = address(upstream),
    host = address(gateway);
  t.after(async () => {
    gateway.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => gateway.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
      relay.close(),
    ]);
  });
  const url = (path = '/') =>
    host + '/__livra_transport?url=' + encodeURIComponent(new URL(path, base).href);
  const request = (path = '/', init: RequestInit = {}) =>
    fetch(url(path), {
      ...init,
      headers: { 'X-Livra-Transport': 'web', ...init.headers },
    });
  return { base, host, url, request };
}

test('relay forwards JSON and multipart bytes to a provider without CORS and never forwards browser cookies', async (t) => {
  const f = await fixture(t, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('base64'),
      }),
    );
  });
  const response = await f.request('/v1/models', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer fixture-key',
      Cookie: 'workspace=private',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'fixture-model' }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.headers.authorization, 'Bearer fixture-key');
  assert.equal(data.headers.cookie, undefined);
  assert.equal(data.headers.origin, undefined);
  assert.equal(data.headers['x-livra-transport'], undefined);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(Buffer.from(data.body, 'base64').toString(), '{"model":"fixture-model"}');
  const form = new FormData();
  form.set('model', 'image-model');
  form.set(
    'image',
    new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    'reference.png',
  );
  const upload = await (await f.request('/v1/images/edits', { method: 'POST', body: form })).json();
  assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/);
  const bytes = Buffer.from(upload.body, 'base64');
  assert.ok(bytes.includes(Buffer.from([137, 80, 78, 71])));
  assert.ok(bytes.includes(Buffer.from('name="model"')));
});

test('relay streams the first SSE event before completion and cancels upstream when the reader leaves', async (t) => {
  let finish!: () => void;
  let closed!: () => void;
  const canceled = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const f = await fixture(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: first\n\n');
    if (req.url === '/cancel') res.once('close', closed);
    else finish = () => res.end('data: second\n\n');
  });
  const response = await f.request('/stream');
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  finish();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: second\n\n');
  assert.equal((await reader.read()).done, true);
  const abort = new AbortController();
  const pending = await f.request('/cancel', { signal: abort.signal });
  const cancelReader = pending.body!.getReader();
  await cancelReader.read();
  abort.abort();
  await assert.rejects(cancelReader.read());
  await canceled;
});

test('relay preserves upstream errors and binary assets, rejects foreign origins, and strips credentials on redirects', async (t) => {
  const foreign = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.headers));
  });
  await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    foreign.closeAllConnections();
    foreign.close();
  });
  const f = await fixture(t, (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, {
        Location: 'http://127.0.0.1:' + (foreign.address() as { port: number }).port,
      });
      res.end();
    } else if (req.url === '/asset') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(Buffer.from([0, 1, 2, 255]));
    } else {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"provider quota"}}');
    }
  });
  const error = await f.request('/quota');
  assert.equal(error.status, 429);
  assert.match(await error.text(), /provider quota/);
  const headers = await (
    await f.request('/redirect', {
      headers: { Authorization: 'Bearer fixture-secret', 'X-Api-Key': 'secret' },
    })
  ).json();
  assert.equal(headers.authorization, undefined);
  assert.equal(headers['x-api-key'], undefined);
  const asset = await fetch(f.url('/asset') + '&asset=1', {
    headers: { 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.deepEqual([...new Uint8Array(await asset.arrayBuffer())], [0, 1, 2, 255]);
  assert.match(asset.headers.get('cache-control')!, /private/);
  assert.equal((await fetch(f.url())).status, 403);
  assert.equal(
    (await f.request('/', { headers: { Origin: 'https://foreign.example' } })).status,
    403,
  );
  assert.equal((await f.request('/', { headers: { Origin: 'invalid-origin' } })).status, 403);
});

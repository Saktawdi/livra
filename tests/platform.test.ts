import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createApp } from '../apps/server/src/app.ts';
import {
  defaultSettings,
  liveModelSchema,
  builtInLiveModels,
  applyMarpTheme,
  marpThemeName,
  whaleLiveModel,
} from '@livra/shared';
import { complete, listModels, sse } from '../apps/server/src/providers.ts';
import { synthesize } from '../apps/server/src/speech.ts';
import { privateAddress, network, networkAddressBlocked } from '../apps/server/src/network.ts';
import { renderSlides } from '../apps/server/src/tools.ts';
import { runs } from '../apps/server/src/agent.ts';
import { executeTool, functionTools, type Context } from '../apps/server/src/tools.ts';
import { LiveModelService } from '../apps/server/src/live-models.ts';

process.env.ALLOW_PRIVATE_ENDPOINTS = 'true';
test('Marp theme selection preserves frontmatter and uses the CSS identifier', () => {
  assert.equal(marpThemeName('/* @theme ocean */\nsection{color:blue}'), 'ocean');
  for (const newline of ['\n', '\r\n']) {
    const markdown = [
      '---',
      'marp: true',
      'theme: default',
      'paginate: true',
      '---',
      '# Title',
    ].join(newline);
    assert.equal(
      applyMarpTheme(markdown, 'ocean'),
      markdown.replace('theme: default', 'theme: ocean'),
    );
    assert.equal(
      applyMarpTheme(['---', '---', '# Title'].join(newline), 'ocean'),
      ['---', 'theme: ocean', '---', '# Title'].join(newline),
    );
  }
  assert.equal(
    applyMarpTheme('# Title\n\n---\n# Page 2', 'ocean'),
    '---\ntheme: ocean\n---\n\n# Title\n\n---\n# Page 2',
  );
});

test('saved themes can be discovered and reused after renaming; slides retain a CSS snapshot', async (t) => {
  const { app, cookie, settings, store } = await fixture(t);
  const call = (name: string, args: any, session = cookie) =>
    app.inject({
      method: 'POST',
      url: '/api/tools/execute',
      headers: { ...headers, cookie: session },
      payload: { name, args },
    });
  const created = await call('create_marp_theme', {
    name: 'ocean',
    css: 'section { background: #123abc; }',
  });
  assert.equal(created.statusCode, 200, created.body);
  const themeId = created.json().artifactId;
  await app.inject({
    method: 'PATCH',
    url: '/api/artifacts/' + themeId,
    headers: { ...headers, cookie },
    payload: { title: '我的海洋主题' },
  });
  const listing = await call('list_marp_themes', { query: '海洋', limit: 1 });
  assert.deepEqual(
    listing.json().themes.map((t: any) => [t.id, t.name, t.title]),
    [[themeId, 'ocean', '我的海洋主题']],
  );
  const rendered = await call('create_slides', {
    title: 'Reuse',
    markdown: '---\ntheme: default\n---\n# Hello',
    themeId,
  });
  assert.equal(rendered.statusCode, 200, rendered.body);
  const saved = (
    await app.inject({ url: '/api/artifacts/' + rendered.json().artifactId, headers: { cookie } })
  ).json();
  assert.match(saved.data.markdown, /theme: ocean/);
  assert.match(saved.data.html, /#123abc/);
  assert.equal(saved.data.themeId, themeId);
  assert.match(saved.data.theme, /@theme ocean/);
  const other = (await app.inject('/api/bootstrap')).headers['set-cookie']!.toString().split(
    ';',
  )[0];
  const foreign = await call(
    'create_slides',
    { title: 'Forbidden', markdown: '# Test', themeId },
    other,
  );
  assert.notEqual(foreign.statusCode, 200);
  assert.match(foreign.body, /主题不存在/);
  const invalid = await call('create_slides', {
    title: 'Forbidden',
    markdown: '# Test',
    themeId,
    theme: '/* @theme duplicate */',
  });
  assert.notEqual(invalid.statusCode, 200);
  await app.inject({
    method: 'DELETE',
    url: '/api/artifacts/' + themeId,
    headers: { ...headers, cookie },
  });
  const missing = await call('create_slides', { title: 'Missing', markdown: '# Test', themeId });
  assert.notEqual(missing.statusCode, 200);
  assert.match(renderSlides(saved.data.markdown, saved.data.theme), /#123abc/);
  const ctx = {
    store,
    liveModels: new LiveModelService(store),
    workspace: store.session(cookie.split('=')[1])!,
    settings,
    persona: { ...settings.personas[0], tools: ['create_slides'] },
    signal: new AbortController().signal,
    emit: () => {},
  } as Context;
  assert.ok(functionTools(ctx).some((t) => t.function.name === 'list_marp_themes'));
  assert.equal((await executeTool('list_marp_themes', {}, ctx)).total, 0);
  ctx.persona = { ...ctx.persona, tools: [] };
  await assert.rejects(executeTool('list_marp_themes', {}, ctx), /未对当前人偶开放/);
});

test('two conversations stream independently; duplicate runs conflict and stop is scoped', async (t) => {
  const outputs = new Map<string, ServerResponse>();
  const base = await mock(t, (_req, res, body) => {
    const name = body.messages.findLast((m: any) => m.role === 'user').content;
    outputs.set(name, res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'reply ' + name } }] }) + '\n\n',
    );
  });
  const { app, cookie, settings, store } = await fixture(t);
  settings.providers = [
    { id: 'p', name: 'mock', protocol: 'openai', kind: 'chat', models: ['test'], baseUrl: base },
  ];
  await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  const create = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        headers: { ...headers, cookie },
        payload: { personaId: 'atlas' },
      })
    ).json();
  const first = await create(),
    second = await create();
  const start = (id: string, content: string) =>
    Promise.resolve(
      app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...headers, cookie },
        payload: { conversationId: id, providerId: 'p', model: 'test', content },
      }),
    );
  const pendingA = start(first.id, 'A');
  await until(() => outputs.has('A'));
  const pendingB = start(second.id, 'B');
  await until(() => outputs.has('B'));
  assert.equal((await start(first.id, 'duplicate')).statusCode, 409);
  const workspace = store.session(cookie.split('=')[1])!;
  const a = [...runs.values()].find(
    (r) => r.workspace === workspace && r.conversationId === first.id,
  )!;
  const b = [...runs.values()].find(
    (r) => r.workspace === workspace && r.conversationId === second.id,
  )!;
  assert.ok(a && b);
  const preferences = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: { ...settings, theme: 'light' },
  });
  assert.equal(preferences.statusCode, 200);
  assert.equal(a.controller.signal.aborted, false);
  assert.equal(b.controller.signal.aborted, false);
  const other = (await app.inject('/api/bootstrap')).headers['set-cookie']!.toString().split(
    ';',
  )[0];
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/runs/${a.id}/stop`,
        headers: { ...headers, cookie: other },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(a.controller.signal.aborted, false);
  await app.inject({
    method: 'POST',
    url: `/api/runs/${a.id}/stop`,
    headers: { ...headers, cookie },
    payload: {},
  });
  assert.equal((await pendingA).statusCode, 200);
  assert.equal(b.controller.signal.aborted, false);
  outputs.get('B')!.end('data: [DONE]\n\n');
  assert.equal((await pendingB).statusCode, 200);
  const savedA = store.get<any>(workspace, 'conversation', first.id),
    savedB = store.get<any>(workspace, 'conversation', second.id);
  assert.equal(savedA.messages[1].content, 'reply A');
  assert.equal(savedA.messages[1].interrupted, true);
  assert.equal(savedB.messages[1].content, 'reply B');
  assert.ok(!savedB.messages[1].interrupted);
  assert.ok(![...runs.values()].some((r) => r.workspace === workspace));
});

test('bundled whale references real assets and all configured expressions and motions', () => {
  const root = join(import.meta.dirname, '../apps/web/public/models/whale');
  const model = JSON.parse(readFileSync(join(root, 'c_0120.model3.json'), 'utf8'));
  const refs = model.FileReferences;
  const expressions = new Set(refs.Expressions.map((e: any) => e.Name));
  assert.equal(expressions.size, 44);
  for (const reaction of [
    ...Object.values(whaleLiveModel.live.reactions),
    ...Object.values(whaleLiveModel.live.expressions).map((expression) => ({
      expression,
      motion: '',
    })),
  ]) {
    if (reaction.expression) assert.ok(expressions.has(reaction.expression), reaction.expression);
    if (reaction.motion) assert.ok(refs.Motions[reaction.motion], reaction.motion);
  }
  for (const file of [
    refs.Moc,
    ...refs.Textures,
    refs.Physics,
    refs.DisplayInfo,
    ...refs.Expressions.map((e: any) => e.File),
    ...Object.values(refs.Motions)
      .flat()
      .map((m: any) => m.File),
  ].filter(Boolean))
    assert.ok(readFileSync(join(root, file)).length > 0, file);
  assert.equal(readFileSync(join(root, refs.Moc))[4], 4);
  assert.match(readFileSync(join(root, 'LIVRA-NOTICE.md'), 'utf8'), /CC BY-NC-SA 4.0/);
});
const directory = () => mkdtempSync(join(tmpdir(), 'livra-test-'));
const headers = { 'x-livra-client': 'web' };
async function fixture(t: any) {
  const path = directory();
  const { app, store } = await createApp({ directory: path, staticRoot: join(path, 'no-static') });
  await app.ready();
  t.after(async () => {
    await app.close();
    rmSync(path, { recursive: true, force: true });
  });
  const bootstrap = await app.inject('/api/bootstrap');
  const cookie = bootstrap.headers['set-cookie']!.toString().split(';')[0];
  const settings = { ...bootstrap.json().settings, liveModelSources: [] } as typeof defaultSettings;
  store.saveSettings(store.session(cookie.split('=')[1])!, settings);
  return {
    app,
    store,
    cookie,
    settings,
    path,
  };
}
async function mock(
  t: any,
  handler: (req: IncomingMessage, res: ServerResponse, data: any) => void,
) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const bytes of req) body += bytes;
    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
    handler(req, res, data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as any).port}/v1`;
}
function send(res: ServerResponse, chunks: any[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n');
  res.end('data: [DONE]\n\n');
}
test('workspace isolation, encrypted persistence, and secret redaction', async (t) => {
  const { app, store, cookie, settings, path } = await fixture(t);
  const configured = {
    ...settings,
    providers: [
      {
        id: 'p',
        name: 'Private',
        baseUrl: 'https://example.com/v1',
        protocol: 'openai',
        kind: 'chat',
        models: ['test'],
        apiKey: 'sk-not-for-a-browser-12345',
      },
    ],
    customTools: [
      {
        name: 'external',
        title: 'External',
        description: 'test',
        endpoint: 'https://example.com/tool',
        apiKey: 'custom-secret-12345',
        inputSchema: { type: 'object' },
        enabled: true,
      },
    ],
    searchKey: 'search-secret-12345',
  };
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: configured,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().providers[0].hasKey, true);
  assert.ok(!saved.body.includes('sk-not-for'));
  const tools = await app.inject({ url: '/api/tools', headers: { cookie } });
  assert.ok(!tools.body.includes('custom-secret'));
  const persisted = store.settings(store.session(cookie.split('=')[1])!);
  assert.equal(persisted.providers[0].apiKey, 'sk-not-for-a-browser-12345');
  const second = await app.inject('/api/bootstrap');
  assert.equal(second.json().settings.providers.length, 0);
  const after = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: saved.json(),
  });
  assert.equal(after.statusCode, 200);
  assert.equal(
    store.settings(store.session(cookie.split('=')[1])!).providers[0].apiKey,
    'sk-not-for-a-browser-12345',
  );
  assert.ok(
    !readFileSync(join(path, 'livra.sqlite')).includes(Buffer.from('sk-not-for-a-browser-12345')),
  );
  const exportData = await app.inject({ url: '/api/export', headers: { cookie } });
  assert.ok(!exportData.body.includes('custom-secret'));
  assert.ok(!exportData.body.includes('search-secret'));
});
test('cross-origin writes and missing client header are rejected', async (t) => {
  const { app, cookie, settings } = await fixture(t);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { cookie },
        payload: settings,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { ...headers, cookie, origin: 'https://evil.example' },
        payload: settings,
      })
    ).statusCode,
    403,
  );
});
test('private network requests are blocked by default, including literal IPv6', async () => {
  for (const ip of [
    '127.0.0.1',
    '169.254.169.254',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.2.1',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
  ]) {
    assert.equal(privateAddress(ip), true, ip);
    assert.equal(networkAddressBlocked(ip, false, true), true, ip);
  }
  for (const ip of ['198.18.0.0', '198.18.255.255', '198.19.255.255']) {
    assert.equal(networkAddressBlocked(ip), true, ip);
    assert.equal(networkAddressBlocked(ip, false, true), false, ip);
  }
  assert.equal(privateAddress('1.1.1.1'), false);
  assert.equal(privateAddress('2606:4700:4700::1111'), false);
  await assert.rejects(network('http://127.0.0.1:1', {}, false));
  await assert.rejects(network('http://[::ffff:127.0.0.1]:1', {}, false));
  await assert.rejects(network('http://127.0.0.1:1', {}, false, true), /禁止请求内网地址/);
  await assert.rejects(network('file:///etc/passwd', {}, false));
});
test('SSE parser preserves UTF-8 across fragments and CRLF frames', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"你好"}\r\n\r\ndata: [DONE]\r\n\r\n');
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 3) chunks.push(bytes.slice(i, i + 3));
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(chunk);
        c.close();
      },
    }),
  );
  const events = [];
  for await (const e of sse(response)) events.push(e);
  assert.deepEqual(events, [{ text: '你好' }]);
  const error = new Response('data: {"error":{"message":"rate limited"}}\n\n');
  await assert.rejects(async () => {
    for await (const e of sse(error)) void e;
  }, /rate limited/);
});
test('four provider protocols normalize streamed replies, tools and usage', async (t) => {
  const observed: any[] = [];
  const base = await mock(t, (req, res, body) => {
    observed.push({ url: req.url, body });
    if (req.url?.includes('chat/completions'))
      send(res, [
        {
          choices: [
            {
              delta: {
                reasoning_content: 'thinking',
                content: 'hello',
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'set_emotion', arguments: '{"mood":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"happy"}' } }] } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        },
      ]);
    else if (req.url?.includes('responses'))
      send(res, [
        { type: 'response.output_text.delta', delta: 'hello' },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'function_call', call_id: 'c2', name: 'set_emotion', arguments: '' },
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 1,
          delta: '{"mood":"happy"}',
        },
        {
          type: 'response.completed',
          response: { usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } },
        },
      ]);
    else if (req.url?.includes('/messages'))
      send(res, [
        { type: 'message_start', message: { usage: { input_tokens: 3 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'c3', name: 'set_emotion' },
        },
        { type: 'content_block_delta', index: 1, delta: { partial_json: '{"mood":"happy"}' } },
        { type: 'message_delta', usage: { output_tokens: 4 } },
      ]);
    else
      send(res, [
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'hello' },
                  { functionCall: { name: 'set_emotion', args: { mood: 'happy' } } },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
        },
      ]);
  });
  for (const protocol of ['openai', 'responses', 'anthropic', 'gemini'] as const) {
    const events: any[] = [];
    const result = await complete(
      {
        id: 'p',
        name: 'test',
        kind: 'chat',
        baseUrl: base,
        models: ['test'],
        protocol,
        apiKey: 'private',
      },
      'test',
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'hey' },
      ],
      [],
      'auto',
      AbortSignal.timeout(5000),
      (type, text) => events.push({ type, text }),
    );
    assert.equal(result.content, 'hello');
    assert.equal(result.usage?.total, 7);
    assert.equal(result.calls[0].function.name, 'set_emotion');
    assert.equal(JSON.parse(result.calls[0].function.arguments).mood, 'happy');
    assert.equal(
      events
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
      'hello',
    );
  }
  assert.equal(observed.length, 4);
  assert.equal(observed[2].body.system, 'system');
  assert.ok(observed[3].body.contents);
});
test('Sakta login uses form encoding, checks business code, and keeps token on server', async (t) => {
  const prior = process.env.SAKTA_BASE_URL;
  const base = await mock(t, (req, res, body) => {
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        form.get('password') === 'correct'
          ? { code: 0, token: 'sakta-token-private' }
          : { code: 500, msg: 'wrong password' },
      ),
    );
  });
  process.env.SAKTA_BASE_URL = base.slice(0, -3);
  t.after(() => {
    if (prior === undefined) delete process.env.SAKTA_BASE_URL;
    else process.env.SAKTA_BASE_URL = prior;
  });
  const { app, cookie } = await fixture(t);
  const bad = await app.inject({
    method: 'POST',
    url: '/api/auth/sakta',
    headers: { ...headers, cookie },
    payload: { username: 'a+b@example.com', password: 'wrong' },
  });
  assert.equal(bad.statusCode, 401);
  const good = await app.inject({
    method: 'POST',
    url: '/api/auth/sakta',
    headers: { ...headers, cookie },
    payload: { username: 'a+b@example.com', password: 'correct' },
  });
  assert.equal(good.statusCode, 200);
  assert.ok(!good.body.includes('sakta-token-private'));
  assert.equal(good.json().settings.sakta.connected, true);
});
test('Sakta proxy uses the documented v1 Bearer contract and preserves upstream model failures', async (t) => {
  const prior = process.env.SAKTA_BASE_URL;
  let status = 200;
  let payload: any = { object: 'list', data: [{ id: 'models/custom' }, { id: 'remote/model' }] };
  let lastPath = '';
  const base = await mock(t, (req, res, body) => {
    lastPath = req.url!;
    const route = req.url!.replace(/^\/gateway/, '');
    res.setHeader('Content-Type', 'application/json');
    if (route === '/v1/user/pub/login') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
      assert.equal(new URLSearchParams(body).get('password'), 'test-password');
      res.end(JSON.stringify({ code: 0, token: 'sakta-contract-secret' }));
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer sakta-contract-secret');
    assert.equal(req.headers.token, undefined);
    if (route === '/v1/models') {
      assert.equal(req.method, 'GET');
      res.statusCode = status;
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      return;
    }
    assert.equal(route, '/v1/chat/completions');
    assert.equal(body.model, 'models/custom');
    send(res, [{ choices: [{ delta: { content: 'Sakta 接口校验完成' } }] }]);
  });
  const root = base.slice(0, -3);
  process.env.SAKTA_BASE_URL = root;
  t.after(() => {
    if (prior === undefined) delete process.env.SAKTA_BASE_URL;
    else process.env.SAKTA_BASE_URL = prior;
  });
  const { app, cookie } = await fixture(t);
  const models = () => app.inject({ url: '/api/sakta/models', headers: { cookie } });
  assert.equal((await models()).statusCode, 401);
  const login = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sakta',
      headers: { ...headers, cookie },
      payload: { username: 'contract-review', password: 'test-password' },
    });
  assert.equal((await login()).statusCode, 200);
  for (const code of [401, 403, 429, 502, 503]) {
    status = code;
    payload = { error: { message: 'upstream failure sakta-contract-secret' } };
    const response = await models();
    assert.equal(response.statusCode, code, response.body);
    assert.ok(!response.body.includes('sakta-contract-secret'));
    assert.ok(!response.body.includes('"models":[]'));
  }
  status = 200;
  for (const invalid of ['<html>login</html>', { code: 500, msg: 'legacy endpoint' }]) {
    payload = invalid;
    const response = await models();
    assert.equal(response.statusCode, 502, response.body);
  }
  payload = { object: 'list', data: [] };
  assert.deepEqual((await models()).json(), { models: [] });
  payload = {
    object: 'list',
    data: [{ id: 'remote/model' }, { id: 'models/custom' }, { id: 'remote/model' }],
  };
  for (const suffix of ['', '/', '/v1', '/v1/', '/gateway', '/gateway/v1/']) {
    process.env.SAKTA_BASE_URL = root + suffix;
    assert.equal((await login()).statusCode, 200);
    const prefix = suffix.startsWith('/gateway') ? '/gateway/v1' : '/v1';
    assert.equal(lastPath, prefix + '/user/pub/login');
    const response = await models();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(lastPath, prefix + '/models');
    assert.deepEqual(response.json(), { models: ['models/custom', 'remote/model'] });
  }
  const conversation = (
    await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { ...headers, cookie },
      payload: { personaId: 'atlas' },
    })
  ).json();
  const run = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: { ...headers, cookie },
    payload: {
      conversationId: conversation.id,
      providerId: 'sakta',
      model: 'models/custom',
      content: '测试对话',
    },
  });
  assert.equal(run.statusCode, 200);
  assert.match(run.body, /Sakta 接口校验完成/);
  assert.equal(lastPath, '/gateway/v1/chat/completions');
});

test('Agent completes multiple tool rounds, persists artifacts, and preserves protocol history', async (t) => {
  const base = await mock(t, async (_req, res, body) => {
    if (body.messages.some((m: any) => m.role === 'tool')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: '已经完成' } }] }) + '\n\n',
      );
      await new Promise((r) => setTimeout(r, 150));
      res.end(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: '演示文稿。' } }],
            usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
          }) +
          '\n\ndata: [DONE]\n\n',
      );
    } else
      send(res, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'slides-call',
                    type: 'function',
                    function: {
                      name: 'create_slides',
                      arguments: JSON.stringify({
                        title: 'Test slides',
                        markdown: '# Hello\n\n---\n\n# World',
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        },
      ]);
  });
  const { app, cookie, settings, store } = await fixture(t);
  settings.providers = [
    {
      id: 'p',
      name: 'mock',
      protocol: 'openai',
      kind: 'chat',
      models: ['test'],
      baseUrl: base,
      apiKey: 'test-key',
    },
  ];
  settings.toolPermission = 'auto';
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { ...headers, cookie },
        payload: settings,
      })
    ).statusCode,
    200,
  );
  const c = (
    await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { ...headers, cookie },
      payload: { personaId: 'atlas' },
    })
  ).json();
  const response = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: { ...headers, cookie },
    payload: { conversationId: c.id, providerId: 'p', model: 'test', content: '制作一个演示' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /tool-start/);
  assert.match(response.body, /artifact/);
  assert.match(response.body, /已经完成/);
  assert.match(response.body, /"type":"done"/);
  const saved = (
    await app.inject({ url: '/api/conversations/' + c.id, headers: { cookie } })
  ).json();
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].tools[0].status, 'done');
  assert.equal(saved.messages[1].usage.total, 27);
  assert.equal(saved.messages[1].contextTokens, 18);
  assert.equal(saved.messages[1].generation.outputTokens, 8);
  assert.ok(saved.messages[1].generation.durationMs >= 100);
  assert.equal(saved.messages[1].generation.estimated, false);
  assert.equal(saved.messages[1].model, 'test');
  assert.match(response.body, /"type":"metrics"/);
  assert.equal(saved.protocolMessages, undefined);
  const workspace = store.session(cookie.split('=')[1])!;
  assert.equal(store.artifacts(workspace).length, 1);
  assert.ok(
    store
      .get<any>(workspace, 'conversation', c.id)
      .protocolMessages.some((m: any) => m.role === 'tool'),
  );
  assert.equal(runs.size, 0);
});

test('shared Live2D catalog persists custom shapes, exposes them to Agents, and applies selected configuration', async (t) => {
  const { app, cookie, settings } = await fixture(t);
  const custom = liveModelSchema.parse({
    id: 'my-character',
    name: '我的原创形象',
    description: '适合研究搭档',
    live: {
      modelUrl: 'https://example.com/character/model.model3.json',
      scale: 1.25,
      tapMotion: 'Wave',
    },
  });
  settings.liveModels = [custom];
  const save = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  assert.equal(save.statusCode, 200);
  const catalog = (await app.inject({ url: '/api/live-models', headers: { cookie } })).json();
  assert.equal(catalog.length, builtInLiveModels.length + 1);
  assert.equal(catalog.at(-1).id, custom.id);
  const tools = (await app.inject({ url: '/api/tools', headers: { cookie } })).json();
  assert.ok(tools.some((tool: any) => tool.name === 'list_live2d_models'));
  const execute = (name: string, args: any) =>
    app.inject({
      method: 'POST',
      url: '/api/tools/execute',
      headers: { ...headers, cookie },
      payload: { name, args },
    });
  const liveListing = (await execute('list_live2d_models', {})).json();
  assert.deepEqual(
    {
      ...liveListing,
      models: liveListing.models.map(({ id, name, description }: any) => ({
        id,
        name,
        description,
      })),
    },
    {
      models: catalog.map(({ id, name, description }: any) => ({ id, name, description })),
      total: catalog.length,
      nextOffset: null,
    },
  );
  assert.equal(
    liveListing.models.find((m: any) => m.id === 'whale').license,
    whaleLiveModel.license,
  );
  const result = await execute('create_persona', {
    name: '新搭档',
    description: '研究伙伴',
    systemPrompt: '帮助研究',
    mode: 'work',
    liveModelId: custom.id,
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().persona.live, custom.live);
  const missing = await execute('create_persona', {
    name: '新搭档',
    description: '',
    systemPrompt: '帮助研究',
    mode: 'work',
    liveModelId: 'invented',
  });
  assert.equal(missing.statusCode, 500);
  assert.match(missing.json().error, /形象不存在/);
  const other = await app.inject('/api/bootstrap');
  const otherCookie = other.headers['set-cookie']!.toString().split(';')[0];
  const otherCatalog = (
    await app.inject({ url: '/api/live-models', headers: { cookie: otherCookie } })
  ).json();
  assert.equal(otherCatalog.length, builtInLiveModels.length);
  const reserved = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: { ...settings, liveModels: [{ ...custom, id: 'haru' }] },
  });
  assert.equal(reserved.statusCode, 400);
  for (const liveModels of [[custom, custom], [{ ...custom, id: 'haru' }]]) {
    const imported = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...headers, cookie },
      payload: {
        version: 1,
        settings: { ...settings, liveModels },
        conversations: [],
        memories: [],
        artifacts: [],
      },
    });
    assert.equal(imported.statusCode, 400);
    assert.match(imported.json().error, /形象标识/);
  }
  assert.equal(
    liveModelSchema.safeParse({
      ...custom,
      live: { ...custom.live, modelUrl: 'javascript:alert(1)' },
    }).success,
    false,
  );
});
test('large Live2D catalogs remain searchable and readable within Agent tool-result limits', async (t) => {
  const { app, cookie, settings } = await fixture(t);
  settings.liveModels = Array.from({ length: 100 }, (_, index) =>
    liveModelSchema.parse({
      id: `custom-${index}`,
      name: `形象 ${index} ${'"\\\u0000'.repeat(20)}`,
      description: `风格-${index} ${'\u0000"\\\n'.repeat(120)}`,
      sourceUrl: 'https://example.com/source?' + 'a'.repeat(2000),
      live: {
        modelUrl: 'https://example.com/model.model3.json?' + 'v'.repeat(1800),
        scale: 1.8,
        offsetY: 0.25,
        tapMotion: 'Wave',
      },
    }),
  );
  const save = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  assert.equal(save.statusCode, 200, save.body);
  const catalog = (await app.inject({ url: '/api/live-models', headers: { cookie } })).json();
  assert.equal(catalog.length, builtInLiveModels.length + 100);
  assert.ok(JSON.stringify(catalog).length > 20000);
  const execute = (name: string, args: any) =>
    app.inject({
      method: 'POST',
      url: '/api/tools/execute',
      headers: { ...headers, cookie },
      payload: { name, args },
    });
  const ids: string[] = [];
  let offset: number | null = 0;
  let pages = 0;
  while (offset !== null) {
    const response = await execute('list_live2d_models', { offset });
    assert.equal(response.statusCode, 200);
    // agent.ts stores at most 20,000 characters of a serialized tool outcome.
    const serialized = JSON.stringify(response.json());
    assert.ok(serialized.length < 20000);
    const page = JSON.parse(serialized.slice(0, 20000));
    assert.equal(page.total, catalog.length);
    assert.ok(page.models.length > 0 && page.models.length <= 20);
    assert.ok(page.models.every((model: any) => !('live' in model)));
    ids.push(...page.models.map((model: any) => model.id));
    assert.ok(page.nextOffset === null || page.nextOffset > offset);
    offset = page.nextOffset;
    pages++;
    assert.ok(pages <= catalog.length);
  }
  assert.ok(pages > Math.ceil(catalog.length / 20), 'escaped metadata must honor the size budget');
  assert.deepEqual(
    ids,
    catalog.map((model: any) => model.id),
  );
  for (const query of ['CUSTOM-99', '形象 99', '风格-99']) {
    const result = (await execute('list_live2d_models', { query, limit: 1 })).json();
    assert.equal(result.total, 1);
    assert.equal(result.models[0].id, 'custom-99');
    assert.equal(result.nextOffset, null);
  }
  const beyond = (await execute('list_live2d_models', { offset: catalog.length })).json();
  assert.deepEqual(beyond.models, []);
  assert.equal(beyond.nextOffset, null);
  const created = await execute('create_persona', {
    name: '扩展目录中的伙伴',
    description: '',
    systemPrompt: '帮助研究',
    mode: 'work',
    liveModelId: 'custom-99',
  });
  assert.equal(created.statusCode, 200);
  assert.deepEqual(created.json().persona.live, settings.liveModels[99].live);
});

test('manual image and music tools persist real response media; unavailable services fail clearly', async (t) => {
  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=';
  const base = await mock(t, (req, res, body) => {
    assert.equal(body.prompt, 'test');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url?.includes('images')
          ? { data: [{ b64_json: pixel }] }
          : { data: [{ b64_json: Buffer.from('test-audio').toString('base64') }] },
      ),
    );
  });
  const { app, cookie, settings } = await fixture(t);
  const unavailable = await app.inject({
    method: 'POST',
    url: '/api/tools/execute',
    headers: { ...headers, cookie },
    payload: { name: 'generate_image', args: { prompt: 'test' } },
  });
  assert.equal(unavailable.statusCode, 500);
  settings.providers = ['image', 'music'].map((kind) => ({
    id: kind,
    name: kind,
    kind: kind as any,
    protocol: 'openai',
    baseUrl: base,
    apiKey: 'key',
    models: ['test'],
  }));
  settings.imageProvider = 'image';
  settings.imageModel = 'test';
  settings.musicProvider = 'music';
  settings.musicModel = 'test';
  await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  for (const name of ['generate_image', 'generate_music']) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/tools/execute',
      headers: { ...headers, cookie },
      payload: { name, args: { prompt: 'test' } },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.ok(result.json().artifactId);
  }
  const gallery = (await app.inject({ url: '/api/artifacts', headers: { cookie } })).json();
  assert.equal(gallery.length, 2);
  assert.ok(
    gallery.find((a: any) => a.kind === 'image').data.images[0].startsWith('/api/artifacts/'),
  );
  const other = (await app.inject('/api/bootstrap')).headers['set-cookie']!.toString().split(
    ';',
  )[0];
  const denied = await app.inject({
    url: gallery.find((a: any) => a.kind === 'image').data.images[0],
    headers: { cookie: other },
  });
  assert.equal(denied.statusCode, 404);
});
test('Marp rendering escapes active content and validates theme resources', () => {
  const rendered = renderSlides('# Hello\n\n<script>alert(1)</script>');
  assert.ok(!rendered.includes('<script>alert(1)</script>'));
  assert.ok(rendered.includes('<svg'));
  assert.throws(
    () => renderSlides('# Test', '/* @theme evil */\n@import "https://evil.example/style.css";'),
    /主题只能/,
  );
});

test('Fish speech sends the model header and reference ID; OpenAI speech remains compatible', async (t) => {
  const observed: any[] = [];
  const bytes = Buffer.from('ID3-mock-mp3');
  const base = await mock(t, (req, res, body) => {
    observed.push({ path: req.url, headers: req.headers, body });
    if (body.text === 'fail') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'rejected fish-private-secret' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(bytes);
    }
  });
  const { app, cookie, settings } = await fixture(t);
  settings.providers = [
    {
      id: 'fish',
      name: 'Fish',
      protocol: 'fish',
      kind: 'speech',
      baseUrl: base,
      apiKey: 'fish-private-secret',
      models: ['s2.1-pro'],
    },
  ];
  settings.speechProvider = 'fish';
  settings.speechModel = 's2.1-pro';
  settings.speechSpeed = 1.2;
  settings.speechLanguage = 'zh-CN';
  settings.speechVoice = 'default-reference';
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { ...headers, cookie },
        payload: settings,
      })
    ).statusCode,
    200,
  );
  const play = (payload: any) =>
    app.inject({ method: 'POST', url: '/api/speech', headers: { ...headers, cookie }, payload });
  const result = await play({ input: '你好', voice: 'persona-reference' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['content-type'], 'audio/mpeg');
  assert.deepEqual(result.rawPayload, bytes);
  assert.equal(observed[0].path, '/v1/tts');
  assert.equal(observed[0].headers.model, 's2.1-pro');
  assert.equal(observed[0].headers.authorization, 'Bearer fish-private-secret');
  assert.equal(observed[0].body.reference_id, 'persona-reference');
  assert.equal(observed[0].body.language, 'zh-CN');
  assert.equal(observed[0].body.prosody.speed, 1.2);
  assert.equal(observed[0].body.model, undefined);
  await play({ input: 'hello', language: 'auto' });
  assert.equal(observed[1].body.reference_id, 'default-reference');
  assert.equal(observed[1].body.language, undefined);
  const bad = await play({ input: 'fail' });
  assert.equal(bad.statusCode, 500);
  assert.ok(!bad.body.includes('fish-private-secret'));
  assert.match(bad.body, /redacted/);
  assert.equal((await play({ input: 'hello', language: 'not a language' })).statusCode, 400);
  assert.ok((await listModels(settings.providers[0])).includes('s2.1-pro'));
  settings.providers[0].protocol = 'openai';
  settings.speechModel = 'tts-1';
  settings.speechVoice = '';
  await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  await play({ input: 'hello' });
  assert.equal(observed.at(-1).path, '/v1/audio/speech');
  assert.equal(observed.at(-1).body.voice, 'alloy');
  assert.equal(observed.at(-1).body.model, 'tts-1');
});

test('speech bounds buffered audio and aborts a pending synthesis', async (t) => {
  const base = await mock(t, (_req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    if (body.text === 'large') res.end(Buffer.alloc(10_000_001));
    else res.write('ID3');
  });
  const provider = {
    id: 'f',
    name: 'Fish',
    protocol: 'fish' as const,
    kind: 'speech' as const,
    baseUrl: base,
    apiKey: 'key',
    models: [],
  };
  await assert.rejects(
    synthesize(provider, defaultSettings, 'large', '', 'auto', AbortSignal.timeout(5000)),
    /大小限制/,
  );
  await assert.rejects(
    synthesize(provider, defaultSettings, 'pending', '', 'auto', AbortSignal.timeout(50)),
  );
});

test('native reasoning signatures survive the next Anthropic, Responses, and Gemini turn', async (t) => {
  const requests: any[] = [];
  const base = await mock(t, (req, res, body) => {
    requests.push({ url: req.url, body });
    if (req.url?.includes('/messages'))
      send(res, [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        { type: 'content_block_delta', index: 0, delta: { thinking: 'private thought' } },
        { type: 'content_block_delta', index: 0, delta: { signature: 'signed-thinking' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { text: 'hello' } },
      ]);
    else if (req.url?.includes('/responses'))
      send(res, [
        {
          type: 'response.output_item.done',
          item: {
            id: 'rs_1',
            type: 'reasoning',
            encrypted_content: 'opaque-reasoning',
            summary: [],
          },
        },
        { type: 'response.output_text.delta', delta: 'hello' },
      ]);
    else
      send(res, [
        {
          candidates: [
            { content: { parts: [{ text: 'hello', thoughtSignature: 'gemini-signature' }] } },
          ],
        },
      ]);
  });
  for (const protocol of ['anthropic', 'responses', 'gemini'] as const) {
    const p = {
      id: 'p',
      name: 'test',
      kind: 'chat' as const,
      baseUrl: base,
      models: [],
      protocol,
      apiKey: 'test',
    };
    const first = await complete(
      p,
      'test',
      [{ role: 'user', content: 'hi' }],
      [],
      'auto',
      AbortSignal.timeout(5000),
      () => {},
    );
    assert.ok(first.native);
    await complete(
      p,
      'test',
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: first.content, native: first.native },
        { role: 'user', content: 'continue' },
      ],
      [],
      'auto',
      AbortSignal.timeout(5000),
      () => {},
    );
  }
  assert.equal(requests[1].body.messages[1].content[0].signature, 'signed-thinking');
  assert.equal(requests[3].body.input[1].encrypted_content, 'opaque-reasoning');
  assert.equal(requests[5].body.contents[1].parts[0].thoughtSignature, 'gemini-signature');
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for run state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('tool approval allows or declines writes, and stopping an approval releases the run', async (t) => {
  const base = await mock(t, (_req, res, body) => {
    if (body.messages.some((m: any) => m.role === 'tool'))
      send(res, [{ choices: [{ delta: { content: 'done' } }] }]);
    else
      send(res, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'remember-call',
                    function: { name: 'remember', arguments: '{"content":"likes jazz"}' },
                  },
                ],
              },
            },
          ],
        },
      ]);
  });
  const { app, cookie, settings, store } = await fixture(t);
  settings.providers = [
    { id: 'p', name: 'mock', protocol: 'openai', kind: 'chat', models: ['test'], baseUrl: base },
  ];
  await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  const workspace = store.session(cookie.split('=')[1])!;
  for (const allow of [true, false, 'stop'] as const) {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        headers: { ...headers, cookie },
        payload: { personaId: 'lumi' },
      })
    ).json();
    const pending = Promise.resolve(
      app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...headers, cookie },
        payload: { conversationId: c.id, providerId: 'p', model: 'test', content: 'remember' },
      }),
    );
    await until(() =>
      [...runs.values()].some((r) => r.workspace === workspace && r.approvals.size > 0),
    );
    const run = [...runs.values()].find((r) => r.workspace === workspace)!;
    const id = [...run.approvals.keys()][0];
    const other = (await app.inject('/api/bootstrap')).headers['set-cookie']!.toString().split(
      ';',
    )[0];
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/runs/${run.id}/approvals/${id}`,
          headers: { ...headers, cookie: other },
          payload: { allow: true },
        })
      ).statusCode,
      404,
    );
    if (allow === 'stop')
      await app.inject({
        method: 'POST',
        url: `/api/runs/${run.id}/stop`,
        headers: { ...headers, cookie },
        payload: {},
      });
    else
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: `/api/runs/${run.id}/approvals/${id}`,
            headers: { ...headers, cookie },
            payload: { allow },
          })
        ).statusCode,
        200,
      );
    const response = await pending;
    assert.equal(response.statusCode, 200);
    assert.equal(runs.size, 0);
    const saved = (
      await app.inject({ url: '/api/conversations/' + c.id, headers: { cookie } })
    ).json();
    if (allow === 'stop') assert.equal(saved.messages[1].interrupted, true);
    else assert.equal(saved.messages[1].content, 'done');
  }
  assert.equal(store.memories(workspace).length, 1);
});

test('disconnect cancels upstream generation and preserves the partial reply', async (t) => {
  let upstreamClosed = false;
  const base = await mock(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial reply' } }] }) + '\n\n',
    );
    res.on('close', () => {
      upstreamClosed = true;
    });
  });
  const { app, cookie, settings, store } = await fixture(t);
  settings.providers = [
    { id: 'p', name: 'mock', protocol: 'openai', kind: 'chat', models: ['test'], baseUrl: base },
  ];
  await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: settings,
  });
  const c = (
    await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { ...headers, cookie },
      payload: { personaId: 'atlas' },
    })
  ).json();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const controller = new AbortController();
  const response = await fetch(address + '/api/runs', {
    method: 'POST',
    headers: { ...headers, cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: c.id,
      providerId: 'p',
      model: 'test',
      content: 'hello',
    }),
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  let text = '';
  while (!text.includes('partial reply'))
    text += new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  await reader.cancel().catch(() => {});
  await until(() => runs.size === 0 && upstreamClosed);
  const saved = store.get<any>(store.session(cookie.split('=')[1])!, 'conversation', c.id);
  assert.equal(saved.messages[1].content, 'partial reply');
  assert.equal(saved.messages[1].interrupted, true);
});

test('backup imports validate all records before writing and regenerate untrusted slide HTML', async (t) => {
  const { app, cookie, settings } = await fixture(t);
  const backup = {
    version: 1,
    settings: { ...settings, responseLanguage: 'changed' },
    conversations: [
      { id: randomUUID(), title: 'Imported', personaId: 'lumi', updated: Date.now(), messages: [] },
    ],
    artifacts: [
      {
        id: randomUUID(),
        kind: 'image',
        title: 'malicious',
        created: Date.now(),
        data: { images: ['data:image/svg+xml;base64,PHN2Zz4='] },
      },
    ],
    memories: [],
  };
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { ...headers, cookie },
    payload: backup,
  });
  assert.equal(invalid.statusCode, 400);
  const unchanged = (await app.inject({ url: '/api/bootstrap', headers: { cookie } })).json();
  assert.equal(unchanged.conversations.length, 0);
  assert.equal(unchanged.settings.responseLanguage, 'auto');
  backup.artifacts = [
    {
      id: randomUUID(),
      kind: 'slides',
      title: 'safe',
      created: Date.now(),
      data: { markdown: '# Safe', html: '<script>evil()</script>' },
    },
  ] as any;
  const valid = await app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { ...headers, cookie },
    payload: backup,
  });
  assert.equal(valid.statusCode, 200, valid.body);
  const artifact = (
    await app.inject({ url: '/api/artifacts/' + backup.artifacts[0].id, headers: { cookie } })
  ).json();
  assert.ok(artifact.data.html.includes('Safe'));
  assert.ok(!artifact.data.html.includes('evil()'));
});

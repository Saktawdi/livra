import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { settingsSchema, liveSchema, defaultSettings } from '@livra/shared';
import { searchWeb } from '../apps/server/src/search.ts';

process.env.ALLOW_PRIVATE_ENDPOINTS = 'true';
test('AnySearch sends the official anonymous/keyed REST contract and normalizes nested results', async (t) => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requests.push({
      url: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        code: 0,
        data: {
          results: [
            { title: 'Official', url: 'https://example.com', snippet: 'summary' },
            { title: 'unsafe', url: 'javascript:alert(1)' },
          ],
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const settings = settingsSchema.parse({
    personas: defaultSettings.personas,
    searchEngine: 'anysearch',
    searchUrl: `http://127.0.0.1:${(server.address() as any).port}/v1/search`,
  });
  assert.deepEqual(await searchWeb(settings, '星空', new AbortController().signal), [
    { title: 'Official', url: 'https://example.com', content: 'summary' },
  ]);
  await searchWeb({ ...settings, searchKey: 'test-key' }, 'code', new AbortController().signal);
  assert.deepEqual(requests[0], {
    url: '/v1/search',
    method: 'POST',
    authorization: undefined,
    body: { query: '星空', max_results: 6, language: 'zh-CN', format: 'json' },
  });
  assert.equal(requests[1].authorization, 'Bearer test-key');
});

test('AnySearch quota credentials and upstream business errors never leak into tool errors', async (t) => {
  let quota = true;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = quota ? 402 : 200;
    res.end(
      JSON.stringify({
        code: -1,
        message: 'username=private-user\npassword=secret-password\napi_key=secret-key',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const settings = settingsSchema.parse({
    personas: defaultSettings.personas,
    searchEngine: 'anysearch',
    searchUrl: `http://127.0.0.1:${(server.address() as any).port}/v1/search`,
  });
  await assert.rejects(searchWeb(settings, 'query', new AbortController().signal), (error) => {
    assert.match(String(error), /HTTP 402/);
    assert.doesNotMatch(String(error), /secret|private-user/);
    return true;
  });
  quota = false;
  await assert.rejects(searchWeb(settings, 'query', new AbortController().signal), /返回无效结果/);
});

test('older settings and Live2D models get safe defaults; invalid skin backgrounds are rejected', () => {
  assert.equal(liveSchema.parse({}).offsetX, 0);
  assert.equal(
    settingsSchema.parse({ personas: defaultSettings.personas }).appearance.skin,
    'orbit',
  );
  assert.equal(
    settingsSchema.parse({ personas: defaultSettings.personas, searchEngine: 'searxng' })
      .searchEngine,
    'searxng',
  );
  assert.equal(
    settingsSchema.safeParse({
      personas: defaultSettings.personas,
      appearance: { backgroundImage: 'javascript:alert(1)' },
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      personas: defaultSettings.personas,
      appearance: { backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    }).success,
    false,
  );
});

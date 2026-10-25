import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, settingsSchema, publicSettings, type Settings } from '@livra/shared';
import { searchWeb } from '../packages/runtime/src/search.ts';
import { configureTransport, browserNetwork } from '../packages/runtime/src/network.ts';
import { BrowserStore } from '../apps/web/src/local/store.ts';
import { createLocalCommands, workspace } from '../apps/web/src/local/commands.ts';
import { createApp } from '../apps/server/src/app.ts';

const results = [{ title: 'Result', url: 'https://example.com/result', content: 'Summary' }];
const response = (engine: Settings['searchEngine']) =>
  Response.json(engine === 'anysearch' ? { code: 0, data: { results } } : { results });
const config = (engine: Settings['searchEngine'], path: string): Settings => ({
  ...structuredClone(defaultSettings),
  searchEngine: engine,
  searchUrl: 'https://rotation.example/' + path,
  searchKeys: ['key-a', 'key-b'],
});

test('Lumen search rotation deduplicates keys and advances the starting key for all search engines', async (t) => {
  t.after(() => configureTransport(browserNetwork));
  for (const engine of ['anysearch', 'tavily', 'searxng'] as const) {
    const observed: string[] = [];
    configureTransport(async (url, init) => {
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      observed.push(
        engine === 'tavily' ? body.api_key : headers.get('authorization')!.replace('Bearer ', ''),
      );
      if (engine === 'searxng') {
        assert.equal(new URL(url).searchParams.get('format'), 'json');
        assert.equal(new URL(url).pathname, '/rotate-searxng/search');
      }
      return response(engine);
    });
    const settings = {
      ...config(engine, 'rotate-' + engine),
      searchKeys: ['key-a', ' key-b ', 'key-a', ''],
    };
    await Promise.all(
      [0, 1, 2].map((i) => searchWeb(settings, 'query-' + i, new AbortController().signal)),
    );
    assert.deepEqual(observed, ['key-a', 'key-b', 'key-a']);
  }
});

test('authentication, quota, rate limit and transient server failures try each remaining key once', async (t) => {
  t.after(() => configureTransport(browserNetwork));
  for (const status of [401, 402, 403, 408, 429, 500, 502, 503, 504]) {
    const keys: string[] = [];
    configureTransport(async (_url, init) => {
      const key = new Headers(init?.headers).get('authorization')!;
      keys.push(key);
      return key === 'Bearer key-a'
        ? new Response('private upstream credentials', { status })
        : response('anysearch');
    });
    const settings = config('anysearch', 'failure-' + status);
    assert.deepEqual(await searchWeb(settings, 'query', new AbortController().signal), results);
    assert.deepEqual(await searchWeb(settings, 'query', new AbortController().signal), results);
    assert.deepEqual(await searchWeb(settings, 'query', new AbortController().signal), results);
    assert.deepEqual(keys, [
      'Bearer key-a',
      'Bearer key-b',
      'Bearer key-b',
      'Bearer key-a',
      'Bearer key-b',
    ]);
  }
  let attempts = 0;
  configureTransport(async () =>
    ++attempts === 1
      ? Response.json({ code: 42901, message: 'quota credentials' })
      : response('anysearch'),
  );
  await searchWeb(config('anysearch', 'business-quota'), 'query', new AbortController().signal);
  assert.equal(attempts, 2);
});

test('exhausted pools stop, ordinary client failures do not retry, cancellation stops and every key is redacted', async (t) => {
  t.after(() => configureTransport(browserNetwork));
  const settings = config('tavily', 'errors');
  let calls = 0;
  configureTransport(async () => {
    calls++;
    return Response.json({ error: { message: 'failed key-a and key-b' } }, { status: 503 });
  });
  await assert.rejects(searchWeb(settings, 'query', new AbortController().signal), (error) => {
    assert.doesNotMatch(String(error), /key-a|key-b/);
    assert.match(String(error), /503/);
    return true;
  });
  assert.equal(calls, 2);
  calls = 0;
  configureTransport(async () => {
    calls++;
    return Response.json({ message: 'invalid request key-a key-b' }, { status: 400 });
  });
  await assert.rejects(searchWeb(settings, 'query', new AbortController().signal), /400/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  calls = 0;
  configureTransport(async () => {
    calls++;
    controller.abort();
    return Response.json({}, { status: 429 });
  });
  await assert.rejects(searchWeb(settings, 'query', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('search pools migrate legacy keys, preserve private saves, test unsaved drafts, clear explicitly and stay out of backups', async (t) => {
  const store = await BrowserStore.open(new IDBFactory(), 'search-keys');
  t.after(async () => {
    await store.flush();
    store.close();
    configureTransport(browserNetwork);
  });
  const { app } = createLocalCommands(store);
  const put = (settings: unknown) =>
    app.execute('/settings', { method: 'PUT', body: JSON.stringify(settings) });
  let saved = await put({ ...defaultSettings, searchKey: 'legacy-search' });
  assert.deepEqual(await app.execute('/search/keys'), { keys: ['legacy-search'] });
  assert.equal(saved.searchKeyCount, 1);
  saved = await put({ ...saved, searchKeys: ['saved-a', 'saved-b'] });
  assert.equal(saved.searchKeys, undefined);
  assert.equal(saved.searchKey, undefined);
  assert.equal(saved.searchKeyCount, 2);
  await put(saved);
  assert.deepEqual(store.settings(workspace).searchKeys, ['saved-a', 'saved-b']);
  const observed: string[] = [];
  configureTransport(async (_url, init) => {
    const key = new Headers(init?.headers).get('authorization') || '';
    observed.push(key);
    return key.endsWith('-a') ? Response.json({}, { status: 401 }) : response('anysearch');
  });
  await app.execute('/search/test', {
    method: 'POST',
    body: JSON.stringify({
      query: 'draft',
      config: {
        searchEngine: 'anysearch',
        searchUrl: 'https://rotation.example/draft',
        searchKeys: ['draft-a', 'draft-b'],
      },
    }),
  });
  assert.deepEqual(observed, ['Bearer draft-a', 'Bearer draft-b']);
  assert.deepEqual(store.settings(workspace).searchKeys, ['saved-a', 'saved-b']);
  const toolResult = await app.execute('/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ name: 'web_search', args: { query: 'saved tool' } }),
  });
  assert.deepEqual(toolResult, results);
  assert.deepEqual(observed.slice(-2), ['Bearer saved-a', 'Bearer saved-b']);
  const exported = await app.execute('/export');
  assert.doesNotMatch(JSON.stringify(exported), /saved-a|saved-b|legacy-search|draft-a|draft-b/);
  await put({ ...saved, searchKeys: [] });
  assert.equal(store.settings(workspace).searchKey, '');
  assert.equal(publicSettings(store.settings(workspace)).hasSearchKey, false);
  await app.execute('/search/test', {
    method: 'POST',
    body: JSON.stringify({
      query: 'anonymous',
      config: { searchEngine: 'anysearch', searchUrl: 'https://rotation.example/anonymous' },
    }),
  });
  assert.equal(observed.at(-1), '');
  // Legacy clients replacing one key must not silently retain an old pool.
  await put({ ...saved, searchKey: 'replacement-key' });
  assert.equal(store.settings(workspace).searchKeys, undefined);
  assert.equal(store.settings(workspace).searchKey, 'replacement-key');
  const imported = structuredClone(exported);
  imported.settings.searchKeys = ['untrusted-a'];
  imported.settings.searchKey = 'untrusted-legacy';
  await app.execute('/import', { method: 'POST', body: JSON.stringify(imported) });
  assert.equal(store.settings(workspace).searchKeys, undefined);
  assert.equal(store.settings(workspace).searchKey, undefined);
  assert.equal(settingsSchema.parse({ ...defaultSettings }).searchKeys, undefined);
});

test('legacy API keeps search pools private and testing uses draft keys without overwriting saved credentials', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'livra-search-rotation-'));
  const { app, store } = await createApp({ directory, staticRoot: join(directory, 'none') });
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    configureTransport(browserNetwork);
  });
  const boot = await app.inject('/api/bootstrap');
  const cookie = boot.headers['set-cookie']!.toString().split(';')[0];
  const headers = { cookie, 'x-livra-client': 'web' };
  const workspace = store.session(cookie.split('=')[1])!;
  const put = (payload: Settings) =>
    app.inject({ method: 'PUT', url: '/api/settings', headers, payload });
  const saved = await put({ ...defaultSettings, searchKeys: ['server-a', 'server-b'] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.doesNotMatch(saved.body, /server-a|server-b/);
  await put(saved.json());
  assert.deepEqual(store.settings(workspace).searchKeys, ['server-a', 'server-b']);
  const observed: string[] = [];
  configureTransport(async (_url, init) => {
    const key = new Headers(init?.headers).get('authorization')!;
    observed.push(key);
    return key.endsWith('-a') ? Response.json({}, { status: 429 }) : response('anysearch');
  });
  const tested = await app.inject({
    method: 'POST',
    url: '/api/search/test',
    headers,
    payload: {
      query: 'draft',
      config: {
        searchEngine: 'anysearch',
        searchUrl: 'https://rotation.example/legacy',
        searchKeys: ['server-draft-a', 'server-draft-b'],
      },
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  assert.deepEqual(observed, ['Bearer server-draft-a', 'Bearer server-draft-b']);
  assert.deepEqual(store.settings(workspace).searchKeys, ['server-a', 'server-b']);
  const exported = await app.inject({ url: '/api/export', headers });
  assert.doesNotMatch(exported.body, /server-a|server-b|server-draft/);
  // The browser's credential editor route is never exposed through HTTP.
  assert.equal((await app.inject({ url: '/api/search/keys', headers })).statusCode, 404);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSettings,
  builtInLiveModels,
  liveModelSourceSchema,
  type Settings,
} from '@livra/shared';
import { LiveModelService } from '../apps/server/src/live-models.ts';
import { Store } from '../apps/server/src/store.ts';
import { createApp } from '../apps/server/src/app.ts';
import type { network } from '../apps/server/src/network.ts';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const staticSource = liveModelSourceSchema.parse({
  id: 'classic',
  name: '经典来源',
  kind: 'static',
  url: 'https://models.example/catalog/model_list.json',
  license: '非商业用途',
});
const githubSource = liveModelSourceSchema.parse({
  id: 'github',
  name: 'GitHub 来源',
  kind: 'github',
  url: 'https://github.com/example/models/tree/abc123/models',
  assetBaseUrl: 'https://cdn.example/characters/',
});
const settings = (...sources: Settings['liveModelSources']) => ({
  ...structuredClone(defaultSettings),
  liveModelSources: sources,
});
function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'livra-models-'));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory };
}

test('remote adapters discover groups and GitHub subdirectories, encode assets, and hydrate actual motion groups', async (t) => {
  const { store } = fixture(t);
  const requests: string[] = [];
  const request: typeof network = async (url) => {
    requests.push(url);
    if (url.includes('model_list.json'))
      return json({
        models: [
          'Group/Pio',
          ['Group/Tia', 'Group/Pio'],
          '../invalid',
          'https://bad.example/a',
          'bad\\path',
        ],
      });
    if (url.includes('api.github.com'))
      return json({
        tree: [
          { type: 'blob', path: '千狐 Senko/senko.model3.json' },
          { type: 'blob', path: '../outside/hidden.model3.json' },
          { type: 'blob', path: 'old/index.json' },
          { type: 'blob', path: 'old/model.moc' },
          { type: 'blob', path: 'unrelated/index.json' },
          { type: 'blob', path: '../escaped.model3.json' },
        ],
      });
    if (url.endsWith('senko.model3.json'))
      return json({
        Version: 3,
        FileReferences: {
          Moc: 'model.moc3',
          Textures: ['texture.png'],
          Motions: { Idle: [{}], Tap: [{}] },
        },
      });
    if (url.endsWith('/model.moc3'))
      return new Response(new Uint8Array([77, 79, 67, 51, 2, 0, 0, 0]));
    if (url.endsWith('/index.json'))
      return json({
        model: 'model.moc',
        textures: ['texture.png'],
        motions: { idle: [{}], tap_body: [{}] },
      });
    if (url.endsWith('/model.moc'))
      return new Response(new Uint8Array([109, 111, 99, 8, 0, 0, 0, 0]));
    throw Error('unexpected URL: ' + url);
  };
  const service = new LiveModelService(store, request);
  const s = settings(staticSource, githubSource);
  const staticResult = await service.source(s, 'workspace', staticSource.id);
  assert.equal(staticResult.status, 'ready');
  assert.deepEqual(
    staticResult.models.map((m) => m.name),
    ['Pio', 'Tia'],
  );
  const gitResult = await service.source(s, 'workspace', githubSource.id);
  assert.equal(gitResult.models.length, 2);
  const senko = gitResult.models.find((m) => m.name === '千狐 Senko')!;
  assert.equal(
    senko.live.modelUrl,
    'https://cdn.example/characters/%E5%8D%83%E7%8B%90%20Senko/senko.model3.json',
  );
  assert.ok(senko.id.length <= 80);
  const resolved = await service.resolve(s, 'workspace', senko.id);
  assert.equal(resolved.live.idleMotion, 'Idle');
  assert.equal(resolved.live.tapMotion, 'Tap');
  const old = await service.resolve(s, 'workspace', staticResult.models[0].id);
  assert.equal(old.live.idleMotion, 'idle');
  assert.equal(old.live.tapMotion, 'tap_body');
  assert.equal(old.license, '非商业用途');
  await service.source(s, 'workspace', staticSource.id);
  assert.equal(requests.filter((url) => url.includes('model_list.json')).length, 1);
});

test('directory refresh retains stale data, deduplicates requests, and isolates workspace and source configuration', async (t) => {
  const { store } = fixture(t);
  let calls = 0,
    failing = false;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const service = new LiveModelService(store, async () => {
    calls++;
    if (failing) throw Error('来源暂时不可用');
    return json({ models: ['Collection/Pio'] });
  });
  const s = settings(staticSource);
  const [first, simultaneous] = await Promise.all([
    service.source(s, 'one', 'classic'),
    service.source(s, 'one', 'classic'),
  ]);
  assert.deepEqual(first, simultaneous);
  assert.equal(calls, 1);
  const reloaded = new LiveModelService(store, async () => {
    throw Error('should use persisted cache');
  });
  assert.equal((await reloaded.source(s, 'one', 'classic')).status, 'ready');
  failing = true;
  now += 2000;
  const stale = await service.source(s, 'one', 'classic', true);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.models.length, 1);
  assert.match(stale.error!, /暂时不可用/);
  assert.equal((await service.source(s, 'two', 'classic')).models.length, 0);
  const changed = settings({ ...staticSource, url: 'https://other.example/model_list.json' });
  assert.equal((await service.source(changed, 'one', 'classic')).models.length, 0);
  const disabled = settings({ ...staticSource, enabled: false });
  assert.equal((await service.source(disabled, 'one', 'classic')).status, 'disabled');
  await assert.rejects(service.resolve(disabled, 'one', first.models[0].id), /来源已关闭/);
});

test('selection rejects newer MOC versions, malformed manifests and unavailable binaries', async (t) => {
  const { store } = fixture(t);
  let state = 'new';
  const service = new LiveModelService(store, async (url) => {
    if (url.endsWith('model_list.json')) return json({ models: ['New/Model'] });
    if (url.endsWith('index.json'))
      return json(
        state === 'invalid'
          ? {}
          : { FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] } },
      );
    return state === 'missing'
      ? json({}, 404)
      : new Response(new Uint8Array([77, 79, 67, 51, 5, 0, 0, 0]));
  });
  const s = settings(staticSource);
  const { models } = await service.source(s, 'workspace', 'classic');
  await assert.rejects(service.resolve(s, 'workspace', models[0].id), /需要 Cubism 5/);
  state = 'invalid';
  await assert.rejects(service.resolve(s, 'workspace', models[0].id), /缺少模型文件或纹理/);
  state = 'missing';
  await assert.rejects(service.resolve(s, 'workspace', models[0].id), /HTTP 404/);
});

test('UI and Agent share the enabled catalog and chosen artifacts retain provenance', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'livra-model-api-'));
  const { app, store } = await createApp({
    directory,
    staticRoot: join(directory, 'no-static'),
    liveModelFetch: async (url) => {
      if (url.endsWith('model_list.json'))
        return json({ models: Array.from({ length: 26 }, (_, i) => 'Group/Character-' + i) });
      if (url.endsWith('index.json'))
        return json({
          model: 'model.moc',
          textures: ['a.png'],
          motions: { idle: [{}], flick_head: [{}] },
        });
      return new Response(new Uint8Array([109, 111, 99, 8, 0, 0, 0, 0]));
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const bootstrap = await app.inject('/api/bootstrap');
  const cookie = bootstrap.headers['set-cookie']!.toString().split(';')[0];
  const workspace = store.session(cookie.split('=')[1])!;
  store.saveSettings(workspace, settings(staticSource));
  const headers = { cookie, 'x-livra-client': 'web' };
  const execute = (name: string, args: unknown) =>
    app.inject({ method: 'POST', url: '/api/tools/execute', headers, payload: { name, args } });
  const catalog = (await app.inject({ url: '/api/live-models/catalog', headers })).json();
  assert.equal(catalog.models.length, 26 + builtInLiveModels.length);
  const page = (await execute('list_live2d_models', { query: '经典来源', limit: 20 })).json();
  assert.equal(page.total, 26);
  assert.equal(page.models.length, 20);
  assert.equal(page.nextOffset, 20);
  assert.equal(page.models[0].license, '非商业用途');
  assert.equal(page.sources[0].status, 'ready');
  const remote = page.models[0];
  const hydrated = await app.inject({
    method: 'POST',
    url: '/api/live-models/resolve',
    headers,
    payload: { id: remote.id },
  });
  assert.equal(hydrated.statusCode, 200);
  const result = await execute('create_persona', {
    name: '远端伙伴',
    description: '研究伙伴',
    systemPrompt: '帮助研究',
    mode: 'work',
    liveModelId: remote.id,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().persona.live, hydrated.json().live);
  const artifact = store.artifacts(workspace)[0];
  assert.equal(artifact.data.liveModel.sourceId, 'classic');
  assert.equal(artifact.data.liveModel.license, '非商业用途');
  const missing = await app.inject({ url: '/api/live-models/sources/unknown', headers });
  assert.equal(missing.statusCode, 404);
  const anonymous = await app.inject('/api/live-models/catalog');
  assert.equal(anonymous.statusCode, 401);
});

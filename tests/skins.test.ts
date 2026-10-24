import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.ts';
import { executeTool, functionTools, type Context } from '../apps/server/src/tools.ts';
import {
  skinCreationSchema,
  skinPackageSchema,
  skinSettings,
  skinVariables,
  type Artifact,
} from '@livra/shared';

const design = {
  name: 'NEBULA · 静谧星海',
  description: '薄雾玻璃、留白与缓慢的星光。',
  prompt: '设计一套轻盈深空风格，有玻璃输入框和慢速星光。',
  theme: 'dark',
  appearance: {
    skin: 'orbit',
    bubble: 'plain',
    design: {
      palette: {
        background: '#080e19',
        surface: '#121e30',
        raised: '#1c2a40',
        text: '#e4eef9',
        muted: '#a2b4c9',
        accent: '#9de5d8',
        line: '#9bb7ce',
      },
      typography: 'sans',
      navigation: 'island',
      composer: 'glass',
      surfaceRadius: 14,
      surfaceOpacity: 0.7,
      contentWidth: 860,
      motion: { effect: 'stars', color: '#90cbe8', density: 54, speed: 0.4 },
    },
  },
};
const headers = { 'x-livra-client': 'web' };
async function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'livra-skins-'));
  const { app, store } = await createApp({ directory });
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const boot = await app.inject('/api/bootstrap');
  const cookie = boot.headers['set-cookie']!.toString().split(';')[0];
  const workspace = store.session(cookie.split('=')[1])!;
  const settings = store.settings(workspace);
  return { app, store, cookie, workspace, settings };
}

test('skin packages preserve geometry and motion, migrate v1, and reject unsafe or unreadable design tokens', () => {
  const input = skinCreationSchema.parse(design);
  const skin = skinPackageSchema.parse({ ...input, version: 2 });
  assert.equal(skin.appearance.design?.composer, 'glass');
  assert.equal(skin.appearance.design?.motion.speed, 0.4);
  const legacy = skinPackageSchema.parse({
    version: 1,
    appearance: { skin: 'paper' },
    theme: 'light',
    accent: 'sage',
  });
  assert.equal(legacy.appearance.design, undefined);
  assert.equal(skinSettings(skin).activeSkinName, skin.name);
  assert.equal(skinVariables(skin.appearance.design)['--surface'], '#121e30');
  assert.equal(skinVariables(skin.appearance.design)['--skin-on-accent'], '#10141c');
  assert.deepEqual(skinVariables(undefined), {});
  for (const patch of [
    { palette: { ...input.appearance.design.palette, text: '#121e30' } },
    { palette: { ...input.appearance.design.palette, accent: 'url(https://example.com)' } },
    { motion: { ...input.appearance.design.motion, density: 100000 } },
    { css: 'body{display:none}' },
  ]) {
    assert.equal(
      skinCreationSchema.safeParse({
        ...input,
        appearance: { ...input.appearance, design: { ...input.appearance.design, ...patch } },
      }).success,
      false,
    );
  }
  assert.equal(skinCreationSchema.safeParse({ ...input, javascript: 'alert(1)' }).success, false);
});

test('Agents discover skin tools, generate reusable artifacts, and leave active preferences unchanged', async (t) => {
  const { store, workspace, settings } = await fixture(t);
  const events: any[] = [];
  const ctx: Context = {
    store,
    workspace,
    settings,
    persona: settings.personas.find((p) => p.id === 'atlas')!,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    liveModels: {} as any,
  };
  const tools = functionTools(ctx);
  assert.ok(tools.some((t) => t.function.name === 'create_skin'));
  assert.ok(tools.some((t) => t.function.name === 'list_skins'));
  const result = await executeTool('create_skin', design, ctx);
  const item = store.get<Artifact>(workspace, 'artifact', result.artifactId)!;
  assert.equal(item.kind, 'skin');
  assert.equal(item.data.skin.name, design.name);
  assert.equal(events[0].type, 'artifact');
  assert.equal(events[0].artifact.kind, 'skin');
  assert.deepEqual(store.settings(workspace).appearance, settings.appearance);
  const found = await executeTool('list_skins', { query: '星海' }, ctx);
  assert.equal(found.total, 1);
  assert.equal(found.skins[0].id, item.id);
  const loaded = await executeTool('list_skins', { id: item.id }, ctx);
  assert.deepEqual(loaded.skin.appearance, item.data.skin.appearance);
  ctx.persona = { ...ctx.persona, tools: ['list_tools'] };
  assert.ok(!functionTools(ctx).some((t) => t.function.name === 'create_skin'));
  await assert.rejects(executeTool('create_skin', design, ctx), /未对当前人偶开放/);
});

test('skin API supports workspace isolation, revisions, applying and backup restoration', async (t) => {
  const { app, cookie, settings } = await fixture(t);
  const call = (name: string, args: unknown, session = cookie) =>
    app.inject({
      method: 'POST',
      url: '/api/tools/execute',
      headers: { ...headers, cookie: session },
      payload: { name, args },
    });
  const created = await call('create_skin', design);
  assert.equal(created.statusCode, 200, created.body);
  const item = (
    await app.inject({ url: '/api/artifacts/' + created.json().artifactId, headers: { cookie } })
  ).json();
  assert.equal(item.kind, 'skin');
  const next = await call('create_skin', {
    ...design,
    name: 'NEBULA · 网格版',
    appearance: {
      ...design.appearance,
      design: {
        ...design.appearance.design,
        typography: 'mono',
        composer: 'underline',
        motion: { effect: 'grid' },
      },
    },
  });
  assert.equal(next.statusCode, 200, next.body);
  assert.notEqual(next.json().artifactId, item.id);
  const otherCookie = (await app.inject('/api/bootstrap')).headers['set-cookie']!.toString().split(
    ';',
  )[0];
  assert.notEqual((await call('list_skins', { id: item.id }, otherCookie)).statusCode, 200);
  assert.equal((await call('list_skins', {}, otherCookie)).json().total, 0);
  const apply = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { ...headers, cookie },
    payload: { ...settings, ...skinSettings(item.data.skin) },
  });
  assert.equal(apply.statusCode, 200, apply.body);
  assert.equal(apply.json().activeSkinName, design.name);
  const backup = (await app.inject({ url: '/api/export', headers: { cookie } })).json();
  const restored = await app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { ...headers, cookie: otherCookie },
    payload: backup,
  });
  assert.equal(restored.statusCode, 200, restored.body);
  const saved = (
    await app.inject({ url: '/api/artifacts/' + item.id, headers: { cookie: otherCookie } })
  ).json();
  assert.deepEqual(saved.data.skin.appearance.design, item.data.skin.appearance.design);
});

test('existing design personas gain skin generation once, and later opt-outs stay disabled', async (t) => {
  const { store, workspace, settings } = await fixture(t);
  const old: any = structuredClone(settings);
  delete old.skinToolsVersion;
  old.personas.forEach(
    (p: any) => (p.tools = p.tools.filter((name: string) => name !== 'create_skin')),
  );
  store.saveSettings(workspace, old);
  const migrated = store.settings(workspace);
  assert.ok(migrated.personas.find((p) => p.id === 'atlas')!.tools.includes('create_skin'));
  assert.ok(!migrated.personas.find((p) => p.id === 'lumi')!.tools.includes('create_skin'));
  migrated.personas.forEach((p) => (p.tools = p.tools.filter((name) => name !== 'create_skin')));
  store.saveSettings(workspace, migrated);
  assert.ok(
    !store
      .settings(workspace)
      .personas.find((p) => p.id === 'atlas')!
      .tools.includes('create_skin'),
  );
});

test('natural language Agent run calls create_skin and streams a persisted skin artifact', async (t) => {
  process.env.ALLOW_PRIVATE_ENDPOINTS = 'true';
  let rounds = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.ok(body.tools.some((tool: any) => tool.function.name === 'create_skin'));
    rounds++;
    const delta =
      rounds === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'skin-call',
                type: 'function',
                function: { name: 'create_skin', arguments: JSON.stringify(design) },
              },
            ],
          }
        : { content: '皮肤已生成，打开作品即可预览与应用。' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const { app, store, workspace, cookie, settings } = await fixture(t);
  settings.providers.push({
    id: 'mock',
    name: 'mock',
    kind: 'chat',
    protocol: 'openai',
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    models: ['designer'],
  });
  store.saveSettings(workspace, settings);
  const conversationId = randomUUID();
  store.put(workspace, 'conversation', {
    id: conversationId,
    title: '设计皮肤',
    personaId: 'atlas',
    messages: [],
    updated: Date.now(),
  });
  const result = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: { ...headers, cookie },
    payload: { conversationId, providerId: 'mock', model: 'designer', content: design.prompt },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.match(result.body, /"kind":"skin"/);
  assert.match(result.body, /皮肤已生成/);
  assert.equal(rounds, 2);
  const skin = store.artifacts(workspace).find((a) => a.kind === 'skin')!;
  assert.equal(skin.data.skin.appearance.design.composer, 'glass');
  assert.equal(store.settings(workspace).appearance.design, undefined);
});

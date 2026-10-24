import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.ts';
import {
  organizeConversations,
  type Conversation,
  type ConversationOrganization,
} from '@livra/shared';

process.env.ALLOW_PRIVATE_ENDPOINTS = 'true';
async function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'livra-conversations-'));
  const { app, store } = await createApp({ directory, staticRoot: join(directory, 'none') });
  const boot = await app.inject('/api/bootstrap');
  const cookie = boot.headers['set-cookie']!.toString().split(';')[0];
  const headers = { cookie, 'x-livra-client': 'web' };
  const workspace = store.session(cookie.split('=')[1])!;
  const settings = store.settings(workspace);
  settings.liveModelSources = [];
  store.saveSettings(workspace, settings);
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = (method: any, url: string, payload?: any) =>
    app.inject({ method, url: '/api/' + url, headers, payload });
  const create = async (title: string, groupId?: string) => {
    const r = await call('POST', 'conversations', { personaId: settings.personas[0].id, groupId });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json<Conversation>();
    await call('PATCH', 'conversations/' + c.id, { title });
    return c.id;
  };
  const action = async (payload: any) => {
    const r = await call('PATCH', 'conversation-organization', payload);
    assert.equal(r.statusCode, 200, r.body);
    return r.json<ConversationOrganization>();
  };
  const group = async (name: string) =>
    (await action({ type: 'create-group', name, color: '#67e8f9' })).groups.at(-1)!.id;
  const bootData = async () => (await call('GET', 'bootstrap')).json();
  return { app, store, headers, workspace, settings, call, create, action, group, bootData };
}

test('conversation groups persist, accept group drafts, reorder, and remove without deleting chats', async (t) => {
  const f = await fixture(t);
  const a = await f.group('研究'),
    b = await f.group('设计');
  const c = await f.create('研究宇宙', a);
  assert.equal((await f.call('GET', 'conversations/' + c)).json().groupId, a);
  await f.action({ type: 'reorder-group', id: b, beforeId: a });
  await f.action({
    type: 'update-group',
    id: a,
    patch: { name: '星海研究', color: '#b4a3f7', collapsed: true },
  });
  let data = await f.bootData();
  assert.deepEqual(
    data.conversationOrganization.groups.map((g: any) => g.id),
    [b, a],
  );
  assert.deepEqual(data.conversationOrganization.groups[1], {
    id: a,
    name: '星海研究',
    color: '#b4a3f7',
    collapsed: true,
  });
  // Re-open the persisted encrypted record, rather than relying on a client snapshot.
  assert.equal(f.store.organization(f.workspace).groups[1].collapsed, true);
  await f.action({ type: 'collapse-all', collapsed: false });
  await f.action({ type: 'delete-group', id: a });
  data = await f.bootData();
  assert.equal(data.conversations.find((x: any) => x.id === c).groupId, null);
  assert.equal((await f.call('GET', 'conversations/' + c)).statusCode, 200);
  assert.equal(
    (await f.call('POST', 'conversations', { personaId: f.settings.personas[0].id, groupId: a }))
      .statusCode,
    400,
  );
});

test('drag operations preserve explicit order across activity, support cross-group pin zones, and reject foreign targets', async (t) => {
  const f = await fixture(t);
  const a = await f.group('工作'),
    b = await f.group('灵感');
  const one = await f.create('一', a),
    two = await f.create('二', a),
    three = await f.create('三', b);
  await f.call('PATCH', 'conversations/' + three, { pinned: true });
  await f.action({ type: 'move', id: one, groupId: a, targetId: two, placement: 'before' });
  const raw = f.store.get<Conversation>(f.workspace, 'conversation', two)!;
  raw.updated = Date.now() + 1_000_000;
  f.store.put(f.workspace, 'conversation', raw);
  let data = await f.bootData();
  assert.deepEqual(
    data.conversations.filter((c: any) => c.groupId === a).map((c: any) => c.id),
    [one, two],
  );
  await f.action({ type: 'move', id: one, groupId: b, targetId: three, placement: 'after' });
  data = await f.bootData();
  assert.equal(data.conversations.find((c: any) => c.id === one).pinned, true);
  assert.deepEqual(
    data.conversations.filter((c: any) => c.groupId === b).map((c: any) => c.id),
    [three, one],
  );
  await f.action({ type: 'move', id: one, groupId: null });
  assert.equal((await f.call('GET', 'conversations/' + one)).json().groupId, null);
  assert.equal(
    (
      await f.call('PATCH', 'conversation-organization', {
        type: 'move',
        id: two,
        groupId: b,
        targetId: one,
      })
    ).statusCode,
    400,
  );
  const otherBoot = await f.app.inject('/api/bootstrap');
  const otherHeaders = {
    ...f.headers,
    cookie: otherBoot.headers['set-cookie']!.toString().split(';')[0],
  };
  const foreign = await f.app.inject({
    method: 'PATCH',
    url: '/api/conversation-organization',
    headers: otherHeaders,
    payload: { type: 'move', id: one, groupId: b },
  });
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(otherBoot.json().conversationOrganization.groups, []);
  for (const payload of [
    { type: 'create-group', name: ' ', color: '#ffffff' },
    { type: 'create-group', name: '错误', color: 'red' },
    { type: 'update-group', id: a, patch: { name: '字'.repeat(25) } },
  ])
    assert.equal((await f.call('PATCH', 'conversation-organization', payload)).statusCode, 400);
});

test('color, pin, unread, archive, groups and order survive backups; older backups remain compatible', async (t) => {
  const f = await fixture(t),
    group = await f.group('设计');
  const id = await f.create('待整理', group);
  const patch = { title: '明天继续', color: '#fb7185', pinned: true, unread: true, archived: true };
  await f.call('PATCH', 'conversations/' + id, patch);
  const exported = (await f.call('GET', 'export')).json();
  const otherBoot = await f.app.inject('/api/bootstrap');
  const otherHeaders = {
    ...f.headers,
    cookie: otherBoot.headers['set-cookie']!.toString().split(';')[0],
  };
  const restore = await f.app.inject({
    method: 'POST',
    url: '/api/import',
    headers: otherHeaders,
    payload: exported,
  });
  assert.equal(restore.statusCode, 200, restore.body);
  const restored = (await f.app.inject({ url: '/api/bootstrap', headers: otherHeaders })).json();
  for (const [key, value] of Object.entries(patch))
    assert.equal(restored.conversations[0][key], value);
  assert.equal(restored.conversations[0].groupId, group);
  const before = f.store.organization(f.workspace);
  const invalid = structuredClone(exported);
  invalid.conversationOrganization.entries[randomUUID()] = { groupId: group };
  assert.equal((await f.call('POST', 'import', invalid)).statusCode, 400);
  assert.deepEqual(f.store.organization(f.workspace), before);
  const legacy = structuredClone(exported);
  delete legacy.conversationOrganization;
  assert.equal((await f.call('POST', 'import', legacy)).statusCode, 200);
  await f.call('PATCH', 'conversations/' + id, { unread: false, color: '', archived: false });
  const read = (await f.call('GET', 'conversations/' + id)).json();
  assert.equal(read.unread, false);
  assert.equal(read.color, '');
  assert.equal(read.archived, false);
  await f.call('DELETE', 'conversations/' + id);
  assert.equal(f.store.organization(f.workspace).entries[id], undefined);
});

test('a completing Agent preserves concurrent organization edits and cannot resurrect a deleted conversation', async (t) => {
  const f = await fixture(t);
  let arrive: () => void = () => {},
    finish: () => void = () => {};
  let arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume request */
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      'data: ' + JSON.stringify({ choices: [{ delta: { content: '正在处理' } }] }) + '\n\n',
    );
    arrive();
    await gate;
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    finish();
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as any).port;
  f.settings.providers = [
    {
      id: 'test',
      name: 'test',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      protocol: 'openai',
      models: ['test'],
      kind: 'chat',
    },
  ];
  f.store.saveSettings(f.workspace, f.settings);
  const group = await f.group('执行中'),
    id = await f.create('任务', group);
  const run = f.call('POST', 'runs', {
    conversationId: id,
    providerId: 'test',
    model: 'test',
    content: '开始',
  });
  await arrived;
  await f.call('PATCH', 'conversations/' + id, {
    title: '已改名',
    color: '#f5b84f',
    pinned: true,
    archived: true,
    unread: true,
  });
  await f.action({ type: 'delete-group', id: group });
  finish();
  assert.equal((await run).statusCode, 200);
  const saved = (await f.call('GET', 'conversations/' + id)).json();
  assert.equal(saved.title, '已改名');
  assert.equal(saved.color, '#f5b84f');
  assert.equal(saved.groupId, null);
  assert.equal(saved.pinned, true);
  assert.equal(saved.archived, true);
  assert.equal(saved.unread, true);
  assert.equal(saved.messages.length, 2);
  arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const deletedRun = f.call('POST', 'runs', {
    conversationId: id,
    providerId: 'test',
    model: 'test',
    content: '继续',
  });
  await arrived;
  await f.call('DELETE', 'conversations/' + id);
  finish();
  await deletedRun;
  assert.equal((await f.call('GET', 'conversations/' + id)).statusCode, 404);
  assert.equal(f.store.organization(f.workspace).entries[id], undefined);
});

test('legacy conversations keep pinned-first recency until an explicit order is saved', () => {
  const list = [
    { id: 'a', updated: 1 },
    { id: 'b', updated: 2 },
    { id: 'c', updated: 0, pinned: true },
  ] as Conversation[];
  assert.deepEqual(
    organizeConversations(list, { groups: [], entries: {}, order: [], revision: 0 }).map(
      (c) => c.id,
    ),
    ['c', 'b', 'a'],
  );
});

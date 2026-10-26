import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import {
  conversationBeforeMessage,
  defaultSettings,
  type Conversation,
  type Message,
  type WireMessage,
} from '@livra/shared';
import { localCommand, localRun } from '../apps/web/src/local/client.ts';
import { configureTransport, browserNetwork } from '../packages/runtime/src/network.ts';
import { runs } from '../packages/runtime/src/agent.ts';
import { createApp } from '../apps/server/src/app.ts';

function conversation(): Conversation {
  const messages: Message[] = [
    'first',
    'answer',
    'edit me',
    'old answer',
    'later',
    'later answer',
  ].map((content, i) => ({
    id: crypto.randomUUID(),
    role: i % 2 ? 'assistant' : 'user',
    content,
    created: i,
  }));
  return {
    id: crypto.randomUUID(),
    title: 'History',
    personaId: 'lumi',
    messages,
    updated: 0,
    pinned: true,
    color: '#67e8f9',
  };
}

test('editing truncates at a user turn while preserving earlier tools, native signatures and attachments', () => {
  const c = conversation();
  const native = {
    protocol: 'anthropic',
    content: [{ type: 'thinking', thinking: 'earlier', signature: 'signed' }],
  };
  c.protocolMessages = [
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } }],
    },
    {
      role: 'assistant',
      content: '',
      native,
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'remember', arguments: '{}' } },
      ],
    },
    { role: 'tool', content: 'earlier result', tool_call_id: 'call-1' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'edit me' },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'later' },
    { role: 'assistant', content: 'later answer' },
  ];
  const before = structuredClone(c);
  const edited = conversationBeforeMessage(c, c.messages[2].id);
  assert.deepEqual(edited.messages, c.messages.slice(0, 2));
  assert.deepEqual(edited.protocolMessages, c.protocolMessages.slice(0, 4));
  assert.equal(edited.pinned, true);
  assert.equal(edited.color, '#67e8f9');
  assert.deepEqual(c, before);
  assert.deepEqual(conversationBeforeMessage(c, c.messages[0].id).protocolMessages, []);
  assert.throws(() => conversationBeforeMessage(c, c.messages[1].id), /用户消息/);
  assert.throws(() => conversationBeforeMessage(c, crypto.randomUUID()), /用户消息/);
});

test('editing imported histories rebuilds earlier image and text attachments without removed turns', () => {
  const c = conversation();
  c.messages[0].attachments = [
    { name: 'reference.png', type: 'image', data: 'data:image/png;base64,cG5n' },
    { name: 'notes.txt', type: 'text', data: 'retained reference' },
  ];
  const edited = conversationBeforeMessage(c, c.messages[2].id);
  assert.deepEqual(edited.protocolMessages?.[0].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,cG5n' },
  });
  assert.match(edited.protocolMessages?.[0].content[2].text, /retained reference/);
  assert.ok(!JSON.stringify(edited.protocolMessages).includes('edit me'));
});

const provider = {
  id: 'edit-provider',
  name: 'Test',
  baseUrl: 'https://edit.example/v1',
  protocol: 'openai' as const,
  kind: 'chat' as const,
  models: ['test'],
};
function mockReplies(t: any) {
  const requests: WireMessage[][] = [];
  configureTransport(async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)).messages);
    return new Response(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'reply-' + requests.length } }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  });
  t.after(() => configureTransport(browserNetwork));
  return requests;
}

test('browser edit-and-resend replaces the selected turn, persists, and rejects invalid targets without locking the chat', async (t) => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  const requests = mockReplies(t);
  const settings = structuredClone(defaultSettings);
  settings.providers = [provider];
  await localCommand('/settings', { method: 'PUT', body: JSON.stringify(settings) });
  const c = await localCommand<Conversation>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ personaId: settings.personas[0].id }),
  });
  const send = (content: string, editMessageId?: string) =>
    localRun(
      {
        conversationId: c.id,
        providerId: provider.id,
        model: 'test',
        content,
        editMessageId,
      },
      new AbortController().signal,
      () => {},
    );
  await send('first');
  await send('edit me');
  await send('later');
  const read = () => localCommand<Conversation>('/conversations/' + c.id);
  const before = await read();
  await assert.rejects(send('invalid', before.messages[1].id), /用户消息/);
  assert.deepEqual(await read(), before);
  assert.ok(![...runs.values()].some((run) => run.conversationId === c.id));
  await send('edited', before.messages[2].id);
  const saved = await read();
  assert.deepEqual(
    saved.messages.map((message) => message.content),
    ['first', 'reply-1', 'edited', 'reply-4'],
  );
  assert.equal(saved.messages[0].id, before.messages[0].id);
  assert.deepEqual(
    requests
      .at(-1)!
      .slice(1)
      .map((message) => message.content),
    ['first', 'reply-1', 'edited'],
  );
  const snapshot: any = await localCommand('/export');
  const exported = snapshot.conversations.find((entry: Conversation) => entry.id === c.id);
  assert.deepEqual(exported.messages, saved.messages);
  await send('restart', saved.messages[0].id);
  assert.equal((await read()).title, before.title);
  assert.deepEqual(
    (await read()).messages.map((message) => message.content),
    ['restart', 'reply-5'],
  );
});

test('legacy streaming endpoint validates edits before starting and replaces history in the same run', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'livra-edit-'));
  const { app, store } = await createApp({ directory, staticRoot: join(directory, 'none') });
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const requests = mockReplies(t);
  const boot = await app.inject('/api/bootstrap');
  const cookie = boot.headers['set-cookie']!.toString().split(';')[0];
  const headers = { cookie, 'x-livra-client': 'web' };
  const workspace = store.session(cookie.split('=')[1])!;
  const settings = store.settings(workspace);
  settings.providers = [provider];
  store.saveSettings(workspace, settings);
  const c = conversation();
  c.personaId = settings.personas[0].id;
  store.put(workspace, 'conversation', c);
  const send = (editMessageId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/runs',
      headers,
      payload: {
        conversationId: c.id,
        providerId: provider.id,
        model: 'test',
        content: 'revised',
        editMessageId,
      },
    });
  const invalid = await send(c.messages[1].id);
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.deepEqual(store.conversation(workspace, c.id), c);
  assert.equal(requests.length, 0);
  const edited = await send(c.messages[2].id);
  assert.equal(edited.statusCode, 200, edited.body);
  assert.match(edited.body, /"type":"start"/);
  assert.deepEqual(
    store.conversation(workspace, c.id)!.messages.map((message) => message.content),
    ['first', 'answer', 'revised', 'reply-1'],
  );
  assert.deepEqual(
    requests[0].slice(1).map((message) => message.content),
    ['first', 'answer', 'revised'],
  );
});

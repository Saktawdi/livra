import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  defaultSettings,
  settingsSchema,
  publicSettings,
  type Provider,
  type ModelConfig,
} from '@livra/shared';
import { BrowserStore } from '../apps/web/src/local/store.ts';
import { createLocalCommands, workspace } from '../apps/web/src/local/commands.ts';
import { ModelCatalogService } from '../packages/runtime/src/model-catalog.ts';
import { complete } from '../packages/runtime/src/providers.ts';
import { configureTransport, browserNetwork } from '../packages/runtime/src/network.ts';

const catalog = {
  openai: {
    models: {
      'gpt-test': {
        id: 'gpt-test',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text', 'image'] },
        limit: { context: 128000, output: 16000 },
        reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
      },
    },
  },
};

test('model catalog shares inflight requests, persists across reopening and falls back to stale entries', async (t) => {
  const factory = new IDBFactory();
  let store = await BrowserStore.open(factory, 'catalog-cache');
  let requests = 0;
  let offline = false;
  configureTransport(async () => {
    requests++;
    if (offline) throw Error('offline');
    return Response.json(catalog);
  });
  t.after(() => configureTransport(browserNetwork));
  const service = new ModelCatalogService(store);
  const results = await Promise.all([service.load(workspace), service.load(workspace)]);
  assert.equal(requests, 1);
  assert.equal(results[0], results[1]);
  assert.equal((results[0]['openai/gpt-test'] as any).limit.context, 128000);
  await store.flush();
  store.close();
  store = await BrowserStore.open(factory, 'catalog-cache');
  const reopened = new ModelCatalogService(store);
  assert.deepEqual(await reopened.load(workspace), results[0]);
  assert.equal(requests, 1);
  offline = true;
  assert.deepEqual(await reopened.load(workspace, true), results[0]);
  assert.equal(requests, 2);
  const fresh = await BrowserStore.open(factory, 'catalog-empty');
  await assert.rejects(new ModelCatalogService(fresh).load(workspace), /offline/);
  fresh.close();
  store.close();
});

test('provider settings preserve private rotating keys, capabilities and custom parameters without exporting credentials', async () => {
  const store = await BrowserStore.open(new IDBFactory(), 'provider-settings');
  const { app } = createLocalCommands(store);
  const settings = structuredClone(defaultSettings);
  settings.providers = [
    {
      id: 'gateway',
      name: 'Gateway',
      baseUrl: 'https://gateway.example/v1',
      protocol: 'openai',
      kind: 'chat',
      keys: ['secret-a', 'secret-b'],
      models: ['proxy/gpt-test'],
      availableModels: ['proxy/gpt-test', 'other'],
      enabled: true,
      defaultEffort: 'high',
      modelConfigs: {
        'proxy/gpt-test': {
          context: 128000,
          vision: true,
          reasoning: true,
          tools: false,
          levels: ['low', 'high', '自定义档位'],
          maxTokens: 4000,
          temperature: 0.5,
          source: '自定义',
        },
      },
    },
  ];
  const saved = await app.execute('/settings', { method: 'PUT', body: JSON.stringify(settings) });
  assert.equal(saved.providers[0].hasKey, true);
  assert.equal(saved.providers[0].keyCount, 2);
  assert.equal(saved.providers[0].keys, undefined);
  assert.equal(saved.providers[0].apiKey, undefined);
  assert.equal(store.settings(workspace).providers[0].apiKey, 'secret-a');
  await app.execute('/settings', { method: 'PUT', body: JSON.stringify(saved) });
  assert.deepEqual(store.settings(workspace).providers[0].keys, ['secret-a', 'secret-b']);
  assert.deepEqual((await app.execute('/providers/gateway/keys')).keys, ['secret-a', 'secret-b']);
  const exported = await app.execute('/export');
  assert.ok(!JSON.stringify(exported).includes('secret-a'));
  assert.ok(!JSON.stringify(exported).includes('secret-b'));
  assert.equal(exported.settings.providers[0].modelConfigs['proxy/gpt-test'].source, '自定义');
  const imported = structuredClone(exported);
  imported.settings.providers[0].keys = ['untrusted-key'];
  await app.execute('/import', { method: 'POST', body: JSON.stringify(imported) });
  assert.equal(store.settings(workspace).providers[0].keys, undefined);
  const old = settingsSchema.parse({
    ...defaultSettings,
    providers: [
      {
        id: 'legacy',
        name: 'Legacy',
        baseUrl: 'https://old.example',
        models: ['legacy'],
        apiKey: 'old-key',
        contextWindows: { legacy: 64000 },
      },
    ],
  });
  assert.equal(old.providers[0].contextWindows?.legacy, 64000);
  assert.equal(publicSettings(old).providers[0].hasKey, true);
  await store.flush();
  store.close();
});

test('matched and custom model parameters control real requests in every chat protocol, including key rotation', async (t) => {
  const requests: { url: string; headers: Headers; body: any }[] = [];
  configureTransport(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url, headers: new Headers(init?.headers), body });
    let chunk: any = { choices: [{ delta: { content: 'ok' } }] };
    if (url.endsWith('/responses')) chunk = { type: 'response.output_text.delta', delta: 'ok' };
    if (url.endsWith('/messages'))
      chunk = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } };
    if (url.includes(':streamGenerateContent'))
      chunk = { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
    return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n');
  });
  t.after(() => configureTransport(browserNetwork));
  const run = async (
    protocol: Provider['protocol'],
    model: string,
    config: ModelConfig,
    reasoning = 'auto',
  ) => {
    const p: Provider = {
      id: 'rotation-' + protocol,
      name: 'P',
      baseUrl: 'https://p.example/v1',
      protocol,
      kind: 'chat',
      models: [model],
      keys: ['key-a', 'key-b'],
      defaultEffort: 'high',
      modelConfigs: { [model]: config },
    };
    await complete(
      p,
      model,
      [{ role: 'user', content: 'hi' }],
      [
        {
          type: 'function',
          function: { name: 'test', description: 'test', parameters: { type: 'object' } },
        },
      ],
      reasoning,
      new AbortController().signal,
      () => {},
    );
    return requests.at(-1)!;
  };
  let r = await run('openai', 'gpt-5', {
    tools: false,
    maxTokens: 4096,
    reasoning: true,
    reasoningMode: 'toggle',
  });
  assert.equal(r.body.enable_thinking, true);
  assert.equal(r.body.reasoning_effort, undefined);
  assert.equal(r.body.tools, undefined);
  assert.equal(r.body.max_completion_tokens, 4096);
  assert.equal(r.headers.get('authorization'), 'Bearer key-a');
  r = await run('openai', 'gpt-4o', { reasoning: false, temperature: 0.3, output: 2048 });
  assert.equal(r.body.temperature, 0.3);
  assert.equal(r.body.reasoning_effort, undefined);
  assert.equal(r.body.max_tokens, 2048);
  assert.equal(r.headers.get('authorization'), 'Bearer key-b');
  r = await run('responses', 'gpt-5', { maxTokens: 5000, reasoning: true });
  assert.deepEqual(r.body.reasoning, { effort: 'high' });
  assert.equal(r.body.max_output_tokens, 5000);
  assert.equal(r.body.max_tokens, undefined);
  r = await run('anthropic', 'claude-sonnet-4-6', { maxTokens: 6000, reasoningMode: 'budget' });
  assert.deepEqual(r.body.thinking, { type: 'enabled', budget_tokens: 4096 });
  assert.equal(r.headers.get('x-api-key'), 'key-a');
  r = await run('anthropic', 'claude-opus-4-6', { maxTokens: 6000 });
  assert.deepEqual(r.body.thinking, { type: 'adaptive' });
  assert.deepEqual(r.body.output_config, { effort: 'high' });
  r = await run('gemini', 'gemini-2.5-pro', { maxTokens: 5000, reasoningMode: 'budget' }, 'medium');
  assert.equal(r.body.generationConfig.maxOutputTokens, 5000);
  assert.equal(r.body.generationConfig.thinkingConfig.thinkingBudget, 4096);
  assert.equal(r.headers.get('x-goog-api-key'), 'key-a');
  r = await run('gemini', 'gemini-3-pro', { reasoning: true }, 'custom-effort');
  assert.equal(r.body.generationConfig.thinkingConfig.thinkingLevel, 'custom-effort');
  await assert.rejects(
    run('anthropic', 'claude-sonnet-4-6', { maxTokens: 512 }, 'high'),
    /大于 1024/,
  );
});

test('media and speech use rotating keys only on execution and respect disabled suppliers', async (t) => {
  const requests: { url: string; key: string | null }[] = [];
  configureTransport(async (url, init) => {
    requests.push({ url, key: new Headers(init?.headers).get('authorization') });
    if (url.endsWith('/audio/speech'))
      return new Response('ID3-audio', { headers: { 'content-type': 'audio/mpeg' } });
    return Response.json({ data: [{ b64_json: Buffer.from('media').toString('base64') }] });
  });
  t.after(() => configureTransport(browserNetwork));
  const store = await BrowserStore.open(new IDBFactory(), 'media-rotating-keys');
  t.after(() => store.close());
  const settings = structuredClone(defaultSettings);
  settings.providers = (['image', 'music', 'speech'] as const).map((kind) => ({
    id: 'rotate-media-' + kind,
    name: kind,
    kind,
    protocol: 'openai',
    baseUrl: 'https://media.example/v1',
    models: ['test'],
    keys: ['media-a', 'media-b'],
  }));
  for (const kind of ['image', 'music', 'speech'] as const) {
    settings[`${kind}Provider`] = 'rotate-media-' + kind;
    settings[`${kind}Model`] = 'test';
  }
  settings.speechEngine = 'custom';
  store.saveSettings(workspace, settings);
  const { app } = createLocalCommands(store);
  const post = (path: string, body: unknown) =>
    app.execute(path, { method: 'POST', body: JSON.stringify(body) });
  // Enumerating tools must not consume keys.
  await app.execute('/tools');
  await app.execute('/tools');
  for (const kind of ['image', 'music', 'speech'] as const) {
    const run = () =>
      kind === 'speech'
        ? post('/speech', { input: '你好' })
        : post('/tools/execute', { name: `generate_${kind}`, args: { prompt: '测试' } });
    await run();
    assert.equal(requests.at(-1)?.key, 'Bearer media-a');
    await run();
    assert.equal(requests.at(-1)?.key, 'Bearer media-b');
    settings.providers.find((p) => p.kind === kind)!.enabled = false;
    store.saveSettings(workspace, settings);
    const count = requests.length;
    await assert.rejects(run(), /停用|不可用/);
    assert.equal(requests.length, count);
  }
});

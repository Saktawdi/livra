import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { defaultSettings, settingsSchema, speechEngine } from '@livra/shared';
import { prepareNarration, spokenText } from '../apps/server/src/narration.ts';
import { VitsService, joinWaves, speechSegments, vitsOrigin } from '../apps/server/src/vits.ts';
import { createApp } from '../apps/server/src/app.ts';
import type { network } from '../apps/server/src/network.ts';

test('old settings migrate to summary narration and preserve a configured TTS connection', () => {
  const old: any = structuredClone(defaultSettings);
  delete old.speechMode;
  delete old.speechEngine;
  assert.equal(settingsSchema.parse(old).speechMode, 'summary');
  assert.equal(speechEngine(settingsSchema.parse(old)), 'vits');
  old.speechProvider = 'fish';
  assert.equal(speechEngine(settingsSchema.parse(old)), 'custom');
  old.speechEngine = 'browser';
  assert.equal(speechEngine(settingsSchema.parse(old)), 'browser');
});

test('narration removes nonspoken material and distinguishes direct reading from extract fallback', async () => {
  const input =
    '# 结论\n已经完成。\n```js\nSECRET_CODE();\n```\n[查看结果](https://example.com)\n![图](https://example.com/p.png)\n<think>PRIVATE_REASONING</think>\n`inline_code`\n| A | B |\nhttps://example.com';
  assert.equal(spokenText(input), '结论 已经完成。 查看结果');
  assert.equal(spokenText('正文\n```js\nunfinished secret'), '正文');
  assert.equal(spokenText('正文\n~~~js\nsecret\n~~~'), '正文');
  assert.equal(spokenText('正文 ```inline fence secret``` 结束。'), '正文 结束。');
  assert.equal(spokenText('查看 https://example.com。下一步继续。'), '查看 。下一步继续。');
  const signal = new AbortController().signal;
  const direct = await prepareNarration(
    { ...defaultSettings, speechMode: 'direct' },
    input,
    undefined,
    signal,
    async () => {
      throw Error('must not call LLM');
    },
  );
  assert.equal(direct.source, 'direct');
  assert.equal(direct.text, spokenText(input));
  const extract = await prepareNarration(
    defaultSettings,
    '这是结论。'.repeat(80),
    undefined,
    signal,
  );
  assert.equal(extract.source, 'extract');
  assert.match(extract.warning!, /未配置总结模型/);
  assert.ok(Array.from(extract.text).length <= defaultSettings.speechSummaryLength);
  await assert.rejects(
    prepareNarration(defaultSettings, '```js\ncode\n```', undefined, signal),
    /没有适合朗读/,
  );
});

test('independent summary model receives persona style, no tools, and cancellation never falls back', async () => {
  const settings = structuredClone(defaultSettings);
  settings.providers = [
    {
      id: 'quick',
      name: 'quick',
      kind: 'chat',
      protocol: 'openai',
      baseUrl: 'https://example.com/v1',
      models: ['fast-model'],
    },
  ];
  settings.defaultProvider = 'other';
  settings.defaultModel = 'expensive-main';
  settings.speechSummaryProvider = 'quick';
  settings.speechSummaryModel = 'fast-model';
  settings.speechSummaryStyle = '轻松幽默';
  const persona = { ...settings.personas[0], name: '大肥鱼', systemPrompt: '像好朋友聊天' };
  const controller = new AbortController();
  const result = await prepareNarration(
    settings,
    '本轮回复。',
    persona,
    controller.signal,
    async (provider, model, messages, tools) => {
      assert.equal(provider.id, 'quick');
      assert.equal(model, 'fast-model');
      assert.deepEqual(tools, []);
      assert.match(messages[0].content, /大肥鱼/);
      assert.match(messages[0].content, /轻松幽默/);
      return {
        content: '**做好啦**，我们可以开始下一步。\n```js\nsecret\n```',
        reasoning: '',
        calls: [],
      };
    },
  );
  assert.equal(result.source, 'model');
  assert.equal(result.text, '做好啦，我们可以开始下一步。');
  const fallback = await prepareNarration(
    settings,
    '结论。',
    persona,
    controller.signal,
    async () => {
      throw Error('private-api-key');
    },
  );
  assert.equal(fallback.source, 'extract');
  assert.ok(!JSON.stringify(fallback).includes('private-api-key'));
  await assert.rejects(
    prepareNarration(settings, '结论。', persona, controller.signal, async () => {
      controller.abort();
      throw controller.signal.reason;
    }),
    { name: 'AbortError' },
  );
});

test('prepare API uses the separately saved model and draft mode without changing saved settings', async (t) => {
  process.env.ALLOW_PRIVATE_ENDPOINTS = 'true';
  let observed: any;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const bytes of req) raw += bytes;
    observed = { path: req.url, body: JSON.parse(raw), authorization: req.headers.authorization };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: '好啦，已经整理完成，接下来一起试试看。' } }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const directory = mkdtempSync(join(tmpdir(), 'livra-narration-'));
  const { app, store } = await createApp({ directory });
  t.after(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  const boot = await app.inject('/api/bootstrap');
  const cookie = boot.headers['set-cookie']!.toString().split(';')[0];
  const workspace = store.session(cookie.split('=')[1])!;
  const settings = store.settings(workspace);
  settings.providers.push({
    id: 'summary',
    name: 'fast',
    kind: 'chat',
    protocol: 'openai',
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    models: ['small'],
    apiKey: 'private-summary-key',
  });
  settings.speechSummaryProvider = 'summary';
  settings.speechSummaryModel = 'small';
  settings.defaultModel = 'main-model';
  store.saveSettings(workspace, settings);
  const headers = { cookie, 'x-livra-client': 'web' };
  const result = await app.inject({
    method: 'POST',
    url: '/api/speech/prepare',
    headers,
    payload: { input: '完成了，细节很长。', personaId: settings.personas[0].id },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().source, 'model');
  assert.equal(observed.path, '/v1/chat/completions');
  assert.equal(observed.body.model, 'small');
  assert.equal(observed.authorization, 'Bearer private-summary-key');
  assert.equal(observed.body.tools, undefined);
  assert.ok(!result.body.includes('private-summary-key'));
  const direct = await app.inject({
    method: 'POST',
    url: '/api/speech/prepare',
    headers,
    payload: { input: '**直接读**', draft: { speechMode: 'direct' } },
  });
  assert.equal(direct.json().source, 'direct');
  assert.equal(store.settings(workspace).speechMode, 'summary');
});

function wav(samples: number[]) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(22050, 24);
  buffer.writeUInt32LE(44100, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((n, i) => buffer.writeInt16LE(n, 44 + i * 2));
  return buffer;
}
function catalogInfo() {
  return {
    named_endpoints: Object.fromEntries(
      ['tts_fn', 'tts_fn_1'].map((name) => [
        '/' + name,
        {
          parameters: [
            { parameter_name: 'text' },
            {
              parameter_name: 'speaker',
              type: { enum: ['特别周', '米浴'] },
              parameter_default: '特别周',
            },
            {
              parameter_name: 'language',
              type: {
                enum: name === 'tts_fn' ? ['简体中文', '日本語', 'English', 'Mix'] : ['Japanese'],
              },
            },
            { parameter_name: 'speed' },
            { parameter_name: 'is_symbol' },
          ],
        },
      ]),
    ),
  };
}

test('VITS fetches voices, uses selected voice, segments long Unicode text and joins real WAV data', async () => {
  const jobs: any[] = [];
  let calls = 0;
  const fetcher: typeof network = async (url, init) => {
    assert.ok(url.startsWith(vitsOrigin + '/'));
    if (url.endsWith('/info')) {
      calls++;
      return Response.json(catalogInfo());
    }
    if (init?.method === 'POST') {
      jobs.push(JSON.parse(init.body as string).data);
      return Response.json({ event_id: 'job' });
    }
    if (url.endsWith('/job'))
      return new Response(
        'event: heartbeat\n\ndata: ["Success",{"url":"' +
          vitsOrigin +
          '/gradio_api/file=/tmp/audio.wav"}]\nevent: complete\n\n',
      );
    return new Response(new Uint8Array(wav([1, -2, 3])));
  };
  const service = new VitsService(fetcher);
  assert.equal((await service.catalog()).models[0].voices.length, 2);
  const text = '你好😀。'.repeat(65);
  const result = await service.synthesize(
    'a',
    defaultSettings,
    text,
    '米浴',
    'zh-CN',
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.ok(jobs.length > 1);
  assert.ok(
    jobs.every((j) => Array.from(j[0]).length <= 140 && j[1] === '米浴' && j[2] === '简体中文'),
  );
  assert.equal(jobs.map((j) => j[0]).join(''), text);
  assert.equal(result.readUInt32LE(40), jobs.length * 6);
  assert.equal(result.readUInt32LE(4), result.length - 8);
  assert.equal(result.readInt16LE(44), 1);
  await assert.rejects(
    service.synthesize(
      'a',
      defaultSettings,
      '你好',
      'not-a-voice',
      'auto',
      new AbortController().signal,
    ),
    /不属于当前/,
  );
  assert.ok(speechSegments(text).every((t) => !t.includes('\uFFFD')));
  assert.throws(() => joinWaves([Buffer.from('bad')]), /有效 WAV/);
});

test('VITS reports stale catalog and refuses foreign audio downloads', async () => {
  let fail = false,
    downloaded = false;
  const service = new VitsService(async (url, init) => {
    if (url.endsWith('/info')) {
      if (fail) throw Error('offline');
      return Response.json(catalogInfo());
    }
    if (init?.method === 'POST') return Response.json({ event_id: 'job' });
    if (url.endsWith('/job'))
      return new Response(
        'event: complete\ndata: ["Success",{"url":"http://127.0.0.1/private"}]\n\n',
      );
    downloaded = true;
    return new Response();
  });
  await service.catalog();
  fail = true;
  assert.equal((await service.catalog(true)).status, 'stale');
  await assert.rejects(
    service.synthesize('a', defaultSettings, '测试', '', 'auto', new AbortController().signal),
    /无效的音频地址/,
  );
  assert.equal(downloaded, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.synthesize('a', defaultSettings, '测试', '', 'auto', controller.signal),
    { name: 'AbortError' },
  );
});

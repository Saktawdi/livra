import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveModelSource } from '../apps/web/src/live2d-runtime.ts';

test('remote Cubism 2 and 4 resources use the relay without rewriting motion or expression names', async (t) => {
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    fetch: globalThis.fetch,
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => ({}) },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'http://localhost:5180/', origin: 'http://localhost:5180' },
  });
  let manifest: any = {
    FileReferences: {
      Moc: 'model.moc3',
      Textures: ['textures/a.png'],
      Motions: { Idle: [{ File: 'idle.motion3.json', Sound: 'hello.wav' }] },
      Expressions: [{ File: 'smile.exp3.json', Name: 'Smile' }],
    },
  };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^\/__livra_transport\?url=/);
    return Response.json(manifest);
  };
  t.after(() => {
    globalThis.fetch = previous.fetch;
    for (const key of ['document', 'location'] as const) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const source: any = await liveModelSource(
    'https://models.example/whale/model.model3.json',
    new AbortController().signal,
  );
  const target = (value: string) => new URL(value).searchParams.get('url');
  assert.equal(source.url, 'https://models.example/whale/model.model3.json');
  assert.equal(target(source.FileReferences.Moc), 'https://models.example/whale/model.moc3');
  assert.equal(
    target(source.FileReferences.Textures[0]),
    'https://models.example/whale/textures/a.png',
  );
  assert.equal(
    target(source.FileReferences.Motions.Idle[0].File),
    'https://models.example/whale/idle.motion3.json',
  );
  assert.equal(source.FileReferences.Expressions[0].Name, 'Smile');
  manifest = {
    model: 'model.moc',
    textures: ['tex.png'],
    motions: { idle: [{ file: 'idle.mtn' }] },
    expressions: [{ name: 'happy', file: 'happy.exp.json' }],
  };
  const legacy: any = await liveModelSource(
    'https://models.example/v2/model.json',
    new AbortController().signal,
  );
  assert.equal(target(legacy.model), 'https://models.example/v2/model.moc');
  assert.equal(target(legacy.motions.idle[0].file), 'https://models.example/v2/idle.mtn');
  assert.equal(legacy.expressions[0].name, 'happy');
  assert.equal(
    await liveModelSource('/models/local/model.json', new AbortController().signal),
    'http://localhost:5180/models/local/model.json',
  );
});

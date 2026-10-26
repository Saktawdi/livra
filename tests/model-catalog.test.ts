import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchModel } from '@livra/shared';
const match: (...args: any[]) => any = matchModel;
const name = 'Lumen catalog';
{
  test(name + ' keeps architecture versions distinct while allowing a dated alias', () => {
    const entries = {
      original: {
        id: 'deepseek-v3',
        providerId: 'deepseek',
        limit: { context: 64000 },
      },
    };
    assert.equal(match('deepseek-v4', entries), null);
    assert.equal(match('deepseek-v3-2026-05-14', entries).context, 64000);
  });
  test(
    name + ' model metadata prefers the original publisher and honors explicit namespaces',
    () => {
      const entries = {
        gateway: {
          id: 'gpt-4o',
          providerId: 'gateway',
          tool_call: false,
          limit: { context: 16000, output: 4096 },
        },
        original: {
          id: 'gpt-4o',
          providerId: 'openai',
          tool_call: true,
          modalities: { input: ['text', 'image'] },
          limit: { context: 128000, output: 16384 },
        },
      };
      assert.equal(match('gpt-4o', entries).context, 128000);
      assert.equal(match('gpt-4o', entries).vision, true);
      assert.equal(match('gateway/gpt-4o', entries).tools, false);
      assert.equal(match('gpt-4o-unrelated', entries), null);
      assert.equal(match('unknown', entries), null);
    },
  );
  test(name + ' leaves conflicting third party metadata unmatched', () => {
    const entries = {
      a: { id: 'shared', providerId: 'a', tool_call: true },
      b: { id: 'shared', providerId: 'b', tool_call: false },
    };
    assert.equal(match('shared', entries), null);
    assert.equal(match('b/shared', entries).tools, false);
  });
  test(name + ' accepts structured provider/model fields and safe wrappers', () => {
    const entries = {
      openai: {
        modelId: 'gpt-4o',
        providerId: 'openai',
        modalities: { input: ['text', 'image'] },
        limit: { context: 128000 },
      },
      anthropic: {
        modelId: 'claude-3-5-sonnet',
        providerId: 'anthropic',
        aliases: ['claude-sonnet'],
        limit: { context: 200000 },
      },
    };
    assert.equal(match('openai/gpt-4o', entries).vision, true);
    assert.equal(match('models/gpt-4o', entries).context, 128000);
    assert.equal(match('vendor-gpt-4o-custom', entries).matchedId, 'gpt-4o');
    assert.equal(match('gpt-4o-2024-08-06', entries).matchedId, 'gpt-4o');
    assert.equal(match('anthropic/claude-sonnet', entries).matchedId, 'claude-3-5-sonnet');
    assert.equal(match('gateway/gpt-4o', entries).context, 128000);
    assert.equal(match('anthropic/gpt-4o', entries), null);
    assert.equal(match('gpt-4o-unrelated', entries), null);
    assert.equal(match('deepseek-v3.1', entries), null);
  });
  test(name + ' reads nested provider registries and refuses fuzzy conflicts', () => {
    const nested = {
      gateway: {
        models: {
          'gpt-4o': {
            id: 'gpt-4o',
            limit: { context: 16000 },
          },
        },
      },
      other: {
        models: {
          'gpt-4o': {
            id: 'gpt-4o',
            limit: { context: 32000 },
          },
        },
      },
    };
    assert.equal(match('gateway/gpt-4o-custom', nested).context, 16000);
    assert.equal(match('gpt-4o-custom', nested), null);
  });
  test(name + ' matches gateway prefixes, release labels and effort suffixes', () => {
    const models = [
      ['deepseek-v4.1-flash', 'deepseek'],
      ['gpt-4o-mini', 'openai'],
      ['claude-opus-4-6', 'anthropic'],
      ['gemini-3.8-flash', 'google'],
      ['gpt-6-astra', 'openai'],
      ['glm-5.3-flash', 'zai'],
    ];
    const entries = Object.fromEntries(
      models.map(([id, providerId]) => [
        id,
        {
          id,
          providerId,
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image'] },
          limit: { context: 256000, output: 32000 },
          reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
        },
      ]),
    );
    const cases = [
      ['codearts/deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
      ['[opencode]deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
      ['【渠道一】deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
      ['group/auto-deepseek-v4-1-flash-free', 'deepseek-v4.1-flash'],
      ['opencode-zen-free/deepseek-v4.1-flash-free', 'deepseek-v4.1-flash'],
      ['our-free-model/deepseek-ai/deepseek-v4.1-flash:free', 'deepseek-v4.1-flash'],
      ['deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash'],
      ['deepseek-v4.1-flash-preview-2026-10-17-free', 'deepseek-v4.1-flash'],
      ['gpt-4o-mini-2024-07-18', 'gpt-4o-mini'],
      ['models/gpt-4o-mini', 'gpt-4o-mini'],
      ['CLAUDE_OPUS_4.6_THINKING', 'claude-opus-4-6'],
      ['claude-opus-4-6-antigravity', 'claude-opus-4-6'],
      ['gemini-3.8-flash-extra-low', 'gemini-3.8-flash'],
      ['gemini-3.8-flash-high', 'gemini-3.8-flash'],
      ['gemini-3.8-flash-tiered', 'gemini-3.8-flash'],
      ['gpt-6-astra-cc-format', 'gpt-6-astra'],
      ['group/auto-glm-5-3-flash-free', 'glm-5.3-flash'],
    ];
    for (const [query, expected] of cases) {
      const result = match(query, entries);
      assert.equal(result?.matchedId, expected, query);
      assert.equal(result.context, 256000, query);
      assert.deepEqual(result.levels, ['low', 'high'], query);
    }
  });
  test(name + ' never discards architecture, size or modality variants', () => {
    const entries = {
      deepseek: { id: 'deepseek-v4', providerId: 'deepseek' },
      openai: { id: 'gpt-4o', providerId: 'openai' },
      google: { id: 'gemini-2.5-flash', providerId: 'google' },
      decimal: { id: 'gpt-5.1', providerId: 'openai' },
    };
    for (const query of [
      'deepseek-v4.1',
      'codearts/deepseek-v4.1-free',
      'deepseek-v5',
      'gpt-4o-mini',
      'gpt-4o-mini-free',
      'gpt-4o-pro',
      'gpt-4o-audio-preview',
      'gpt-4o-realtime-preview',
      'gpt-4o-vision',
      'gpt-4o-codex',
      'gpt-4o-unrelated',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gpt-51',
      'gpt-5',
      'notgpt-4o',
      'gpt-4o-1332',
      'gpt-4o-2026-13-32',
    ])
      assert.equal(match(query, entries), null, query);
  });
  test(name + ' prefers complete ids over release aliases and display names', () => {
    const entries = {
      base: {
        id: 'deepseek-v3',
        providerId: 'deepseek',
        limit: { context: 64000 },
      },
      snapshot: {
        id: 'deepseek-v3-1017',
        providerId: 'deepseek',
        limit: { context: 128000 },
      },
      display: {
        id: 'other-model',
        name: 'deepseek-v3',
        providerId: 'deepseek',
      },
    };
    assert.equal(match('deepseek-v3', entries).context, 64000);
    assert.equal(match('codearts/deepseek-v3-1017', entries).context, 128000);
    assert.equal(match('group/auto-deepseek-v3-1017-free', entries).context, 128000);
    const snapshots = {
      a: entries.snapshot,
      b: {
        id: 'deepseek-v3-1018',
        providerId: 'deepseek',
        limit: { context: 256000 },
      },
    };
    assert.equal(match('deepseek-v3', snapshots), null);
    assert.equal(match('deepseek-v3-1017', snapshots).context, 128000);
  });
  test(name + ' handles aliases without choosing an unrelated model by order', () => {
    const entries = {
      a: {
        id: 'gpt-4o',
        providerId: 'openai',
        name: 'GPT 4o',
        alias: 'shared-alias',
      },
      b: {
        id: 'gemini-2.5-pro',
        providerId: 'google',
        aliases: ['shared-alias'],
      },
    };
    assert.equal(match('GPT 4o', entries).matchedId, 'gpt-4o');
    assert.equal(match('shared-alias', entries), null);
    assert.equal(match('openai/shared-alias', entries).matchedId, 'gpt-4o');
    assert.equal(
      match('shared-alias', Object.fromEntries(Object.entries(entries).reverse())),
      null,
    );
    assert.equal(match('', entries), null);
    assert.equal(match(' ', entries), null);
    assert.equal(match('gpt-4o', null), null);
  });
  test(name + ' uses original release metadata when gateways disagree', () => {
    const entries = {
      original: {
        id: 'gemini-3-flash-preview',
        providerId: 'google',
        limit: { context: 1000000 },
      },
      a: { id: 'gemini-3-flash', providerId: 'a', limit: { context: 32000 } },
      b: {
        id: 'google/gemini-3-flash',
        providerId: 'b',
        limit: { context: 64000 },
      },
    };
    assert.equal(match('gemini-3-flash', entries).context, 1000000);
    assert.equal(match('a/gemini-3-flash', entries).context, 32000);
    assert.equal(match('proxy/gemini-3-flash', entries).context, 1000000);
  });
  test(name + ' separates namespace punctuation from model identity', () => {
    const entries = {
      minimax: {
        id: 'MiniMax-M3.1-Flash',
        providerId: 'minimax',
        limit: { context: 1000000 },
      },
      shorter: {
        id: 'minimax/m3.1-flash',
        providerId: 'gateway',
        limit: { context: 64000 },
      },
      gemma: { id: 'gemma4-26b', providerId: 'other' },
      gpt: { id: 'gpt-5.1', providerId: 'openai' },
      o: { id: 'o3', providerId: 'openai' },
    };
    assert.equal(match('minimax-m3.1-flash', entries).context, 1000000);
    assert.equal(match('gemma-4-26b', entries).matchedId, 'gemma4-26b');
    assert.equal(match('gpt-51', entries), null);
    assert.equal(match('proxy-o3-high', entries).matchedId, 'o3');
  });
}

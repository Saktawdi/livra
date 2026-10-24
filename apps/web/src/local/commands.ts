import Ajv from 'ajv';
import { z } from 'zod';
import { settingsSchema, publicSettings, providerSchema, personaSchema, speechLanguageSchema, speechEngine, skinPackageSchema, conversationOrganizationSchema, conversationMetaSchema, liveModelCatalog, type Conversation, type Artifact } from '@livra/shared';
import { environment } from '@livra/runtime/environment';
import { readJson, safeError } from '@livra/runtime/network';
import { listModels } from '@livra/runtime/providers';
import { toolList, executeTool, renderSlides, builtInNames, type Context } from '@livra/runtime/tools';
import { runs, resolveProvider } from '@livra/runtime/agent';
import { listSaktaModels, saktaRequest } from '@livra/runtime/sakta';
import { LiveModelService } from '@livra/runtime/live-models';
import { VitsService } from '@livra/runtime/vits';
import { synthesize } from '@livra/runtime/speech';
import { prepareNarration } from '@livra/runtime/narration';
import { LocalRouter } from './router';
import type { BrowserStore } from './store';
const randomUUID = () => crypto.randomUUID();
export const workspace = 'browser';
export function createLocalCommands(store: BrowserStore) {
 const app = new LocalRouter();
 const liveModels = new LiveModelService(store);
 const vits = new VitsService();
 const context = (_workspace: string, signal = AbortSignal.timeout(180_000)): Context => {
 const settings = store.settings(workspace);
 return {store, workspace, settings, persona: settings.personas[0], signal, emit: () => {}, liveModels};
 };
  app.get('/api/bootstrap', async (req) => ({
    settings: publicSettings(store.settings(req.workspace)),
    conversationOrganization: store.organization(req.workspace),
    conversations: store
      .conversations(req.workspace)
      .map(({ messages, protocolMessages, ...c }) => ({ ...c, messages: [] })),
    saktaEnabled: environment.SAKTA_BASE_URL !== '',
    version: '1.1.0',
  }));
  app.put('/api/settings', async (req) => {
    // Runs keep their own settings snapshot; preferences apply to subsequent runs.
    const previous = store.settings(req.workspace);
    const settings = settingsSchema.parse(req.body);
    if (
      new Set(settings.providers.map((p) => p.id)).size !== settings.providers.length ||
      new Set(settings.personas.map((p) => p.id)).size !== settings.personas.length ||
      new Set(settings.customTools.map((t) => t.name)).size !== settings.customTools.length
    )
      throw Object.assign(Error('供应商、人偶或工具标识重复'), { statusCode: 400 });
    if (
      settings.providers.some((p) => p.id === 'sakta') ||
      settings.customTools.some((t) => builtInNames.includes(t.name))
    )
      throw Object.assign(Error('不能覆盖内置标识'), { statusCode: 400 });
    try {
      const ajv = new Ajv({ strict: false });
      for (const tool of settings.customTools) ajv.compile(tool.inputSchema);
    } catch {
      throw Object.assign(Error('自定义工具的 JSON Schema 无效'), { statusCode: 400 });
    }
    for (const p of settings.providers)
      if (p.apiKey === undefined)
        p.apiKey = previous.providers.find((old) => old.id === p.id)?.apiKey;
    for (const t of settings.customTools)
      if (t.apiKey === undefined)
        t.apiKey = previous.customTools.find((old) => old.name === t.name)?.apiKey;
    if (settings.searchKey === undefined) settings.searchKey = previous.searchKey;
    settings.sakta = previous.sakta;
    store.saveSettings(req.workspace, settings);
    return publicSettings(settings);
  });
  app.post('/api/providers/models', async (req) => {
    const input = z.object({ provider: providerSchema }).parse(req.body);
    const provider = input.provider;
    if (provider.apiKey === undefined)
      provider.apiKey = store
        .settings(req.workspace)
        .providers.find((p) => p.id === provider.id)?.apiKey;
    try {
      return { models: await listModels(provider, req.signal) };
    } catch (error) {
      throw Object.assign(Error(safeError(error, [provider.apiKey])), { statusCode: 502 });
    }
  });
  app.get('/api/live-models', async (req) => liveModelCatalog(store.settings(req.workspace)));
  app.get('/api/live-models/catalog', async (req) =>
    liveModels.catalog(store.settings(req.workspace), req.workspace),
  );
  app.get('/api/live-models/sources/:id', async (req) => {
    const { id } = z.object({ id: z.string().max(48) }).parse(req.params);
    const { refresh } = z.object({ refresh: z.enum(['0', '1']).default('0') }).parse(req.query);
    return liveModels.source(store.settings(req.workspace), req.workspace, id, refresh === '1');
  });
  app.post('/api/live-models/resolve', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(80) }).parse(req.body);
    return liveModels.resolve(store.settings(req.workspace), req.workspace, id);
  });
  app.get('/api/sakta/models', async (req) => {
    const provider = resolveProvider(store.settings(req.workspace), 'sakta');
    if (!provider) throw Object.assign(Error('请先登录 Sakta'), { statusCode: 401 });
    return { models: await listSaktaModels(provider.apiKey!) };
  });
  app.post(
    '/api/auth/sakta',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req) => {
      if (environment.SAKTA_BASE_URL === '')
        throw Object.assign(Error('管理员已关闭 Sakta 接入'), { statusCode: 404 });
      const { username, password } = z
        .object({ username: z.string().min(1).max(200), password: z.string().min(1).max(500) })
        .parse(req.body);
      const response = await readJson(
        await saktaRequest('user/pub/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username, password }).toString(),
        }),
      );
      if (response.code !== 0 || !response.token)
        throw Object.assign(Error(response.msg || '登录失败'), { statusCode: 401 });
      const settings = store.settings(req.workspace);
      settings.sakta = { name: username, token: response.token, connected: true };
      settings.defaultProvider = 'sakta';
      store.saveSettings(req.workspace, settings);
      return { settings: publicSettings(settings) };
    },
  );
  app.delete('/api/auth/sakta', async (req) => {
    const settings = store.settings(req.workspace);
    delete settings.sakta;
    if (settings.defaultProvider === 'sakta') {
      settings.defaultProvider = '';
      settings.defaultModel = '';
    }
    store.saveSettings(req.workspace, settings);
    return publicSettings(settings);
  });
  app.get('/api/conversation-organization', async (req) => store.organization(req.workspace));
  app.patch('/api/conversation-organization', async (req) =>
    store.organize(req.workspace, req.body as any),
  );
  app.get('/api/conversations/:id', async (req, reply) => {
    const c = store.conversation(req.workspace, (req.params as any).id);
    if (!c) return reply.code(404).send({ error: '对话不存在' });
    const { protocolMessages, ...visible } = c;
    return visible;
  });
  app.post('/api/conversations', async (req) => {
    const { personaId, groupId } = z
      .object({ personaId: z.string(), groupId: z.string().uuid().nullable().optional() })
      .parse(req.body);
    if (!store.settings(req.workspace).personas.some((p) => p.id === personaId))
      throw Object.assign(Error('人偶不存在'), { statusCode: 400 });
    if (groupId && !store.organization(req.workspace).groups.some((g) => g.id === groupId))
      throw Object.assign(Error('分组不存在'), { statusCode: 400 });
    const conversation: Conversation = {
      id: randomUUID(),
      title: '新对话',
      personaId,
      messages: [],
      updated: Date.now(),
    };
    store.put(req.workspace, 'conversation', conversation);
    if (groupId) store.organize(req.workspace, { type: 'move', id: conversation.id, groupId });
    return store.conversation(req.workspace, conversation.id);
  });
  app.patch('/api/conversations/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const c = store.get<Conversation>(req.workspace, 'conversation', id);
    if (!c) return reply.code(404).send({ error: '对话不存在' });
    const patch = conversationMetaSchema
      .extend({
        personaId: z.string().optional(),
      })
      .parse(req.body);
    if (
      patch.personaId &&
      !store.settings(req.workspace).personas.some((p) => p.id === patch.personaId)
    )
      throw Object.assign(Error('人偶不存在'), { statusCode: 400 });
    if (
      patch.groupId &&
      !store.organization(req.workspace).groups.some((g) => g.id === patch.groupId)
    )
      throw Object.assign(Error('分组不存在'), { statusCode: 400 });
    const { personaId, ...meta } = patch;
    if (personaId) c.personaId = personaId;
    const organization = store.organization(req.workspace);
    organization.entries[id] = { ...organization.entries[id], ...meta };
    store.saveOrganization(req.workspace, organization);
    store.put(req.workspace, 'conversation', c);
    const { protocolMessages, ...visible } = store.conversation(req.workspace, id)!;
    return visible;
  });
  app.delete('/api/conversations/:id', async (req) => {
    const id = (req.params as any).id;
    for (const r of runs.values())
      if (r.workspace === req.workspace && r.conversationId === id) r.controller.abort();
    store.delete(req.workspace, 'conversation', id);
    const organization = store.organization(req.workspace);
    delete organization.entries[id];
    organization.order = organization.order.filter((x) => x !== id);
    store.saveOrganization(req.workspace, organization);
    return { ok: true };
  });
  app.get('/api/tools', async (req) => toolList(context(req.workspace)));
  app.post('/api/tools/execute', async (req) => {
    const { name, args, providerId, model } = z
      .object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()),
        providerId: z.string().optional(),
        model: z.string().max(200).optional(),
      })
      .parse(req.body);
    const controller = { signal: req.signal || AbortSignal.timeout(180_000), abort() {} };
    const ctx = context(req.workspace, controller.signal);
    if (
      providerId &&
      model &&
      name === 'generate_image' &&
      ctx.settings.providers.some((p) => p.id === providerId && p.kind === 'image')
    ) {
      ctx.settings.imageProvider = providerId;
      ctx.settings.imageModel = model;
    }
    if (
      providerId &&
      model &&
      name === 'generate_music' &&
      ctx.settings.providers.some((p) => p.id === providerId && p.kind === 'music')
    ) {
      ctx.settings.musicProvider = providerId;
      ctx.settings.musicModel = model;
    }
    return executeTool(name, args, ctx, true);
  });
  app.get('/api/artifacts', async () => store.artifacts(workspace).map(a => ({...a, data: {...a.data, html: undefined}})));
  app.get('/api/artifacts/:id', async (req, reply) => {
    const a = store.get<Artifact>(req.workspace, 'artifact', (req.params as any).id);
    return a || reply.code(404).send({ error: '作品不存在' });
  });
  app.patch('/api/artifacts/:id', async (req, reply) => {
    const a = store.get<Artifact>(req.workspace, 'artifact', (req.params as any).id);
    if (!a) return reply.code(404).send({ error: '作品不存在' });
    const patch = z
      .object({ favorite: z.boolean().optional(), title: z.string().min(1).max(120).optional() })
      .parse(req.body);
    Object.assign(a, patch);
    store.put(req.workspace, 'artifact', a);
    return { ok: true };
  });
  app.delete('/api/artifacts/:id', async (req) => {
    store.delete(req.workspace, 'artifact', (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/slides/preview', async (req) => {
    const { markdown, theme } = z
      .object({ markdown: z.string().max(100000), theme: z.string().max(20000).optional() })
      .parse(req.body);
    return { html: renderSlides(markdown, theme) };
  });
  app.get('/api/memories', async (req) => store.memories(req.workspace));
  app.post('/api/memories', async (req) => {
    const input = z
      .object({ personaId: z.string(), content: z.string().min(1).max(600) })
      .parse(req.body);
    return store.put(req.workspace, 'memory', { ...input, id: randomUUID(), created: Date.now() });
  });
  app.delete('/api/memories/:id', async (req) => {
    store.delete(req.workspace, 'memory', (req.params as any).id);
    return { ok: true };
  });
  app.get('/api/usage', async (req) => store.list(req.workspace, 'usage'));
  app.get('/api/export', async (req) => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: publicSettings(store.settings(req.workspace)),
    conversations: store.conversations(req.workspace),
    conversationOrganization: store.organization(req.workspace),
    artifacts: store.artifacts(req.workspace),
    memories: store.memories(req.workspace),
  }));
  app.post('/api/import', { bodyLimit: 128_000_000 }, async (req) => {
    const data = z
      .object({
        version: z.literal(1),
        settings: settingsSchema,
        conversations: z.array(z.any()).max(1000),
        conversationOrganization: conversationOrganizationSchema.optional(),
        artifacts: z.array(z.any()).max(500),
        memories: z.array(z.any()).max(1000),
      })
      .parse(req.body);
    const settings = data.settings;
    delete settings.sakta;
    for (const p of settings.providers) delete p.apiKey;
    for (const t of settings.customTools) delete t.apiKey;
    delete settings.searchKey;
    // Validate the entire backup before the transaction, and rebuild protocol history.
    const conversations = data.conversations.map((raw) => {
      const c = z
        .object({
          id: z.string().uuid(),
          title: z.string().max(100),
          personaId: z.string(),
          updated: z.number(),
          pinned: z.boolean().optional(),
          color: conversationMetaSchema.shape.color,
          archived: z.boolean().optional(),
          unread: z.boolean().optional(),
          messages: z
            .array(
              z.object({
                id: z.string(),
                role: z.enum(['user', 'assistant']),
                content: z.string().max(200000),
                created: z.number(),
              }),
            )
            .max(5000),
        })
        .parse(raw);
      return c;
    });
    const artifacts = data.artifacts.map((raw) => {
      const a = z
        .object({
          id: z.string().uuid(),
          kind: z.enum(['image', 'music', 'slides', 'theme', 'skin', 'persona', 'text']),
          title: z.string().max(120),
          created: z.number(),
          data: z.record(z.string(), z.unknown()),
        })
        .parse(raw);
      if (a.kind === 'image')
        a.data = z
          .object({
            images: z
              .array(
                z
                  .string()
                  .max(45000000)
                  .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/),
              )
              .max(4),
            prompt: z.string().max(12000).optional(),
            model: z.string().max(200).optional(),
          })
          .parse(a.data);
      if (a.kind === 'music')
        a.data = z
          .object({
            audio: z
              .string()
              .max(45000000)
              .regex(/^data:audio\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/),
            prompt: z.string().max(8000).optional(),
            lyrics: z.string().max(8000).optional(),
          })
          .parse(a.data);
      if (a.kind === 'slides') {
        const s = z
          .object({ markdown: z.string().max(100000), theme: z.string().max(20000).optional() })
          .parse(a.data);
        a.data = { ...s, html: renderSlides(s.markdown, s.theme) };
      }
      if (a.kind === 'theme') {
        const s = z.object({ css: z.string().max(20000) }).parse(a.data);
        renderSlides('# Theme', s.css);
        a.data = s;
      }
      if (a.kind === 'persona') a.data = { persona: personaSchema.parse(a.data.persona) };
      if (a.kind === 'skin')
        a.data = z
          .object({ skin: skinPackageSchema, prompt: z.string().max(4000).optional() })
          .parse(a.data);
      if (a.kind === 'text') a.data = z.object({ content: z.string().max(200000) }).parse(a.data);
      return a;
    });
    const memories = data.memories.map((raw) =>
      z
        .object({
          id: z.string().uuid(),
          personaId: z.string(),
          content: z.string().max(600),
          created: z.number(),
        })
        .parse(raw),
    );
    if (data.conversationOrganization) {
      const ids = new Set(
        [...store.conversations(req.workspace), ...conversations].map((c) => c.id),
      );
      if (
        [
          ...Object.keys(data.conversationOrganization.entries),
          ...data.conversationOrganization.order,
        ].some((id) => !ids.has(id))
      )
        throw Object.assign(Error('分组数据引用了不存在的对话'), { statusCode: 400 });
    }
    await store.batch(() => {
      for (const c of conversations) store.put(req.workspace, 'conversation', c);
      for (const a of artifacts) store.put(req.workspace, 'artifact', a);
      for (const m of memories) store.put(req.workspace, 'memory', m);
      if (data.conversationOrganization)
        store.saveOrganization(req.workspace, data.conversationOrganization);
      store.saveSettings(req.workspace, settings);
    });
    return { ok: true };
  });

  const speechDraft = settingsSchema
    .pick({
      speechEngine: true,
      speechProvider: true,
      speechModel: true,
      speechVoice: true,
      speechVitsModel: true,
      speechVitsVoice: true,
      speechLanguage: true,
      speechSpeed: true,
      speechLatency: true,
      speechMode: true,
      speechSummaryProvider: true,
      speechSummaryModel: true,
      speechSummaryLength: true,
      speechSummaryStyle: true,
    })
    .partial();
  app.get('/api/speech/voices', async (req) => {
    const { refresh } = z
      .object({ refresh: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    return vits.catalog(refresh === 'true');
  });
  app.post('/api/speech/prepare', async (req) => {
    const body = z
      .object({
        input: z.string().min(1).max(100_000),
        personaId: z.string().optional(),
        draft: speechDraft.optional(),
        persona: personaSchema
          .pick({ name: true, systemPrompt: true, voiceLanguage: true })
          .optional(),
      })
      .parse(req.body);
    const settings = { ...store.settings(req.workspace), ...body.draft };
    const saved = settings.personas.find((p) => p.id === body.personaId);
    const persona = saved && body.persona ? { ...saved, ...body.persona } : saved;
    const controller = { signal: req.signal || AbortSignal.timeout(180_000), abort() {} };
    return prepareNarration(settings, body.input, persona, controller.signal);
  });
  app.post('/api/speech', async (req, reply) => {
    const { input, voice, language, draft } = z
      .object({
        input: z
          .string()
          .min(1)
          .max(8000)
          .refine((text) => Array.from(text).length <= 4000, '朗读稿最多 4000 字符'),
        voice: z.string().max(200).default(''),
        language: speechLanguageSchema.removeDefault().optional(),
        draft: speechDraft.optional(),
      })
      .parse(req.body);
    const settings = { ...store.settings(req.workspace), ...draft };
    const engine = speechEngine(settings);
    const provider = settings.providers.find(
      (p) => p.id === settings.speechProvider && p.kind === 'speech',
    );
    if (engine === 'browser' || (engine === 'custom' && !provider))
      throw Object.assign(Error('请配置语音服务，或使用浏览器朗读'), { statusCode: 400 });
    const controller = { signal: req.signal || AbortSignal.timeout(180_000), abort() {} };
    if (engine === 'vits')
      return reply
        .type('audio/wav')
        .send(
          await vits.synthesize(
            req.workspace,
            settings,
            input,
            voice,
            language ?? settings.speechLanguage,
            controller.signal,
          ),
        );
    return reply
      .type('audio/mpeg')
      .send(
        await synthesize(
          provider!,
          settings,
          input,
          voice,
          language ?? settings.speechLanguage,
          controller.signal,
        ),
      );
  });

app.post('/api/runs/:id/stop', async req => { runs.get(req.params.id)?.controller.abort(); return {ok:true}; });
 app.post('/api/runs/:id/approvals/:approval', async req => {
 const run = runs.get(req.params.id);
 const {allow} = z.object({allow:z.boolean()}).parse(req.body);
 const resolve = run?.approvals.get(req.params.approval);
 if (!resolve) throw Object.assign(Error('请求已过期'), {statusCode:404});
 resolve(allow); return {ok:true};
 });
 return {app, context};
}

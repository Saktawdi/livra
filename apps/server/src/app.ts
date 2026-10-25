import { ModelCatalogService } from '@livra/runtime/model-catalog';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import Ajv from 'ajv';
import { z } from 'zod';
import {
  settingsSchema,
  publicSettings,
  providerSchema,
  personaSchema,
  speechLanguageSchema,
  speechEngine,
  skinPackageSchema,
  conversationOrganizationSchema,
  conversationMetaSchema,
  liveModelCatalog,
  type Artifact,
  type Conversation,
  type AgentEvent,
} from '@livra/shared';
import { Store } from './store.ts';
import { readJson, safeError } from './network.ts';
import { listModels } from './providers.ts';
import { toolList, executeTool, renderSlides, builtInNames, type Context } from './tools.ts';
import { resolveProvider, runAgent, runs, type Run } from './agent.ts';
import { synthesize } from './speech.ts';
import { VitsService } from './vits.ts';
import { prepareNarration } from './narration.ts';
import { listSaktaModels, saktaRequest } from './sakta.ts';
import { LiveModelService } from './live-models.ts';
import type { network } from './network.ts';

declare module 'fastify' {
  interface FastifyRequest {
    workspace: string;
  }
}
export async function createApp(
  options: {
    directory?: string;
    logger?: boolean;
    staticRoot?: string;
    liveModelFetch?: typeof network;
    vitsFetch?: typeof network;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 56_000_000,
    requestTimeout: 0,
    trustProxy:
      process.env.TRUST_PROXY?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) || false,
  });
  const store = new Store(
    options.directory ||
      resolve(process.env.DATA_DIR || resolve(import.meta.dirname, '../../../.data')),
  );
  const liveModels = new LiveModelService(store, options.liveModelFetch);
  const vits = new VitsService(options.vitsFetch);
  const modelCatalog = new ModelCatalogService(store);
  app.decorateRequest('workspace', '');
  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  app.addHook('onClose', async () => {
    for (const r of runs.values()) r.controller.abort();
    store.close();
  });
  const accessHash = () =>
    createHash('sha256')
      .update(process.env.ACCESS_PASSWORD || '')
      .digest('hex');
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    const expected = process.env.PUBLIC_ORIGIN;
    if (origin && (origin === expected || new URL(origin).host === req.headers.host)) {
      reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Access-Control-Allow-Credentials', 'true')
        .header('Vary', 'Origin');
    } else if (origin) {
      return reply.code(403).send({ error: '请求来源未获允许' });
    }
    if (req.method === 'OPTIONS')
      return reply
        .header('Access-Control-Allow-Headers', 'Content-Type, X-Livra-Client')
        .header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        .code(204)
        .send();
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-livra-client'] !== 'web')
      return reply.code(403).send({ error: '缺少 X-Livra-Client 请求头' });
    if (req.url === '/api/health' || req.url === '/api/access') return;
    if (process.env.ACCESS_PASSWORD && req.cookies.livra_access !== accessHash())
      return reply.code(401).send({ error: '此空间需要访问密码', locked: true });
    let workspace = store.session(req.cookies.livra_session);
    if (!workspace) {
      if (req.url !== '/api/bootstrap')
        return reply.code(401).send({ error: '会话已失效，请刷新页面' });
      const session = store.createSession();
      workspace = session.workspace;
      reply.setCookie('livra_session', session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!process.env.PUBLIC_ORIGIN?.startsWith('https:'),
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    req.workspace = workspace;
  });
  app.setErrorHandler((error, req, reply) => {
    const settings = req.workspace ? store.settings(req.workspace) : undefined;
    const secrets = [
      ...(settings?.providers.flatMap((p) => [p.apiKey, ...(p.keys || [])]) || []),
      ...(settings?.customTools.map((t) => t.apiKey) || []),
      settings?.sakta?.token,
      settings?.searchKey,
    ];
    const status = error instanceof z.ZodError ? 400 : (error as any).statusCode || 500;
    const message =
      error instanceof z.ZodError
        ? '参数格式有误：' +
          error.issues
            .map((x) => x.path.join('.') + ': ' + x.message)
            .slice(0, 3)
            .join('；')
        : safeError(error, secrets);
    req.log.error({ statusCode: status, message }, 'API request failed');
    reply.code(status).send({ error: message });
  });
  const context = (
    workspace: string,
    signal = AbortSignal.timeout(180_000),
    emit: (event: AgentEvent) => void = () => {},
  ): Context => {
    const settings = store.settings(workspace);
    return { store, workspace, settings, persona: settings.personas[0], signal, emit, liveModels };
  };
  app.get('/api/health', async () => ({ ok: true, name: 'Livra', version: '1.0.0' }));
  app.post(
    '/api/access',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { password } = z.object({ password: z.string().max(1000) }).parse(req.body);
      const actual = createHash('sha256').update(password).digest();
      const expected = createHash('sha256')
        .update(process.env.ACCESS_PASSWORD || '')
        .digest();
      if (!timingSafeEqual(actual, expected))
        return reply.code(401).send({ error: '访问密码不正确' });
      reply.setCookie('livra_access', accessHash(), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: !!process.env.PUBLIC_ORIGIN?.startsWith('https:'),
        maxAge: 60 * 60 * 24 * 30,
      });
      return { ok: true };
    },
  );
  app.get('/api/bootstrap', async (req) => ({
    settings: publicSettings(store.settings(req.workspace)),
    conversationOrganization: store.organization(req.workspace),
    conversations: store
      .conversations(req.workspace)
      .map(({ messages, protocolMessages, ...c }) => ({ ...c, messages: [] })),
    saktaEnabled: process.env.SAKTA_BASE_URL !== '',
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
    for (const p of settings.providers) {
      const old = previous.providers.find((item) => item.id === p.id);
      if (p.keys === undefined && p.apiKey === undefined) p.keys = old?.keys;
      if (p.apiKey === undefined) p.apiKey = old?.apiKey;
      if (p.keys !== undefined) p.apiKey = p.keys[0] || '';
    }
    for (const t of settings.customTools)
      if (t.apiKey === undefined)
        t.apiKey = previous.customTools.find((old) => old.name === t.name)?.apiKey;
    if (settings.searchKey === undefined) settings.searchKey = previous.searchKey;
    settings.sakta = previous.sakta;
    store.saveSettings(req.workspace, settings);
    return publicSettings(settings);
  });
  app.get('/api/model-catalog', async (req) => modelCatalog.load(req.workspace));
  app.post('/api/providers/models', async (req) => {
    const input = z.object({ provider: providerSchema }).parse(req.body);
    const provider = input.provider;
    const saved = store.settings(req.workspace).providers.find((p) => p.id === provider.id);
    if (provider.keys === undefined && provider.apiKey === undefined) provider.keys = saved?.keys;
    if (provider.apiKey === undefined) provider.apiKey = saved?.apiKey;
    try {
      return { models: await listModels(provider) };
    } catch (error) {
      throw Error(safeError(error, [provider.apiKey, ...(provider.keys || [])]));
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
      if (process.env.SAKTA_BASE_URL === '')
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
  app.post('/api/tools/execute', async (req, reply) => {
    const { name, args, providerId, model } = z
      .object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()),
        providerId: z.string().optional(),
        model: z.string().max(200).optional(),
      })
      .parse(req.body);
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
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
  app.get('/api/artifacts', async (req) =>
    store.artifacts(req.workspace).map((a) => ({
      ...a,
      data: {
        ...a.data,
        images: a.data.images?.map(
          (_: any, index: number) => `/api/artifacts/${a.id}/media/${index}`,
        ),
        audio: a.data.audio ? `/api/artifacts/${a.id}/media/0` : undefined,
        html: undefined,
      },
    })),
  );
  app.get('/api/artifacts/:id', async (req, reply) => {
    const a = store.get<Artifact>(req.workspace, 'artifact', (req.params as any).id);
    return a || reply.code(404).send({ error: '作品不存在' });
  });
  app.get('/api/artifacts/:id/media/:index', async (req, reply) => {
    const { id, index } = req.params as any;
    const a = store.get<Artifact>(req.workspace, 'artifact', id);
    const data = a?.data.images?.[Number(index)] || a?.data.audio;
    const match =
      typeof data === 'string' &&
      /^data:((?:image|audio)\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(data);
    if (!match) return reply.code(404).send({ error: '媒体不存在' });
    return reply.type(match[1]).send(Buffer.from(match[2], 'base64'));
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
    for (const p of settings.providers) {
      delete p.apiKey;
      delete p.keys;
    }
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
    store.db.exec('BEGIN');
    try {
      for (const c of conversations) store.put(req.workspace, 'conversation', c);
      for (const a of artifacts) store.put(req.workspace, 'artifact', a);
      for (const m of memories) store.put(req.workspace, 'memory', m);
      if (data.conversationOrganization)
        store.saveOrganization(req.workspace, data.conversationOrganization);
      store.saveSettings(req.workspace, settings);
      store.db.exec('COMMIT');
    } catch (error) {
      store.db.exec('ROLLBACK');
      throw error;
    }
    return { ok: true };
  });
  app.post('/api/runs', async (req, reply) => {
    const input = z
      .object({
        conversationId: z.string().uuid(),
        providerId: z.string(),
        model: z.string().min(1).max(200),
        content: z.string().max(100000),
        reasoning: z.string().min(1).max(80).optional(),
        attachments: z
          .array(
            z.object({
              name: z.string().max(200),
              type: z.enum(['image', 'text']),
              data: z.string().max(12000000),
            }),
          )
          .max(6)
          .default([]),
      })
      .parse(req.body);
    const ctx = context(req.workspace);
    const provider = resolveProvider(ctx.settings, input.providerId);
    if (!provider)
      throw Object.assign(Error('请连接自己的模型，或登录 Sakta 使用免费模型'), {
        statusCode: 400,
      });
    if (!input.content.trim() && !input.attachments.length)
      throw Object.assign(Error('请输入消息或添加附件'), { statusCode: 400 });
    if (
      input.attachments.some(
        (a) =>
          a.type === 'image' &&
          !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(a.data),
      )
    )
      throw Object.assign(Error('图片附件格式无效'), { statusCode: 400 });
    const conversation = store.get<Conversation>(
      req.workspace,
      'conversation',
      input.conversationId,
    );
    if (!conversation) throw Object.assign(Error('对话不存在'), { statusCode: 404 });
    if (
      [...runs.values()].some(
        (r) => r.workspace === req.workspace && r.conversationId === conversation.id,
      )
    )
      throw Object.assign(Error('这段对话已有任务正在执行，可以在其他对话继续工作'), {
        statusCode: 409,
      });
    ctx.persona =
      ctx.settings.personas.find((p) => p.id === conversation.personaId) ||
      ctx.settings.personas[0];
    const run: Run = {
      id: randomUUID(),
      workspace: req.workspace,
      conversationId: conversation.id,
      controller: new AbortController(),
      approvals: new Map(),
    };
    runs.set(run.id, run);
    ctx.signal = run.controller.signal;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(req.headers.origin
        ? {
            'Access-Control-Allow-Origin': req.headers.origin,
            'Access-Control-Allow-Credentials': 'true',
          }
        : {}),
    });
    ctx.emit = (event) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const keepalive = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': keepalive\n\n');
    }, 15_000);
    const timeout = setTimeout(() => run.controller.abort(Error('任务达到 15 分钟上限')), 900_000);
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) run.controller.abort();
    });
    try {
      await runAgent(
        ctx,
        run,
        conversation,
        provider,
        input.model,
        {
          id: randomUUID(),
          role: 'user',
          content: input.content,
          attachments: input.attachments,
          created: Date.now(),
        },
        input.reasoning,
      );
    } finally {
      clearInterval(keepalive);
      clearTimeout(timeout);
      reply.raw.end();
    }
  });
  app.post('/api/runs/:id/stop', async (req) => {
    const run = runs.get((req.params as any).id);
    if (run?.workspace === req.workspace) run.controller.abort();
    return { ok: true };
  });
  app.post('/api/runs/:id/approvals/:approval', async (req, reply) => {
    const { id, approval } = req.params as any;
    const run = runs.get(id);
    const { allow } = z.object({ allow: z.boolean() }).parse(req.body);
    if (run?.workspace !== req.workspace || !run.approvals.has(approval))
      return reply.code(404).send({ error: '请求已过期' });
    run.approvals.get(approval)!(allow);
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
  app.post('/api/speech/prepare', async (req, reply) => {
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
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
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
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
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
  const webRoot = options.staticRoot || resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(webRoot)) {
    await app.register(serveStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: '接口不存在' })
        : reply.sendFile('index.html'),
    );
  }
  return { app, store };
}

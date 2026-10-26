import { Buffer } from 'buffer';
import { environment } from './environment.ts';
const randomUUID = () => crypto.randomUUID();
import { Marp } from '@marp-team/marp-core';
import { z } from 'zod';
import Ajv from 'ajv';
import {
  moodSchema,
  personaSchema,
  liveSchema,
  speechLanguageSchema,
  liveModelCatalog,
  applyMarpTheme,
  marpThemeName,
  skinCreationSchema,
  skinPackageSchema,
  type Settings,
  type Persona,
  type Artifact,
  type AgentEvent,
  type ToolInfo,
} from '@livra/shared';
import { searchWeb } from './search.ts';
import type { RuntimeStore as Store } from './store.ts';
import type { LiveModelService } from './live-models.ts';
import { network, endpoint, readJson, safeError } from './network.ts';
import { withProviderKey, type FunctionTool } from './providers.ts';

export type Context = {
  store: Store;
  liveModels: LiveModelService;
  workspace: string;
  settings: Settings;
  persona: Persona;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  approve?: (name: string, args: any) => Promise<boolean>;
};
type Registered = ToolInfo & {
  schema?: z.ZodTypeAny;
  approval?: boolean;
  execute: (args: any, ctx: Context) => Promise<any>;
};
const object = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const text = (description: string, maxLength = 16000) => ({
  type: 'string',
  description,
  maxLength,
});
export const builtInNames = [
  'list_tools',
  'set_emotion',
  'remember',
  'web_search',
  'generate_image',
  'generate_music',
  'create_slides',
  'create_marp_theme',
  'list_marp_themes',
  'create_skin',
  'list_skins',
  'create_persona',
  'list_live2d_models',
];

function artifact(ctx: Context, kind: Artifact['kind'], title: string, data: Artifact['data']) {
  const result: Artifact = { id: randomUUID(), kind, title, created: Date.now(), data };
  const images = ctx.store.local
    ? data.images
    : data.images?.map((_: unknown, index: number) => `/api/artifacts/${result.id}/media/${index}`);
  const audio = ctx.store.local
    ? data.audio
    : data.audio
      ? `/api/artifacts/${result.id}/media/0`
      : undefined;
  ctx.store.put(ctx.workspace, 'artifact', result);
  ctx.emit({
    type: 'artifact',
    artifact: { ...result, data: { ...data, images, audio, html: undefined } },
  });
  return {
    artifactId: result.id,
    kind,
    title,
    ...(images ? { images } : {}),
    ...(audio ? { audio } : {}),
    ...(kind === 'persona' ? { persona: data.persona } : {}),
    ...(kind === 'skin' ? { preview: '打开皮肤作品可预览、应用和导出；未改变当前外观。' } : {}),
  };
}
async function media(url: string, signal: AbortSignal, kind: 'image' | 'audio'): Promise<string> {
  if (url.startsWith('data:')) {
    if (
      !new RegExp(
        `^data:${kind === 'image' ? 'image/(?:png|jpeg|webp|gif)' : 'audio/[a-zA-Z0-9.+-]+'};base64,[a-zA-Z0-9+/=\\r\\n]+$`,
      ).test(url) ||
      url.length > 45_000_000
    )
      throw Error('服务返回的媒体格式不受支持');
    return url;
  }
  const response = await network(url, { signal });
  if (!response.ok) throw Error(`下载媒体失败（HTTP ${response.status}）`);
  const mime = response.headers.get('content-type')?.split(';')[0] || '';
  if (!mime.startsWith(kind + '/') || mime === 'image/svg+xml')
    throw Error('服务返回的媒体类型不受支持');
  const reader = response.body!.getReader();
  let count = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 32_000_000) throw Error('媒体超过 32 MB 限制');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
}
export function renderSlides(markdown: string, theme?: string) {
  const marp = new Marp({ html: false, math: false });
  if (theme) {
    if (/@import|url\s*\(|<\/?(?:script|style)|expression\s*\(/i.test(theme))
      throw Error('主题只能包含本地 CSS 样式');
    // Keep readable slide typography when a generated theme only changes colors or layout.
    marp.themeSet.add(`@import "default";\n${theme}`);
    const name = marpThemeName(theme);
    if (name) markdown = applyMarpTheme(markdown, name);
  }
  const rendered = marp.render(markdown);
  const css = rendered.css.replace(/<\/style/gi, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data:"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\nhtml{background:#20221f}body{margin:0;padding:24px;display:grid;gap:24px}svg[data-marpit-svg]{width:100%;height:auto;max-height:90vh} @media print{body{padding:0;gap:0}svg[data-marpit-svg]{break-after:page;max-height:none}}</style></head><body>${rendered.html}</body></html>`;
}
export function registry(ctx: Context): Map<string, Registered> {
  const map = new Map<string, Registered>();
  const add = (tool: Omit<Registered, 'available'> & { available?: boolean }) =>
    map.set(tool.name, { available: true, ...tool });
  add({
    name: 'create_skin',
    title: '设计应用皮肤',
    category: 'create',
    description:
      '按用户自然语言设计完整应用皮肤并保存为可预览、应用、导出的作品。直接在参数中完成设计，无需另配模型。name 命名，prompt 保留用户需求；appearance.skin 选择布局基础 orbit/paper/veil，appearance.design 自定配色、字体 sans/serif/mono、导航 rail/island/editorial、输入区 capsule/underline/glass、宽度/几何/透明度及 Canvas 动效 stars/aurora/grid/none。可用 bubble/density/radius 调整会话节奏。正文与背景、surface、raised 对比度至少 4.5，muted 与背景至少 3。只接受结构化设计参数，不接受代码。用 list_skins 查询或读取旧皮肤后可以继续修改并另存新版。用户可从返回的作品预览并应用。',
    inputSchema: z.toJSONSchema(skinCreationSchema) as Record<string, any>,
    schema: skinCreationSchema,
    execute: async ({ prompt, ...args }) => {
      ctx.signal.throwIfAborted();
      const skin = skinPackageSchema.parse({ ...args, version: 2 });
      return artifact(ctx, 'skin', skin.name, { skin, prompt });
    },
  });
  const skinQuery = z.object({
    id: z.string().uuid().optional(),
    query: z.string().max(200).default(''),
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  });
  add({
    name: 'list_skins',
    title: '查找已保存的皮肤',
    category: 'create',
    description:
      '查找本空间的应用皮肤作品。query 搜索名称/描述；传 id 读取完整 skin 配置，修改后交给 create_skin 生成新版。返回结果不含模型密钥或其他偏好设置。',
    inputSchema: z.toJSONSchema(skinQuery) as Record<string, any>,
    schema: skinQuery,
    execute: async ({ id, query, offset, limit }) => {
      if (id) {
        const saved = ctx.store.get<Artifact>(ctx.workspace, 'artifact', id);
        if (!saved || saved.kind !== 'skin') throw Error('皮肤不存在或不属于当前空间');
        return { id: saved.id, skin: skinPackageSchema.parse(saved.data.skin) };
      }
      const items = ctx.store
        .artifacts(ctx.workspace)
        .filter(
          (a) =>
            a.kind === 'skin' &&
            `${a.title} ${a.data.skin?.description || ''}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        );
      return {
        skins: items.slice(offset, offset + limit).map((a) => ({
          id: a.id,
          name: a.title,
          description: a.data.skin?.description || '',
          created: a.created,
        })),
        total: items.length,
        nextOffset: offset + limit < items.length ? offset + limit : null,
      };
    },
  });
  add({
    name: 'list_tools',
    title: '发现工具',
    description: '列出当前人偶可使用的工具及实际可用状态。',
    category: 'agent',
    inputSchema: object({}),
    schema: z.object({}),
    execute: async () =>
      [...map.values()]
        .filter((t) => allowed(ctx, t.name))
        .map(({ execute, schema, approval, ...t }) => t),
  });
  add({
    name: 'set_emotion',
    title: '表达情绪',
    description: '用结构化情绪驱动 Live2D 表情，不改变回复内容。',
    category: 'live',
    inputSchema: object({ mood: { type: 'string', enum: moodSchema.options } }, ['mood']),
    schema: z.object({ mood: moodSchema }),
    execute: async (args) => {
      ctx.emit({ type: 'emotion', mood: args.mood });
      return { mood: args.mood };
    },
  });
  add({
    name: 'remember',
    title: '记住一件事',
    description: '用户明确要求或同意后，将一条偏好或事实记入当前人偶的长期记忆。',
    category: 'live',
    inputSchema: object({ content: text('待保存的简短事实或偏好', 600) }, ['content']),
    schema: z.object({ content: z.string().min(1).max(600) }),
    approval: true,
    execute: async ({ content }) =>
      ctx.store.put(ctx.workspace, 'memory', {
        id: randomUUID(),
        personaId: ctx.persona.id,
        content,
        created: Date.now(),
      }),
  });
  add({
    name: 'web_search',
    title: '网页搜索',
    description: '搜索网络信息，返回标题、摘要和来源链接。',
    category: 'research',
    inputSchema: object({ query: text('搜索词', 500) }, ['query']),
    schema: z.object({ query: z.string().min(1).max(500) }),
    available:
      ctx.settings.searchEngine === 'anysearch' ||
      !!(ctx.settings.searchUrl || environment.SEARXNG_URL),
    execute: async ({ query }) => searchWeb(ctx.settings, query, ctx.signal),
  });
  add({
    name: 'create_slides',
    title: 'Marp 演示文稿',
    description:
      '把完整 Marp Markdown 变为演示文稿。用 --- 分页。可通过 list_marp_themes 查询已保存主题并传入 themeId 复用，或提供 theme CSS。',
    category: 'create',
    inputSchema: object(
      {
        title: text('标题', 120),
        markdown: text('完整 Marp Markdown', 100000),
        theme: text('可选的 Marp 主题 CSS（含 @theme 名称）', 20000),
        themeId: {
          type: 'string',
          format: 'uuid',
          description: 'list_marp_themes 返回的主题 ID，与 theme 二选一',
        },
      },
      ['title', 'markdown'],
    ),
    schema: z.object({
      title: z.string().min(1).max(120),
      markdown: z.string().min(1).max(100000),
      theme: z.string().max(20000).optional(),
      themeId: z.string().uuid().optional(),
    }),
    execute: async ({ title, markdown, theme, themeId }) => {
      if (theme && themeId) throw Error('theme 和 themeId 只能选择一种');
      if (themeId) {
        const saved = ctx.store.get<Artifact>(ctx.workspace, 'artifact', themeId);
        if (!saved || saved.kind !== 'theme') throw Error('主题不存在或不属于当前空间');
        theme = saved.data.css;
      }
      const name = theme && marpThemeName(theme);
      if (name) markdown = applyMarpTheme(markdown, name);
      const html = renderSlides(markdown, theme);
      return artifact(ctx, 'slides', title, { markdown, theme, themeId, html });
    },
  });
  add({
    name: 'list_marp_themes',
    title: '查找已保存的 Marp 主题',
    category: 'create',
    description:
      '查询当前空间内可复用的演示主题。返回 ID 和 CSS 中实际的主题名称，供 create_slides.themeId 使用。',
    inputSchema: object({
      query: text('按名称搜索', 200),
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    }),
    schema: z.object({
      query: z.string().max(200).default(''),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(20).default(20),
    }),
    execute: async ({ query, offset, limit }) => {
      const themes = ctx.store
        .artifacts(ctx.workspace)
        .filter((a) => a.kind === 'theme' && a.title.toLowerCase().includes(query.toLowerCase()));
      return {
        themes: themes.slice(offset, offset + limit).map((a) => ({
          id: a.id,
          title: a.title,
          name: marpThemeName(a.data.css),
          created: a.created,
        })),
        total: themes.length,
        nextOffset: offset + limit < themes.length ? offset + limit : null,
      };
    },
  });
  add({
    name: 'create_marp_theme',
    title: '设计 Marp 主题',
    description:
      '保存 AI 设计的 Marp CSS 主题，供演示文稿复用。CSS 必须包含 /* @theme name */，禁止外部资源。',
    category: 'create',
    inputSchema: object(
      {
        name: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}$' },
        css: text('完整 Marp 主题 CSS', 20000),
      },
      ['name', 'css'],
    ),
    schema: z.object({
      name: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
      css: z.string().min(1).max(20000),
    }),
    execute: async ({ name, css }) => {
      const clean = css.replace(/\/\*\s*@theme\s+[^*]*\*\//g, '');
      const theme = `/* @theme ${name} */\n${clean}`;
      renderSlides(`---\ntheme: ${name}\n---\n# ${name}`, theme);
      return artifact(ctx, 'theme', name, { css: theme });
    },
  });
  const liveModelQuery = z.object({
    query: z.string().max(200).default(''),
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(20).default(20),
    source: z.string().max(64).default('all'),
  });
  add({
    name: 'list_live2d_models',
    title: '查找人偶形象',
    description:
      '创建人偶前查询官方、自有和已启用的远端 Live2D 形象。query 按名称、ID、风格、来源搜索；source 可填来源 ID、local 或 all。返回 models、total、nextOffset，远端条目附来源与使用范围；sources 列出远端加载状态。用 create_persona.liveModelId 选择，服务端会校验并应用完整配置。',
    category: 'live',
    inputSchema: z.toJSONSchema(liveModelQuery) as Record<string, any>,
    schema: liveModelQuery,
    execute: async ({ query, offset, limit, source }) => {
      const search = query.trim().toLowerCase();
      const catalog =
        source === 'local'
          ? { models: liveModelCatalog(ctx.settings), sources: [] }
          : await ctx.liveModels.catalog(ctx.settings, ctx.workspace);
      const matches = catalog.models.filter(
        (m) =>
          (source === 'all' || source === 'local' || m.sourceId === source) &&
          [m.id, m.name, m.description, m.sourceName || ''].some((text) =>
            text.toLowerCase().includes(search),
          ),
      );
      const models: { id: string; name: string; description: string }[] = [];
      for (const { id, name, description, sourceId, sourceName, license } of matches.slice(
        offset,
        offset + limit,
      )) {
        const item = {
          id,
          name,
          description,
          ...(sourceId ? { sourceId } : {}),
          ...(sourceName ? { sourceName } : {}),
          ...(license ? { license } : {}),
        };
        // Keep valid JSON below the Agent's tool-result budget, even for heavily
        // escaped metadata. Configuration stays on the server until selection.
        if (JSON.stringify([...models, item]).length > 16000) break;
        models.push(item);
      }
      return {
        models,
        total: matches.length,
        nextOffset: offset + models.length < matches.length ? offset + models.length : null,
        ...(catalog.sources.length
          ? {
              sources: catalog.sources.map(({ id, status, error }) => ({
                id,
                status,
                ...(error ? { error: error.slice(0, 160) } : {}),
              })),
            }
          : {}),
      };
    },
  });
  const personaInput = z.object({
    name: z.string().min(1).max(50),
    description: z.string().max(1500),
    systemPrompt: z.string().min(1).max(16000),
    mode: z.enum(['companion', 'work']),
    language: z.string().max(100).optional(),
    greeting: z.string().max(1000).optional(),
    voice: z.string().max(200).optional(),
    voiceLanguage: speechLanguageSchema.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    tools: z.array(z.string().max(64)).max(50).optional(),
    live: liveSchema.partial().optional(),
    liveModelId: z.string().max(80).optional(),
  });
  add({
    name: 'create_persona',
    title: '创造新伙伴',
    description:
      '生成人偶卡作品，用户预览后安装。先用 list_live2d_models 查找匹配的形象，通过 liveModelId 选用。可设计人格、语言、音色、工具和 Live2D 参数，也可提供自有模型的 live.modelUrl。',
    category: 'live',
    inputSchema: z.toJSONSchema(personaInput) as Record<string, any>,
    schema: personaInput,
    execute: async (args) => {
      const shape = args.liveModelId
        ? await ctx.liveModels.resolve(ctx.settings, ctx.workspace, args.liveModelId, ctx.signal)
        : undefined;
      if (args.liveModelId && !shape) throw Error('形象不存在，请调用 list_live2d_models 重新选择');
      const persona = personaSchema.parse({
        ...ctx.persona,
        ...args,
        id: randomUUID(),
        subtitle: args.description.slice(0, 60),
        greeting: args.greeting || `你好，我是${args.name}。`,
        live: { ...(shape?.live || ctx.persona.live), ...args.live },
        tools:
          args.tools ||
          (args.mode === 'work' ? builtInNames : ['set_emotion', 'remember', 'list_tools']),
      });
      return artifact(ctx, 'persona', persona.name, {
        persona,
        ...(shape ? { liveModel: shape } : {}),
      });
    },
  });
  const imageProvider = ctx.settings.providers.find(
    (p) => p.id === ctx.settings.imageProvider && p.kind === 'image' && p.enabled !== false,
  );
  add({
    name: 'generate_image',
    title: '生成图像',
    description: '使用已配置的图像模型生成图片。参考图使用 image 参数传入 data URL，可选。',
    category: 'create',
    approval: true,
    available: !!(imageProvider && ctx.settings.imageModel),
    inputSchema: object(
      {
        prompt: text('完整图像描述', 12000),
        size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
        image: text('可选的参考图片 data URL', 12000000),
      },
      ['prompt'],
    ),
    schema: z.object({
      prompt: z.string().min(1).max(12000),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
      image: z.string().max(12000000).optional(),
    }),
    execute: async ({ prompt, size, image }) => {
      if (!imageProvider) throw Error('请先连接生图服务');
      const provider = withProviderKey(imageProvider);
      let images: string[] = [];
      if (imageProvider.protocol === 'gemini') {
        const parts: any[] = [{ text: prompt }];
        if (image) {
          const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(image);
          if (!match) throw Error('参考图格式无效');
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
        const data = await readJson(
          await network(
            endpoint(
              imageProvider.baseUrl,
              `models/${encodeURIComponent(ctx.settings.imageModel)}:generateContent`,
            ),
            {
              method: 'POST',
              signal: ctx.signal,
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': provider.apiKey || '',
              },
              body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
              }),
            },
          ),
          48_000_000,
        );
        for (const part of data.candidates?.[0]?.content?.parts || [])
          if (part.inlineData)
            images.push(
              await media(
                `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                ctx.signal,
                'image',
              ),
            );
      } else {
        let body: BodyInit;
        let path = 'images/generations';
        const headers: Record<string, string> = {
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        };
        if (image) {
          path = 'images/edits';
          const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(image);
          if (!match) throw Error('参考图格式无效');
          const form = new FormData();
          form.set('model', ctx.settings.imageModel);
          form.set('prompt', prompt);
          form.set('size', size);
          form.set('n', '1');
          form.set(
            'image',
            new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }),
            'reference.png',
          );
          body = form;
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({ model: ctx.settings.imageModel, prompt, size, n: 1 });
        }
        const data = await readJson(
          await network(endpoint(imageProvider.baseUrl, path), {
            method: 'POST',
            signal: ctx.signal,
            headers,
            body,
          }),
          48_000_000,
        );
        for (const entry of (data.data || []).slice(0, 4))
          images.push(
            await media(
              entry.b64_json ? `data:image/png;base64,${entry.b64_json}` : entry.url,
              ctx.signal,
              'image',
            ),
          );
      }
      if (!images.length) throw Error('服务未返回图片，请检查模型是否支持生图');
      return artifact(ctx, 'image', prompt.slice(0, 50), {
        prompt,
        size,
        model: ctx.settings.imageModel,
        images,
      });
    },
  });
  const musicProvider = ctx.settings.providers.find(
    (p) => p.id === ctx.settings.musicProvider && p.kind === 'music' && p.enabled !== false,
  );
  add({
    name: 'generate_music',
    title: '生成音乐',
    description:
      '调用音乐服务生成音频。兼容 POST audio/generations 的同步音频服务；不宣称通用 Suno 支持。',
    category: 'create',
    approval: true,
    available: !!(musicProvider && ctx.settings.musicModel),
    inputSchema: object(
      {
        prompt: text('曲风、乐器、情绪和编排', 8000),
        lyrics: text('可选歌词', 8000),
        duration: { type: 'integer', minimum: 5, maximum: 180 },
      },
      ['prompt'],
    ),
    schema: z.object({
      prompt: z.string().min(1).max(8000),
      lyrics: z.string().max(8000).optional(),
      duration: z.number().int().min(5).max(180).default(30),
    }),
    execute: async ({ prompt, lyrics, duration }) => {
      if (!musicProvider) throw Error('请先连接音乐服务');
      const provider = withProviderKey(musicProvider);
      const data = await readJson(
        await network(endpoint(musicProvider.baseUrl, 'audio/generations'), {
          method: 'POST',
          signal: ctx.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: ctx.settings.musicModel, prompt, lyrics, duration }),
        }),
        48_000_000,
      );
      const entry = data.data?.[0] || data;
      const url =
        entry.audio_url ||
        entry.url ||
        (entry.b64_json ? `data:audio/mpeg;base64,${entry.b64_json}` : '');
      if (!url) throw Error('服务未返回音频。此适配要求同步返回 audio_url/url/b64_json');
      const audio = await media(url, ctx.signal, 'audio');
      return artifact(ctx, 'music', prompt.slice(0, 50), {
        prompt,
        lyrics,
        duration,
        model: ctx.settings.musicModel,
        audio,
      });
    },
  });
  for (const custom of ctx.settings.customTools.filter((t) => t.enabled)) {
    if (map.has(custom.name)) continue;
    add({
      name: custom.name,
      title: custom.title,
      description: custom.description,
      inputSchema: custom.inputSchema,
      category: 'custom',
      available: true,
      approval: true,
      execute: async (args) => {
        const ajv = new Ajv({ strict: false, allErrors: false });
        const validate = ajv.compile(custom.inputSchema);
        if (!validate(args)) throw Error('工具参数不符合注册时的 JSON Schema');
        return readJson(
          await network(custom.endpoint, {
            method: 'POST',
            signal: ctx.signal,
            headers: {
              'Content-Type': 'application/json',
              ...(custom.apiKey ? { Authorization: `Bearer ${custom.apiKey}` } : {}),
            },
            body: JSON.stringify(args),
          }),
          1_000_000,
        );
      },
    });
  }
  return map;
}
const allowed = (ctx: Context, name: string) =>
  name === 'list_tools' ||
  (name === 'list_live2d_models' && ctx.persona.tools.includes('create_persona')) ||
  (name === 'list_marp_themes' && ctx.persona.tools.includes('create_slides')) ||
  (name === 'list_skins' && ctx.persona.tools.includes('create_skin')) ||
  ctx.persona.tools.includes(name);
export function toolList(ctx: Context): ToolInfo[] {
  return [...registry(ctx).values()].map(({ execute, schema, approval, ...t }) => t);
}
export function functionTools(ctx: Context): FunctionTool[] {
  return [...registry(ctx).values()]
    .filter((t) => t.available && allowed(ctx, t.name))
    .map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
}
export async function executeTool(name: string, args: unknown, ctx: Context, manual = false) {
  const tool = registry(ctx).get(name);
  if (!tool || !tool.available || (!manual && !allowed(ctx, name)))
    throw Error('工具不可用或未对当前人偶开放');
  const parsed = tool.schema ? tool.schema.parse(args) : args;
  if (!manual && tool.approval && ctx.settings.toolPermission === 'ask') {
    if (!ctx.approve || !(await ctx.approve(name, parsed)))
      return {
        declined: true,
        message: '用户未允许这次工具调用，请继续沟通，不要再次执行同一操作。',
      };
  }
  try {
    return await tool.execute(parsed, ctx);
  } catch (error) {
    throw Error(
      safeError(error, [
        ...ctx.settings.providers.flatMap((p) => [p.apiKey, ...(p.keys || [])]),
        ...ctx.settings.customTools.map((t) => t.apiKey),
        ctx.settings.searchKey,
        ...(ctx.settings.searchKeys || []),
        ctx.settings.sakta?.token,
      ]),
    );
  }
}

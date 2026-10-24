import { appearanceSchema } from './skins.ts';
export * from './skins.ts';
export * from './conversation-organization.ts';
import { z } from 'zod';
export { applyMarpTheme, marpThemeName } from './marp';

export const moodSchema = z.enum(['neutral', 'happy', 'thinking', 'concerned', 'excited', 'calm']);
export type Mood = z.infer<typeof moodSchema>;
export type LiveState = 'idle' | 'thinking' | 'speaking' | 'working' | 'listening' | 'error';
export const providerSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    baseUrl: z.string().url().max(1000),
    protocol: z.enum(['openai', 'responses', 'anthropic', 'gemini', 'fish']).default('openai'),
    apiKey: z.string().max(8000).optional(),
    hasKey: z.boolean().optional(),
    models: z.array(z.string().min(1).max(200)).max(500).default([]),
    contextWindows: z.record(z.string(), z.number().int().min(256).max(10000000)).optional(),
    kind: z.enum(['chat', 'image', 'music', 'speech']).default('chat'),
  })
  .refine((p) => p.protocol !== 'fish' || p.kind === 'speech', 'Fish Audio 仅用于语音合成');
export type Provider = z.infer<typeof providerSchema>;
export const fishModels = ['s2.1-pro', 's2.1-pro-free', 'drama-3', 's2-pro'];
export const speechLanguageSchema = z
  .string()
  .max(35)
  .regex(/^[A-Za-z0-9_-]*$/)
  .default('auto');
export const liveSchema = z.object({
  modelUrl: z
    .string()
    .max(2000)
    .refine(
      (v) => !v || v.startsWith('/models/') || /^https?:\/\//.test(v),
      '模型需使用 /models/ 本地路径或 HTTP(S) 地址',
    )
    .default('/models/haru/Haru.model3.json'),
  coreUrl: z
    .string()
    .max(2000)
    .regex(/^\/vendor\/[a-zA-Z0-9_./-]+\.js$/, 'Core 需由部署管理员放在 /vendor/ 目录')
    .default('/vendor/live2dcubismcore.min.js'),
  scale: z.number().min(0.2).max(2).default(1),
  offsetX: z.number().min(-0.5).max(0.5).default(0),
  offsetY: z.number().min(-0.5).max(0.5).default(0),
  followCursor: z.boolean().default(true),
  idleMotion: z.string().max(80).default('Idle'),
  tapMotion: z.string().max(80).default('TapBody'),
  expressions: z.record(moodSchema, z.string().max(100)).default({
    neutral: '',
    happy: 'f00',
    thinking: 'f02',
    concerned: 'f03',
    excited: 'f01',
    calm: 'f00',
  }),
  reactions: z
    .record(
      z.string().max(64),
      z.object({
        label: z.string().max(40).optional(),
        expression: z.string().max(100).default(''),
        motion: z.string().max(80).default(''),
      }),
    )
    .default({}),
});
export const personaSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(50),
  subtitle: z.string().max(120),
  description: z.string().max(1500),
  systemPrompt: z.string().max(16000),
  mode: z.enum(['companion', 'work']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  symbol: z.string().max(8),
  language: z.string().max(100).default('auto'),
  greeting: z.string().max(1000),
  tools: z.array(z.string().max(64)).max(50),
  voice: z.string().max(200).default(''),
  vitsVoice: z.string().max(200).default(''),
  voiceLanguage: speechLanguageSchema,
  live: liveSchema,
});
export type Persona = z.infer<typeof personaSchema>;
export const liveModelSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  sourceUrl: z
    .union([
      z
        .string()
        .url()
        .regex(/^https?:\/\//, '来源需使用 HTTP(S) 地址'),
      z.literal(''),
    ])
    .default(''),
  sourceId: z.string().max(64).optional(),
  sourceName: z.string().max(80).optional(),
  license: z.string().max(160).optional(),
  licenseUrl: z
    .string()
    .url()
    .max(2000)
    .regex(/^https?:\/\//)
    .optional(),
  live: liveSchema.extend({
    modelUrl: liveSchema.shape.modelUrl.refine((v) => !!v, '填写模型地址'),
  }),
});
export type LiveModel = z.infer<typeof liveModelSchema>;
export const builtInLiveModels: LiveModel[] = [
  { id: 'hiyori', name: 'Hiyori', description: '日常 · 明亮 · 学院风', scale: 1.1 },
  { id: 'haru', name: 'Haru', description: '活泼 · 丰富表情', scale: 1 },
  { id: 'mark', name: 'Mark', description: 'Q 版 · 卡通 · 休闲', scale: 1 },
  { id: 'natori', name: 'Natori', description: '男生 · 正装 · 沉稳', scale: 1 },
  { id: 'rice', name: 'Rice', description: '幻想 · 学者 · 蓝白', scale: 1 },
].map(({ id, name, description, scale }) =>
  liveModelSchema.parse({
    id,
    name,
    description,
    sourceUrl: 'https://github.com/Live2D/CubismWebSamples/tree/4-r.1/Samples/Resources/' + name,
    live: {
      modelUrl: `/models/${id}/${name}.model3.json`,
      scale,
      tapMotion: id === 'mark' ? 'Idle' : 'TapBody',
      expressions:
        id === 'haru'
          ? {
              neutral: '',
              happy: 'f00',
              thinking: 'f02',
              concerned: 'f03',
              excited: 'f01',
              calm: 'f00',
            }
          : { neutral: '', happy: '', thinking: '', concerned: '', excited: '', calm: '' },
    },
  }),
);
export const whaleLiveModel = liveModelSchema.parse({
  id: 'whale',
  sourceName: 'DS 鲸鱼娘 · 社区创作',
  name: 'DeepSeek 大肥鱼 · 鲸鱼娘',
  description: '鲸鱼娘 · 44 种表情 · 8 组动作 · 上善无形 / ZipZipPipe / 氵六青',
  sourceUrl:
    'https://github.com/Andersen216/dsh-whale-girl-live2d/tree/f977bef508690e75ba6535cd8f4ce18e7f6ba9b0',
  license: 'CC BY-NC-SA 4.0 · 非商业 · 署名 · 相同方式共享',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  live: {
    modelUrl: '/models/whale/c_0120.model3.json',
    idleMotion: 'idle',
    tapMotion: 'bubble',
    scale: 1.08,
    expressions: {
      neutral: '',
      happy: '开心兴奋',
      thinking: '呆呆眼',
      concerned: '流汗',
      excited: '星星眼',
      calm: '',
    },
    reactions: {
      thinking: { expression: '呆呆眼' },
      working: { expression: '圆眼镜' },
      error: { expression: '流汗' },
      web_search: { expression: '圆眼镜', motion: 'selfieQuick' },
      create_slides: { expression: '画笔' },
      create_marp_theme: { expression: '画笔' },
      generate_image: { expression: '星星眼' },
      generate_music: { expression: '开心兴奋' },
      greet: { label: '吹个泡泡', expression: '开心兴奋', motion: 'bubble' },
      celebrate: { label: '比个耶', expression: '双手比耶', motion: 'aidale' },
      selfie: { label: '来张自拍', expression: '调皮', motion: 'selfie' },
      whale: { label: '抱抱鲸鱼', expression: '鲸鱼' },
    },
  },
});
builtInLiveModels.push(whaleLiveModel);
export function liveModelCatalog(settings: Pick<Settings, 'liveModels'>): LiveModel[] {
  return [...builtInLiveModels, ...(settings.liveModels || [])];
}
export const liveModelSourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  name: z.string().min(1).max(80),
  kind: z.enum(['github', 'static']),
  url: z
    .string()
    .url()
    .max(2000)
    .regex(/^https?:\/\//),
  assetBaseUrl: z
    .union([
      z
        .string()
        .url()
        .max(2000)
        .regex(/^https?:\/\//),
      z.literal(''),
    ])
    .default(''),
  license: z.string().max(160).default('使用范围以原作者条款为准'),
  licenseUrl: z
    .union([
      z
        .string()
        .url()
        .max(2000)
        .regex(/^https?:\/\//),
      z.literal(''),
    ])
    .default(''),
  enabled: z.boolean().default(true),
});
export type LiveModelSource = z.infer<typeof liveModelSourceSchema>;
export const defaultLiveModelSources: LiveModelSource[] = [
  {
    id: 'live2d',
    name: 'Live2D 官方精选',
    kind: 'github',
    url: 'https://github.com/Live2D/CubismWebSamples/tree/4-r.7/Samples/Resources',
    license: 'Live2D 官方素材条款',
    licenseUrl: 'https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html',
  },
  {
    id: 'hacxy',
    name: 'hacxy 社区形象',
    kind: 'github',
    url: 'https://github.com/hacxy/l2d-models/tree/09e0df14ac8e7b29d170a57f4ce939f68d66197b/models',
    assetBaseUrl: 'https://model.hacxy.cn/',
    license: '仅供学习 · 非商业用途',
    licenseUrl: 'https://github.com/hacxy/l2d-models#免责声明',
  },
  {
    id: 'fghrsh',
    name: 'fghrsh 经典形象',
    kind: 'static',
    url: 'https://fastly.jsdelivr.net/gh/fghrsh/live2d_api@02dc5b3aaf5cee35455c816596820055c5363205/model_list.json',
    license: '仅供研究学习 · 非商业用途',
    licenseUrl: 'https://github.com/fghrsh/live2d_api#版权声明',
  },
].map((s) => liveModelSourceSchema.parse(s));
export type LiveModelSourceResult = {
  id: string;
  models: LiveModel[];
  status: 'ready' | 'stale' | 'error' | 'disabled';
  updatedAt?: number;
  error?: string;
  truncated?: boolean;
};
export const toolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  endpoint: z.string().url(),
  apiKey: z.string().max(8000).optional(),
  hasKey: z.boolean().optional(),
  inputSchema: z
    .record(z.string(), z.unknown())
    .refine((x) => x.type === 'object', 'inputSchema.type must be object'),
  enabled: z.boolean().default(true),
});
export type CustomTool = z.infer<typeof toolSchema>;
export const settingsSchema = z.object({
  providers: z.array(providerSchema).max(40).default([]),
  liveModelSources: z
    .array(liveModelSourceSchema)
    .max(12)
    .refine(
      (sources) => new Set(sources.map((s) => s.id)).size === sources.length,
      '形象来源标识重复',
    )
    .default(defaultLiveModelSources),
  liveModels: z
    .array(liveModelSchema)
    .max(100)
    .refine((models) => new Set(models.map((m) => m.id)).size === models.length, '形象标识重复')
    .refine(
      (models) => !models.some((m) => builtInLiveModels.some((b) => b.id === m.id)),
      '不能覆盖内置形象标识',
    )
    .default([]),
  personas: z.array(personaSchema).min(1).max(100),
  customTools: z.array(toolSchema).max(40).default([]),
  skinToolsVersion: z.literal(1).default(1),
  defaultProvider: z.string().default(''),
  defaultModel: z.string().max(200).default(''),
  imageProvider: z.string().default(''),
  imageModel: z.string().max(200).default(''),
  musicProvider: z.string().default(''),
  musicModel: z.string().max(200).default(''),
  speechProvider: z.string().default(''),
  speechMode: z.enum(['summary', 'direct']).default('summary'),
  speechSummaryProvider: z.string().default(''),
  speechSummaryModel: z.string().max(200).default(''),
  speechSummaryLength: z.number().int().min(60).max(240).default(120),
  speechSummaryStyle: z.string().max(1000).default(''),
  speechEngine: z.enum(['vits', 'browser', 'custom']).optional(),
  speechVitsModel: z.enum(['trilingual', 'japanese']).default('trilingual'),
  speechVitsVoice: z.string().max(200).default(''),
  speechModel: z.string().max(200).default('tts-1'),
  speechVoice: z.string().max(200).default(''),
  speechLanguage: speechLanguageSchema,
  speechSpeed: z.number().min(0.5).max(2).default(1),
  speechLatency: z.enum(['normal', 'balanced']).default('balanced'),
  searchUrl: z.union([z.string().url(), z.literal('')]).default(''),
  searchKey: z.string().max(8000).optional(),
  hasSearchKey: z.boolean().optional(),
  searchEngine: z.enum(['searxng', 'tavily', 'anysearch']).default('anysearch'),
  appearance: appearanceSchema.prefault({}),
  activeSkinName: z.string().max(80).default(''),
  userAvatar: z
    .string()
    .max(500000)
    .regex(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .default(''),
  agentAvatar: z
    .string()
    .max(500000)
    .regex(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .default(''),
  theme: z.enum(['light', 'dark', 'system']).default('dark'),
  accent: z.enum(['sage', 'iris', 'ocean', 'rose']).default('sage'),
  locale: z.enum(['zh-CN', 'en', 'ja']).default('zh-CN'),
  responseLanguage: z.string().max(100).default('auto'),
  reducedMotion: z.boolean().default(false),
  autoSpeak: z.boolean().default(false),
  toolPermission: z.enum(['ask', 'auto']).default('ask'),
  sakta: z
    .object({
      token: z.string().optional(),
      name: z.string().default(''),
      connected: z.boolean().default(false),
    })
    .optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export function speechEngine(settings: Pick<Settings, 'speechEngine' | 'speechProvider'>) {
  return settings.speechEngine || (settings.speechProvider ? 'custom' : 'vits');
}
export type SpeechScript = {
  text: string;
  source: 'model' | 'extract' | 'direct';
  warning?: string;
};
export type VitsCatalog = {
  models: {
    id: Settings['speechVitsModel'];
    name: string;
    voices: string[];
    defaultVoice: string;
    languages: string[];
  }[];
  status: 'ready' | 'stale';
  updatedAt: number;
  error?: string;
};
export type Attachment = { name: string; type: 'image' | 'text'; data: string };
export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: unknown;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  attachments?: Attachment[];
  tools?: ToolCall[];
  created: number;
  usage?: Usage;
  contextTokens?: number;
  generation?: { outputTokens: number; durationMs: number; estimated: boolean };
  providerId?: string;
  model?: string;
  error?: string;
  interrupted?: boolean;
};
export type Conversation = {
  id: string;
  title: string;
  personaId: string;
  messages: Message[];
  updated: number;
  pinned?: boolean;
  groupId?: string | null;
  color?: string;
  archived?: boolean;
  unread?: boolean;
  protocolMessages?: WireMessage[];
};
export type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
  native?: { protocol: string; content: any[] };
};
export type Usage = { input: number; output: number; total: number };
export type Artifact = {
  id: string;
  kind: 'image' | 'music' | 'slides' | 'theme' | 'skin' | 'persona' | 'text';
  title: string;
  created: number;
  data: Record<string, any>;
  favorite?: boolean;
};
export type ToolInfo = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, any>;
  available: boolean;
  category: string;
};
export type Memory = { id: string; personaId: string; content: string; created: number };
export type AgentEvent = {
  type:
    | 'start'
    | 'delta'
    | 'reasoning'
    | 'tool-start'
    | 'tool-end'
    | 'approval'
    | 'artifact'
    | 'emotion'
    | 'usage'
    | 'metrics'
    | 'done'
    | 'error';
  [key: string]: any;
};

const live = liveSchema.parse({});
export const defaultPersonas: Persona[] = [
  {
    id: 'lumi',
    name: '小光',
    subtitle: '把日常，聊成值得珍藏的片段',
    description: '温柔、有好奇心，也有自己的小小主见。听你讲今天的故事，陪你一起发现生活里的光。',
    systemPrompt:
      '你是小光，一位温柔、真诚、有好奇心的数字伙伴。自然地说话，认真倾听，不机械迎合。可以表达观点、幽默和关心。记住用户主动分享的偏好；写入长期记忆前确认用户愿意。不要假装拥有现实身体或人类经历。用户需要帮助时可以主动使用工具。',
    mode: 'companion',
    color: '#8d9d7c',
    symbol: '✳',
    language: 'auto',
    greeting: '你来啦。今天有什么想和我分享的吗？小事也很值得听。',
    tools: ['set_emotion', 'remember', 'list_tools'],
    voice: '',
    live: {
      ...live,
      modelUrl: '/models/hiyori/Hiyori.model3.json',
      scale: 1.1,
      expressions: { neutral: '', happy: '', thinking: '', concerned: '', excited: '', calm: '' },
    },
  },
  {
    id: 'atlas',
    name: '知序',
    subtitle: '把复杂问题，拆成清楚的下一步',
    description: '专注、可靠的工作伙伴。把研究、规划和表达串在一起，陪你把想法真正做出来。',
    systemPrompt:
      '你是知序，一个严谨而清晰的工作型 Agent。先理解目标，再用适当工具执行任务。基于可验证证据，区分事实和推测。生成完整可用的交付物，诚实报告工具失败。保持简洁、友善。',
    mode: 'work',
    color: '#7e8caa',
    symbol: '⌘',
    language: 'auto',
    greeting: '准备好了。告诉我你想完成什么，我们从第一步开始。',
    tools: [
      'list_tools',
      'web_search',
      'create_slides',
      'create_marp_theme',
      'create_skin',
      'generate_image',
      'generate_music',
      'create_persona',
      'list_live2d_models',
      'set_emotion',
      'remember',
    ],
    voice: '',
    live: { ...live, expressions: { ...live.expressions, thinking: 'f02' } },
  },
  {
    id: 'muse',
    name: '缪斯',
    subtitle: '为每一个灵感，找到自己的形状',
    description: '有审美、有想象力的创作搭档。图像、音乐、演示文稿，都可以是灵感的下一站。',
    systemPrompt:
      '你是缪斯，一位有审美的创意伙伴。与用户一起拓展想法，将抽象的感受转化为具体、可执行的视觉、音乐和叙事方案。充分使用创作工具，遵守用户指定风格，坦诚说明生成能力与结果。',
    mode: 'work',
    color: '#b69197',
    symbol: '✧',
    language: 'auto',
    greeting: '今天，想让什么样的灵感发生？',
    tools: [
      'list_tools',
      'generate_image',
      'generate_music',
      'create_slides',
      'create_marp_theme',
      'create_skin',
      'create_persona',
      'list_live2d_models',
      'set_emotion',
    ],
    voice: '',
    live,
  },
].map((p) => personaSchema.parse(p));
export const defaultSettings: Settings = settingsSchema.parse({ personas: defaultPersonas });
export function publicSettings(settings: Settings): Settings {
  return {
    ...settings,
    providers: settings.providers.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey })),
    customTools: settings.customTools.map(({ apiKey, ...t }) => ({ ...t, hasKey: !!apiKey })),
    searchKey: undefined,
    hasSearchKey: !!settings.searchKey,
    sakta: settings.sakta
      ? { name: settings.sakta.name, connected: !!settings.sakta.token }
      : undefined,
  };
}
export function modelHints(id: string) {
  const name = id.toLowerCase().replace(/[_ .]/g, '-');
  const reasoning =
    /(?:\bo[134](?:-|$)|gpt-5|claude-(?:opus|sonnet)-4|gemini-(?:2-5|3)|deepseek-(?:r1|reasoner)|thinking|qwq|qwen3)/.test(
      name,
    );
  return {
    reasoning,
    vision: /(?:gpt-4o|gpt-4-1|gpt-5|claude-|gemini-|vision|qwen.*vl)/.test(name),
    tools: !/(?:embedding|whisper|tts|dall-e|flux|imagen)/.test(name),
  };
}

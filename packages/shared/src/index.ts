import { z } from 'zod';

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
  voiceLanguage: speechLanguageSchema,
  live: liveSchema,
});
export type Persona = z.infer<typeof personaSchema>;
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
  personas: z.array(personaSchema).min(1).max(100),
  customTools: z.array(toolSchema).max(40).default([]),
  defaultProvider: z.string().default(''),
  defaultModel: z.string().max(200).default(''),
  imageProvider: z.string().default(''),
  imageModel: z.string().max(200).default(''),
  musicProvider: z.string().default(''),
  musicModel: z.string().max(200).default(''),
  speechProvider: z.string().default(''),
  speechModel: z.string().max(200).default('tts-1'),
  speechVoice: z.string().max(200).default(''),
  speechLanguage: speechLanguageSchema,
  speechSpeed: z.number().min(0.5).max(2).default(1),
  speechLatency: z.enum(['normal', 'balanced']).default('balanced'),
  searchUrl: z.union([z.string().url(), z.literal('')]).default(''),
  searchKey: z.string().max(8000).optional(),
  hasSearchKey: z.boolean().optional(),
  searchEngine: z.enum(['searxng', 'tavily']).default('searxng'),
  theme: z.enum(['light', 'dark', 'system']).default('light'),
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
  kind: 'image' | 'music' | 'slides' | 'theme' | 'persona' | 'text';
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
      'generate_image',
      'generate_music',
      'create_persona',
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
      'create_persona',
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

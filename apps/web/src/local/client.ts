import { z } from 'zod';
import {
  settingsSchema,
  conversationBeforeMessage,
  type AgentEvent,
  type Conversation,
} from '@livra/shared';
import { runAgent, runs, resolveProvider, type Run } from '@livra/runtime/agent';
import { safeError } from '@livra/runtime/network';
import { BrowserStore } from './store';
import { createLocalCommands, workspace } from './commands';

let runtime: ReturnType<typeof initialize> | undefined;
async function initialize() {
  const store = await BrowserStore.open();
  if (!store.initialized) {
    // Only the local upgrade server advertises this endpoint. Static deployments
    // start without a migration request or any API/server dependency.
    if (
      typeof document !== 'undefined' &&
      document.querySelector('meta[name="livra-legacy-migration"]')
    ) {
      const response = await fetch('/__livra_migration', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Livra-Migration': 'local' },
      });
      if (!response.ok) throw Error('原空间迁移失败；原数据仍保留，请重新加载以重试。');
      const snapshot = await response.json();
      if (snapshot) {
        const settings = settingsSchema.parse(snapshot.settings);
        const records = z
          .array(z.object({ kind: z.string(), value: z.object({ id: z.string() }).passthrough() }))
          .parse(snapshot.records);
        await store.batch(() => {
          for (const record of records) store.put(workspace, record.kind, record.value);
          store.saveSettings(workspace, settings);
        });
      }
    }
    if (!store.initialized) {
      store.saveSettings(workspace, store.settings(workspace));
      await store.flush();
    }
  }
  return { store, ...createLocalCommands(store) };
}
function getRuntime() {
  if (!runtime)
    runtime = initialize().catch((error) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
}
export async function localCommand<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { store, app } = await getRuntime();
  try {
    const result = await app.execute(path, options);
    await store.flush();
    return result;
  } catch (error) {
    if (error instanceof z.ZodError)
      throw Error(
        '参数格式有误：' +
          error.issues
            .slice(0, 3)
            .map((issue) => issue.message)
            .join('；'),
      );
    const settings = store.settings(workspace);
    const message = safeError(error, [
      ...settings.providers.flatMap((p) => [p.apiKey, ...(p.keys || [])]),
      ...settings.customTools.map((t) => t.apiKey),
      settings.searchKey,
      settings.sakta?.token,
    ]);
    throw Object.assign(Error(message), { statusCode: (error as any)?.statusCode });
  }
}

const runInput = z.object({
  conversationId: z.string().uuid(),
  providerId: z.string(),
  model: z.string().min(1).max(200),
  content: z.string().max(100000),
  reasoning: z.string().min(1).max(80).optional(),
  editMessageId: z.string().uuid().optional(),
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
});
export async function localRun(
  body: unknown,
  signal: AbortSignal,
  emit: (event: AgentEvent) => void,
) {
  const input = runInput.parse(body);
  const { store, context } = await getRuntime();
  signal.throwIfAborted();
  const ctx = context(workspace, signal);
  const provider = resolveProvider(ctx.settings, input.providerId);
  if (!provider) throw Error('请连接自己的模型，或登录 Sakta 使用免费模型');
  if (!input.content.trim() && !input.attachments.length) throw Error('请输入消息或添加附件');
  if (
    input.attachments.some(
      (a) =>
        a.type === 'image' &&
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(a.data),
    )
  )
    throw Error('图片附件格式无效');
  const conversation = store.get<Conversation>(workspace, 'conversation', input.conversationId);
  if (!conversation) throw Error('对话不存在');
  if ([...runs.values()].some((run) => run.conversationId === conversation.id))
    throw Error('这段对话已有任务正在执行');
  const base = input.editMessageId
    ? conversationBeforeMessage(conversation, input.editMessageId)
    : conversation;
  ctx.persona =
    ctx.settings.personas.find((p) => p.id === conversation.personaId) || ctx.settings.personas[0];
  const run: Run = {
    id: crypto.randomUUID(),
    workspace,
    conversationId: conversation.id,
    controller: new AbortController(),
    approvals: new Map(),
  };
  runs.set(run.id, run);
  ctx.signal = AbortSignal.any([signal, run.controller.signal, AbortSignal.timeout(900_000)]);
  ctx.emit = emit;
  try {
    await runAgent(
      ctx,
      run,
      base,
      provider,
      input.model,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: input.content,
        attachments: input.attachments,
        created: Date.now(),
      },
      input.reasoning,
      !!input.editMessageId,
    );
  } finally {
    await store.flush();
  }
}

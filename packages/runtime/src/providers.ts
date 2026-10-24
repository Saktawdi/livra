const randomUUID = () => crypto.randomUUID();
import { fishModels, type Provider, type WireMessage, type Usage } from '@livra/shared';
import { endpoint, network, readJson } from './network.ts';
import { saktaRequest } from './sakta.ts';

export type FunctionTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, any> };
};
export type Completion = {
  content: string;
  reasoning: string;
  calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  usage?: Usage;
  streamDurationMs?: number;
  native?: { protocol: string; content: any[] };
};
export async function* sse(response: Response): AsyncGenerator<any> {
  if (!response.ok) {
    await readJson(response);
    return;
  }
  if (!response.body) throw Error('模型返回空响应');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  const parse = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw Error('模型返回了无法解析的流数据');
    }
    if (parsed.error)
      throw Error(String(parsed.error.message || parsed.error.type || '模型请求失败'));
    return parsed;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 8_000_000) throw Error('模型事件超过大小限制');
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const parsed = parse(frame);
        if (parsed) yield parsed;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const parsed = parse(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
const auth = (provider: Provider): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
});
export async function listModels(provider: Provider, signal?: AbortSignal) {
  if (provider.protocol === 'fish') return fishModels;
  let headers = auth(provider);
  delete headers['Content-Type'];
  if (provider.protocol === 'anthropic')
    headers = { 'x-api-key': provider.apiKey || '', 'anthropic-version': '2023-06-01' };
  if (provider.protocol === 'gemini') headers = { 'x-goog-api-key': provider.apiKey || '' };
  if (provider.protocol === 'anthropic' && typeof window !== 'undefined')
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const data = await readJson(
    await network(endpoint(provider.baseUrl, 'models'), { headers, signal }),
  );
  const entries = data.data || data.models || [];
  return [
    ...new Set<string>(
      entries
        .map((m: any) => String(m.id || m.name || '').replace(/^models\//, ''))
        .filter(Boolean),
    ),
  ].sort();
}
function anthropicMessages(messages: WireMessage[]) {
  const result: any[] = [];
  for (const m of messages.filter((m) => m.role !== 'system')) {
    let role = m.role === 'assistant' ? 'assistant' : 'user';
    let content: any[] = [];
    if (m.role === 'assistant' && m.native?.protocol === 'anthropic') content = m.native.content;
    else if (m.role === 'tool')
      content = [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content) }];
    else {
      if (typeof m.content === 'string' && m.content)
        content.push({ type: 'text', text: m.content });
      else if (Array.isArray(m.content))
        for (const part of m.content) {
          if (part.type === 'text') content.push({ type: 'text', text: part.text });
          if (part.type === 'image_url') {
            const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(part.image_url.url);
            if (match)
              content.push({
                type: 'image',
                source: { type: 'base64', media_type: match[1], data: match[2] },
              });
          }
        }
      for (const call of m.tool_calls || [])
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments || '{}'),
        });
    }
    if (!content.length) continue;
    if (result.at(-1)?.role === role) result.at(-1).content.push(...content);
    else result.push({ role, content });
  }
  return result;
}
function geminiMessages(messages: WireMessage[]) {
  const names = new Map<string, string>();
  const contents: any[] = [];
  for (const m of messages.filter((m) => m.role !== 'system')) {
    const parts: any[] = [];
    if (m.role === 'assistant' && m.native?.protocol === 'gemini') {
      for (const call of m.tool_calls || []) names.set(call.id, call.function.name);
      parts.push(...m.native.content);
    } else if (m.role === 'tool')
      parts.push({
        functionResponse: {
          name: names.get(m.tool_call_id!) || 'tool',
          response: { result: m.content },
        },
      });
    else {
      if (typeof m.content === 'string' && m.content) parts.push({ text: m.content });
      else if (Array.isArray(m.content))
        for (const part of m.content) {
          if (part.type === 'text') parts.push({ text: part.text });
          if (part.type === 'image_url') {
            const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(part.image_url.url);
            if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          }
        }
      for (const call of m.tool_calls || []) {
        names.set(call.id, call.function.name);
        parts.push({
          functionCall: {
            name: call.function.name,
            args: JSON.parse(call.function.arguments || '{}'),
          },
        });
      }
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}
function responseMessages(messages: WireMessage[]) {
  return messages.flatMap<any>((m) => {
    if (m.role === 'tool')
      return [{ type: 'function_call_output', call_id: m.tool_call_id, output: String(m.content) }];
    const result: any[] = [...(m.native?.protocol === 'responses' ? m.native.content : [])];
    if (m.content)
      result.push({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map((p: any) =>
              p.type === 'text'
                ? { type: 'input_text', text: p.text }
                : { type: 'input_image', image_url: p.image_url.url },
            )
          : m.content,
      });
    for (const call of m.tool_calls || [])
      result.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    return result;
  });
}
export async function complete(
  provider: Provider,
  model: string,
  messages: WireMessage[],
  tools: FunctionTool[],
  reasoning: string | undefined,
  signal: AbortSignal,
  emit: (type: 'delta' | 'reasoning', text: string) => void,
): Promise<Completion> {
  let path = 'chat/completions';
  let headers = auth(provider);
  const body: any = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools.length ? { tools } : {}),
    ...(reasoning && reasoning !== 'auto' ? { reasoning_effort: reasoning } : {}),
  };
  if (provider.protocol === 'responses') {
    path = 'responses';
    delete body.messages;
    delete body.stream_options;
    delete body.reasoning_effort;
    body.input = responseMessages(messages);
    body.store = false;
    body.include = ['reasoning.encrypted_content'];
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', ...t.function }));
    if (reasoning && reasoning !== 'auto') body.reasoning = { effort: reasoning };
  }
  if (provider.protocol === 'anthropic') {
    path = 'messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey || '',
      'anthropic-version': '2023-06-01',
      ...(typeof window !== 'undefined' ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
    };
    delete body.stream_options;
    delete body.reasoning_effort;
    body.messages = anthropicMessages(messages);
    body.system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    body.max_tokens = 8192;
    if (tools.length)
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    if (reasoning && reasoning !== 'auto' && reasoning !== 'none')
      body.thinking = {
        type: 'enabled',
        budget_tokens: reasoning === 'high' ? 4096 : reasoning === 'medium' ? 2048 : 1024,
      };
  }
  if (provider.protocol === 'gemini') {
    path = `models/${encodeURIComponent(model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey || '' };
    for (const key of Object.keys(body)) delete body[key];
    body.contents = geminiMessages(messages);
    body.systemInstruction = {
      parts: [
        {
          text: messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join('\n'),
        },
      ],
    };
    if (tools.length)
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
  }
  const request: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  };
  const response = await (provider.id === 'sakta'
    ? saktaRequest(path, request)
    : network(endpoint(provider.baseUrl, path), request));
  if (!response.ok) await readJson(response);
  const result: Completion = { content: '', reasoning: '', calls: [] };
  const calls = new Map<number, Completion['calls'][number]>();
  const nativeBlocks = new Map<number, any>();
  const nativeParts: any[] = [];
  let firstActivity = 0,
    lastActivity = 0;
  const output = (type: 'delta' | 'reasoning', text: unknown) => {
    if (typeof text !== 'string' || !text) return;
    result[type === 'delta' ? 'content' : 'reasoning'] += text;
    emit(type, text);
  };
  for await (const chunk of sse(response)) {
    if (signal.aborted) throw signal.reason;
    const delta = chunk.choices?.[0]?.delta;
    const activity =
      delta?.content ||
      delta?.reasoning_content ||
      delta?.reasoning ||
      delta?.tool_calls?.length ||
      /(?:output_text|reasoning_summary_text|function_call_arguments)\.delta$/.test(
        chunk.type || '',
      ) ||
      chunk.type === 'content_block_delta' ||
      chunk.candidates?.[0]?.content?.parts?.length;
    if (activity) {
      lastActivity = performance.now();
      firstActivity ||= lastActivity;
    }
    if (provider.protocol === 'openai') {
      const delta = chunk.choices?.[0]?.delta;
      output('delta', delta?.content);
      output('reasoning', delta?.reasoning_content || delta?.reasoning);
      for (const call of delta?.tool_calls || []) {
        const c = calls.get(call.index) || {
          id: '',
          type: 'function' as const,
          function: { name: '', arguments: '' },
        };
        if (call.id) c.id = call.id;
        if (call.function?.name) c.function.name += call.function.name;
        if (call.function?.arguments) c.function.arguments += call.function.arguments;
        calls.set(call.index, c);
      }
      if (chunk.usage)
        result.usage = {
          input: chunk.usage.prompt_tokens || 0,
          output: chunk.usage.completion_tokens || 0,
          total: chunk.usage.total_tokens || 0,
        };
    } else if (provider.protocol === 'responses') {
      if (chunk.type === 'response.output_text.delta') output('delta', chunk.delta);
      if (chunk.type === 'response.reasoning_summary_text.delta') output('reasoning', chunk.delta);
      if (chunk.type === 'response.output_item.done' && chunk.item?.type === 'reasoning')
        nativeParts.push(chunk.item);
      if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call')
        calls.set(chunk.output_index, {
          id: chunk.item.call_id,
          type: 'function',
          function: { name: chunk.item.name, arguments: chunk.item.arguments || '' },
        });
      if (chunk.type === 'response.function_call_arguments.delta') {
        const c = calls.get(chunk.output_index);
        if (c) c.function.arguments += chunk.delta;
      }
      if (chunk.type === 'response.failed')
        throw Error(chunk.response?.error?.message || 'Responses 请求失败');
      if (chunk.type === 'response.completed' && chunk.response?.usage) {
        const u = chunk.response.usage;
        result.usage = {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          total: u.total_tokens || 0,
        };
      }
    } else if (provider.protocol === 'anthropic') {
      if (chunk.type === 'content_block_start') {
        const block = structuredClone(chunk.content_block);
        nativeBlocks.set(chunk.index, block);
        if (block.type === 'tool_use')
          calls.set(chunk.index, {
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: Object.keys(block.input || {}).length ? JSON.stringify(block.input) : '',
            },
          });
      }
      if (chunk.type === 'content_block_delta') {
        output('delta', chunk.delta?.text);
        output('reasoning', chunk.delta?.thinking);
        if (chunk.delta?.partial_json) {
          const c = calls.get(chunk.index);
          if (c) c.function.arguments += chunk.delta.partial_json;
        }
        const block = nativeBlocks.get(chunk.index);
        if (block && chunk.delta?.text) block.text = (block.text || '') + chunk.delta.text;
        if (block && chunk.delta?.thinking)
          block.thinking = (block.thinking || '') + chunk.delta.thinking;
        if (block && chunk.delta?.signature)
          block.signature = (block.signature || '') + chunk.delta.signature;
      }
      const u = chunk.message?.usage || chunk.usage;
      if (u) {
        const prev = result.usage || { input: 0, output: 0, total: 0 };
        result.usage = {
          input: u.input_tokens ?? prev.input,
          output: u.output_tokens ?? prev.output,
          total: 0,
        };
        result.usage.total = result.usage.input + result.usage.output;
      }
    } else {
      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        nativeParts.push(part);
        output(part.thought ? 'reasoning' : 'delta', part.text);
        if (part.functionCall)
          calls.set(calls.size, {
            id: randomUUID(),
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          });
      }
      const u = chunk.usageMetadata;
      if (u)
        result.usage = {
          input: u.promptTokenCount || 0,
          output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
          total: u.totalTokenCount || 0,
        };
    }
  }
  result.calls = [...calls.values()].map((c) => ({
    ...c,
    id: c.id || randomUUID(),
    function: { ...c.function, arguments: c.function.arguments || '{}' },
  }));
  result.streamDurationMs = firstActivity ? Math.max(0, lastActivity - firstActivity) : 0;
  if (provider.protocol === 'anthropic' && nativeBlocks.size) {
    for (const [index, block] of nativeBlocks)
      if (block.type === 'tool_use')
        block.input = JSON.parse(calls.get(index)?.function.arguments || '{}');
    result.native = { protocol: 'anthropic', content: [...nativeBlocks.values()] };
  }
  if (nativeParts.length) result.native = { protocol: provider.protocol, content: nativeParts };
  if (!result.content && !result.calls.length && !result.reasoning)
    throw Error('模型返回空结果，请检查模型或服务商配置');
  return result;
}

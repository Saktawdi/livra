import { Buffer } from 'buffer';
import type { Settings, VitsCatalog } from '@livra/shared';
import { network, readJson } from './network.ts';

export const vitsOrigin = 'https://plachta-vits-umamusume-voice-synthesizer.hf.space';
export const vitsModels = [
  { id: 'trilingual', name: 'VITS · 中日英三语', api: 'tts_fn' },
  { id: 'japanese', name: 'VITS · 日语', api: 'tts_fn_1' },
] as const;

/** The public Space limits each call to 150 characters. Keep sentences where possible. */
export function speechSegments(text: string, limit = 140): string[] {
  const chars = Array.from(text.trim()),
    parts: string[] = [];
  while (chars.length) {
    let end = Math.min(limit, chars.length);
    if (end < chars.length) {
      for (let i = end - 1; i >= Math.floor(limit / 2); i--) {
        if (/[。！？.!?；;\n\s]/u.test(chars[i])) {
          end = i + 1;
          break;
        }
      }
    }
    const part = chars.splice(0, end).join('').trim();
    if (part) parts.push(part);
  }
  return parts;
}

function waveChunks(buffer: Buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw Error('VITS 未返回有效 WAV 音频');
  let fmt: Buffer | undefined;
  const chunks: Buffer[] = [];
  for (let at = 12; at + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', at, at + 4),
      size = buffer.readUInt32LE(at + 4),
      end = at + 8 + size;
    if (end > buffer.length) throw Error('VITS 音频不完整');
    if (name === 'fmt ') fmt = buffer.subarray(at + 8, end);
    if (name === 'data') chunks.push(buffer.subarray(at + 8, end));
    at = end + (size % 2);
  }
  if (!fmt || fmt.length < 16 || !chunks.length || ![1, 3].includes(fmt.readUInt16LE(0)))
    throw Error('VITS 音频编码不受支持');
  return { fmt, data: Buffer.concat(chunks) };
}
export function joinWaves(buffers: Buffer[]) {
  const waves = buffers.map(waveChunks),
    fmt = waves[0]?.fmt;
  if (!fmt || waves.some((w) => !w.fmt.equals(fmt))) throw Error('VITS 分段音频格式不一致');
  const data = Buffer.concat(waves.map((w) => w.data));
  if (data.length > 10_000_000) throw Error('语音超过 10 MB 大小限制');
  const fmtPad = fmt.length % 2,
    dataPad = data.length % 2;
  const result = Buffer.alloc(12 + 8 + fmt.length + fmtPad + 8 + data.length + dataPad);
  result.write('RIFF', 0);
  result.writeUInt32LE(result.length - 8, 4);
  result.write('WAVE', 8);
  result.write('fmt ', 12);
  result.writeUInt32LE(fmt.length, 16);
  fmt.copy(result, 20);
  const at = 20 + fmt.length + fmtPad;
  result.write('data', at);
  result.writeUInt32LE(data.length, at + 4);
  data.copy(result, at + 8);
  return result;
}

async function completeEvent(response: Response, signal: AbortSignal) {
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`VITS 排队连接失败（HTTP ${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('VITS 返回空响应');
  const decoder = new TextDecoder();
  let buffer = '',
    bytes = 0;
  const parse = (frame: string) => {
    const lines = frame.split('\n'),
      event = lines
        .find((l) => l.startsWith('event:'))
        ?.slice(6)
        .trim();
    if (event === 'error') throw Error('VITS 合成失败，公共服务可能繁忙，请稍后重试');
    if (event !== 'complete') return;
    const data = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    try {
      return JSON.parse(data);
    } catch {
      throw Error('VITS 返回无效的合成结果');
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      bytes += value?.length || 0;
      if (bytes > 1_000_000) throw Error('VITS 排队响应过大');
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = parse(frame);
        if (data !== undefined) return data;
      }
      if (done) {
        const data = parse(buffer);
        if (data !== undefined) return data;
        break;
      }
    }
    throw Error('VITS 排队连接中断，请重试');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class VitsService {
  private cached?: VitsCatalog;
  private pending?: Promise<VitsCatalog>;
  private active = new Set<string>();
  constructor(private fetcher: typeof network = network) {}
  private fetch(path: string, init: RequestInit = {}) {
    return this.fetcher(vitsOrigin + path, init, false, true);
  }
  async catalog(refresh = false): Promise<VitsCatalog> {
    if (!refresh && this.cached && Date.now() - this.cached.updatedAt < 600_000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const info = await readJson(
          await this.fetch('/gradio_api/info', { signal: AbortSignal.timeout(25_000) }),
        );
        const models = vitsModels.map((model) => {
          const parameters = info.named_endpoints?.['/' + model.api]?.parameters;
          if (
            !Array.isArray(parameters) ||
            parameters.map((p: any) => p.parameter_name).join(',') !==
              'text,speaker,language,speed,is_symbol'
          )
            throw Error('VITS 服务接口已变更，请更新适配');
          const speaker = parameters[1],
            languages = parameters[2].type?.enum;
          const voices = speaker.type?.enum;
          if (
            !Array.isArray(voices) ||
            !voices.length ||
            voices.length > 2000 ||
            voices.some((v) => typeof v !== 'string' || v.length > 200) ||
            !Array.isArray(languages) ||
            languages.some((l) => typeof l !== 'string')
          )
            throw Error('VITS 音色列表格式无效');
          return {
            id: model.id,
            name: model.name,
            voices,
            defaultVoice: voices.includes(speaker.parameter_default)
              ? speaker.parameter_default
              : voices[0],
            languages,
          };
        });
        return (this.cached = { models, status: 'ready', updatedAt: Date.now() });
      } catch (error) {
        if (this.cached)
          return {
            ...this.cached,
            status: 'stale',
            error: '远端暂不可用，显示上次获取的音色；可稍后刷新。',
          };
        throw Error('暂时无法加载 VITS 音色，公共 Space 可能休眠或繁忙，请稍后重试', {
          cause: error,
        });
      }
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  async synthesize(
    workspace: string,
    settings: Settings,
    text: string,
    voice: string,
    language: string,
    signal: AbortSignal,
  ) {
    if (this.active.has(workspace))
      throw Object.assign(Error('已有语音正在合成，请先停止或等待完成'), { statusCode: 409 });
    if (this.active.size >= 2)
      throw Object.assign(Error('VITS 正在为其他会话合成，请稍后重试'), { statusCode: 429 });
    this.active.add(workspace);
    try {
      signal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
      const catalog = await this.catalog();
      signal.throwIfAborted();
      const model = catalog.models.find((m) => m.id === settings.speechVitsModel)!;
      const chosen = voice || settings.speechVitsVoice || model.defaultVoice;
      if (!model.voices.includes(chosen))
        throw Object.assign(Error('该音色不属于当前 VITS 模型，请重新选择音色'), {
          statusCode: 400,
        });
      if (model.id === 'japanese' && language !== 'auto' && !/^ja(?:-|$)/i.test(language))
        throw Object.assign(Error('VITS 日语模型只支持日语，请选择三语模型或将朗读语言设为日语'), {
          statusCode: 400,
        });
      const api = vitsModels.find((m) => m.id === model.id)!.api;
      const chunks: Buffer[] = [];
      let length = 0;
      for (const part of speechSegments(text)) {
        signal.throwIfAborted();
        const lang =
          model.id === 'japanese'
            ? 'Japanese'
            : /^ja(?:-|$)/i.test(language)
              ? '日本語'
              : /^zh(?:-|$)/i.test(language)
                ? '简体中文'
                : /^en(?:-|$)/i.test(language)
                  ? 'English'
                  : language === 'auto'
                    ? /[\u3040-\u30ff]/u.test(part)
                      ? '日本語'
                      : /[\u3400-\u9fff]/u.test(part)
                        ? '简体中文'
                        : 'English'
                    : '';
        if (!lang)
          throw Object.assign(Error('这个 VITS 模型支持中文、日语和英语'), { statusCode: 400 });
        const job = await readJson(
          await this.fetch('/gradio_api/call/' + api, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: [part, chosen, lang, settings.speechSpeed, false] }),
          }),
        );
        if (typeof job.event_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(job.event_id))
          throw Error('VITS 未返回有效排队编号');
        const result = await completeEvent(
          await this.fetch(`/gradio_api/call/${api}/${job.event_id}`, { signal }),
          signal,
        );
        if (!Array.isArray(result) || result[0] !== 'Success' || !result[1]?.url)
          throw Error('VITS 未能生成音频，公共服务可能繁忙，请稍后重试');
        const url = new URL(result[1].url);
        if (
          url.origin !== vitsOrigin ||
          !url.pathname.startsWith('/gradio_api/file=') ||
          url.username ||
          url.password
        )
          throw Error('VITS 返回了无效的音频地址');
        const response = await this.fetch(url.pathname + url.search, { signal });
        if (!response.ok) {
          await response.body?.cancel();
          throw Error(`下载 VITS 音频失败（HTTP ${response.status}）`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error('VITS 返回空音频');
        const buffers: Uint8Array[] = [];
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 10_000_000) throw Error('语音超过 10 MB 大小限制');
            buffers.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        chunks.push(Buffer.concat(buffers));
      }
      return joinWaves(chunks);
    } finally {
      this.active.delete(workspace);
    }
  }
}

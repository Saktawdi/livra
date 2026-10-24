import { Buffer } from 'buffer';
import { environment } from './environment.ts';
import type { Provider, Settings } from '@livra/shared';
import { endpoint, network, readJson, safeError } from './network.ts';

export async function synthesize(
  provider: Provider,
  settings: Settings,
  input: string,
  voice: string,
  language: string,
  signal: AbortSignal,
  request = network,
) {
  const fish = provider.protocol === 'fish';
  if (!fish && provider.protocol !== 'openai')
    throw Error('此语音连接需要选择 Fish Audio 或 OpenAI 兼容协议');
  const model = settings.speechModel || (fish ? 's2.1-pro' : 'tts-1');
  const chosenVoice = voice || settings.speechVoice;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
  };
  if (fish) headers.model = model;
  const body = fish
    ? {
        text: input,
        format: 'mp3',
        ...(chosenVoice ? { reference_id: chosenVoice } : {}),
        ...(language && language !== 'auto' ? { language } : {}),
        prosody: { speed: settings.speechSpeed, volume: 0 },
        latency: settings.speechLatency,
      }
    : {
        model,
        input,
        voice: chosenVoice || 'alloy',
        speed: settings.speechSpeed,
        response_format: 'mp3',
      };
  const url = endpoint(provider.baseUrl, fish ? 'tts' : 'audio/speech');
  let response: Response;
  try {
    // Fish's official HTTPS service may resolve into a TUN proxy's fake-IP range.
    // Keep LAN addresses and custom endpoints subject to the existing restrictions.
    response = await request(
      url,
      { method: 'POST', headers, body: JSON.stringify(body), signal },
      environment.ALLOW_PRIVATE_ENDPOINTS === 'true',
      fish && new URL(url).origin === 'https://api.fish.audio',
    );
    if (!response.ok) await readJson(response);
  } catch (error) {
    if (signal.aborted) throw error;
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? `（${safeError(error.cause, [provider.apiKey])}）`
        : '';
    const detail = safeError(error, [provider.apiKey]) + cause;
    throw Object.assign(Error(`${fish ? 'Fish Audio' : '语音服务'}合成失败：${detail}`), {
      statusCode: error instanceof Error && error.name === 'TimeoutError' ? 504 : 502,
    });
  }
  const type = response.headers.get('content-type') || '';
  if (type.includes('json')) {
    await readJson(response);
    throw Error('语音服务返回了 JSON，未返回音频');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('语音服务返回空响应');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 10_000_000) throw Error('语音超过 10 MB 大小限制');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!length) throw Error('语音服务未返回音频');
  return Buffer.concat(chunks);
}

import type { AgentEvent } from '@livra/shared';
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public locked = false,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API + '/api' + path, {
    credentials: 'include',
    ...options,
    headers: {
      'X-Livra-Client': 'web',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({ error: '服务未返回有效响应' }));
  if (!response.ok)
    throw new ApiError(
      data.error || `请求失败（${response.status}）`,
      response.status,
      !!data.locked,
    );
  return data;
}
export const post = <T = any>(path: string, data: unknown, options: RequestInit = {}) =>
  api<T>(path, { ...options, method: 'POST', body: JSON.stringify(data) });
export const put = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export async function streamRun(
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: AgentEvent) => void,
) {
  const response = await fetch(API + '/api/runs', {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Livra-Client': 'web' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json();
    throw Error(data.error || 'Agent 启动失败');
  }
  if (!response.body) throw Error('浏览器未收到响应流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data) onEvent(JSON.parse(data));
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function download(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readAttachment(file: File) {
  if (file.size > 6_000_000) throw Error('每个附件最大 6 MB');
  if (file.type.startsWith('image/')) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
      throw Error('支持 PNG、JPEG、WebP 或 GIF 图片');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(Error('无法读取图片'));
      reader.readAsDataURL(file);
    });
    return { name: file.name, type: 'image' as const, data };
  }
  if (!/\.(txt|md|json|csv|ts|js|py|html|css|xml|yaml|yml|log)$/i.test(file.name))
    throw Error('文档支持纯文本、Markdown、JSON、CSV 与代码文件');
  const data = await file.text();
  if (data.length > 150000) throw Error('文本附件最多 15 万字符');
  return { name: file.name, type: 'text' as const, data };
}

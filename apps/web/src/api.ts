import type { AgentEvent } from '@livra/shared';
export const API = ''; // Media is stored locally; providers are contacted directly.
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
 const { localCommand } = await import('./local/client');
 return localCommand<T>(path, options);
}
export const post = <T = any>(path: string, data: unknown, options: RequestInit = {}) =>
 api<T>(path, { ...options, method: 'POST', body: JSON.stringify(data) });
export const put = <T = any>(path: string, data: unknown) =>
 api<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export async function streamRun(body: unknown, signal: AbortSignal, onEvent: (event: AgentEvent) => void) {
 const { localRun } = await import('./local/client');
 return localRun(body, signal, onEvent);
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

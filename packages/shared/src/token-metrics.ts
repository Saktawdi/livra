import type { Attachment, Message } from './index.ts';

// A UI fallback, never presented as measured usage or a billing tokenizer.
export function estimateTextTokens(value: string) {
  let wide = 0,
    narrow = 0;
  for (const c of value) {
    if (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffef]/.test(c))
      wide++;
    else narrow++;
  }
  return wide + Math.ceil(narrow / 4);
}
export function estimateAttachments(items: Attachment[] = []) {
  return items.reduce(
    (sum, a) => sum + (a.type === 'image' ? 1024 : estimateTextTokens(a.data)),
    0,
  );
}
export function estimateMessages(messages: Message[]) {
  return messages.reduce(
    (sum, m) =>
      sum +
      4 +
      estimateTextTokens(m.content + (m.reasoning || '') + JSON.stringify(m.tools || [])) +
      estimateAttachments(m.attachments),
    0,
  );
}
export function formatTokens(value: number) {
  if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1000)
    return (value / 1000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return Math.round(value).toLocaleString('zh-CN');
}
